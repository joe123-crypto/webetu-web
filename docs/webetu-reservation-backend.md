# Webetu reservation backend — what webetu-web still needs to implement

**Status:** the backend repo (`webetu`, branch `feature/webetu-read-api`) is done and tested.
This document briefs the webetu-web team on the routes, Firestore fields, env, and UI wiring
that must be built **here** for the new automatic-reservation switch and reservation data to
work end to end.

## Background — what changed on the backend

The `webetu` repo (the headless worker + cron in this system) gained:

1. A **roster-driven cron**: `scheduler/reserve_meals.sh` no longer reserves for every
   onboarded user. It now calls **this app's** internal API for the connected + enabled
   roster and reserves **only** for users who turned the switch on. If it can't fetch the
   roster it **fails closed** (reserves for nobody).
2. A **read-only HTTP API** (`bin/webetu-api`, default `127.0.0.1:8787`) that this app can
   call to show a user's **live restaurants**, their **reservation status** (made / pending /
   run history), and the **next scheduled run**. It's bearer-authed.
3. A new worker command `list-reservations` (made + pending) behind that API.

For any of this to work, webetu-web must provide the routes below and (optionally, for the
new UI) consume the read-API.

## The shared bearer key (read this first)

Both sides authenticate internal calls with the **same env var name and value**:
**`WEBETU_INTERNAL_API_KEY`**.

| Repo | Env var | Used by |
| --- | --- | --- |
| webetu-web (this app) | `WEBETU_INTERNAL_API_KEY` (`src/config/index.ts` → `config.internalApiKey`) | `verifyInternalApiKey` on our `/internal/*` routes |
| webetu (backend) | `WEBETU_INTERNAL_API_KEY` | the cron's roster call + the read-API server's auth |

**Set it to the identical value** in every environment. If the two differ, the cron gets 403
from our roster route and silently reserves for nobody (fail-closed). (The backend also reaches
this app via `WEBETU_WEB_BASE_URL`.)

---

## Part A — REQUIRED: routes/fields this app must add

Without these, the switch does nothing and the cron reserves for nobody.

### A1. Store the switch flag in Firestore

Add an `autoReservationEnabled: boolean` field to the existing per-user
`webetuPreferences/<uid>` document (same collection `src/domains/webetu.ts` already manages).

- **Default semantics = opt-in.** Absent/false ⇒ disabled. The cron only reserves for users
  whose flag is explicitly `true`. (This is deliberate: a user must turn "Automatic
  Reservation" on.)
- Suggested domain helpers in `src/domains/webetu.ts`, mirroring the existing
  `getWebetuPreferencesForUid` / `setWebetuDefaultRestaurantForUid`:
  - `getWebetuAutoReservationForUid(uid): Promise<{ enabled: boolean }>`
  - `setWebetuAutoReservationForUid(uid, enabled): Promise<{ enabled: boolean }>`
  Use `validateFirebaseUid` and a Firestore transaction/merge like the other setters.

### A2. Browser route `/webetu/preferences/auto-reservation` (session-authed)

**The UI already calls this** — `app/_components/auto-reservation-toggle.tsx` GET/POSTs it and
is rendered on the dashboard (`app/[publicUserId]/page.tsx`). The route file does **not exist
yet**, so the toggle currently no-ops.

Create `app/webetu/preferences/auto-reservation/route.ts` (`runtime = "nodejs"`), authed with
`verifyFirebaseRequest(req)` like the other `app/webetu/*` routes:

- `GET`  → `{ "enabled": boolean }` (from `getWebetuAutoReservationForUid(uid)`).
- `POST` body `{ "enabled": boolean }` → persist via `setWebetuAutoReservationForUid`, return
  `{ "enabled": boolean }`.
- On error return `{ ok:false, error }` with the appropriate status (match the existing
  `app/webetu/restaurants/route.ts` error shape). The toggle reads `body.enabled` and
  `body.error`.

This is the **write path** for the switch (browser → Firestore). The backend never writes it.

### A3. Internal route `GET /internal/webetu/reservation-roster` (bearer)

**The cron calls this** (`webetu/lib/webetu_web_api.py::fetch_reservation_roster`). Create
`app/internal/webetu/reservation-roster/route.ts`, authed with `verifyInternalApiKey(req)`
(same pattern as `app/internal/webetu/restaurants/route.ts`).

Response:

```json
{
  "ok": true,
  "count": 2,
  "users": [
    { "userId": "<firebase-uid>", "enabled": true,  "restaurant": { "name": "RU Central" } },
    { "userId": "<firebase-uid>", "enabled": false, "restaurant": { "name": "…" } }
  ]
}
```

Rules:
- Include **only users with ACTIVE webetu credentials** ("connected"). Determine this the way
  `getWebetuCredentialStatus` does: `credentialRefs/<webetuCredentialRefId(uid)>.status ===
  "active"`. (Enumerate `credentialRefs` where `service == "webetu"` and `status ==
  "active"`, then join each user's `webetuPreferences`.)
- `enabled` = the `autoReservationEnabled` flag from A1 (explicit `true` only).
- `restaurant.name` is optional/non-secret (nice for display/logs).
- **NEVER return credentials, secrets, tokens, phone numbers, or emails.** Only `userId`,
  `enabled`, and the public restaurant name.

### A4. Internal route `GET /internal/webetu/auto-reservation?userId=<uid>` (bearer)

**The read-API server calls this** (`webetu/lib/webetu_web_api.py::fetch_auto_reservation`) to
show the switch state alongside reservation data. Create
`app/internal/webetu/auto-reservation/route.ts`, authed with `verifyInternalApiKey(req)`.

- Parse `userId` from the query (`validateFirebaseUid`).
- Return `{ "enabled": boolean }` (or `{ "ok": true, "enabled": boolean }` — the client
  accepts both) from `getWebetuAutoReservationForUid`.

---

## Part B — OPTIONAL / NEXT: consume the read-API to show the new data

The backend read-API can now serve live restaurants and reservation status per user. To
surface it in the UI (e.g. replace the static restaurant catalog with the user's real ONOU
restaurants, and add a reservation-status panel with dates + next run), this app calls the
backend server-side.

- **Env:** add `WEBETU_API_BASE_URL` (e.g. `http://127.0.0.1:8787` in dev, or the internal
  address where `bin/webetu-api` runs). Authenticate with the shared key
  (`WEBETU_INTERNAL_API_KEY`) as `Authorization: Bearer <key>`.
- **Endpoints** (all `GET`, bearer-authed; `{userId}` is the Firebase UID):

  | Path | Returns |
  | --- | --- |
  | `/api/webetu/users/{userId}/restaurants` | `{ ok, restaurants: [{ name, meals: ["breakfast","lunch","dinner"] }], count }` — the user's **live** ONOU restaurants |
  | `/api/webetu/users/{userId}/reservations` | `{ ok, reserved: [{date, meals:[1,2,3], restaurant}], pending: [{date, missingMeals:[…]}], runs: [{date, status, meals}], lastRunAt, nextRunAt, overallStatus, enabled }` |
  | `/api/webetu/users/{userId}/auto-reservation` | `{ ok, enabled }` |
  | `/api/webetu/schedule` | `{ ok, nextRunAt, timezone, scheduleLabel }` |
  | `/healthz` | `{ ok: true }` (no auth) |

- Suggested wiring: a server-side proxy route (e.g. `app/webetu/reservations/route.ts`) that
  reads the session (`verifyFirebaseRequest`), then fetches the backend with the bearer key —
  never expose the key or the backend URL to the browser. This mirrors how `app/webetu/*`
  routes wrap server logic today.
- The dashboard (`app/[publicUserId]/page.tsx`) and/or meal-reservation page can then render
  `reserved`/`pending`/`runs`/`nextRunAt`.

Part B is not required for the switch/cron to function — it's how users *see* the data. Ship
Part A first.

---

## Security constraints (non-negotiable)

- The `/internal/*` roster and auto-reservation routes must be **bearer-only**
  (`verifyInternalApiKey`) and must **never** leak credentials, secrets, tokens, phone
  numbers, or emails. Roster returns `userId` + `enabled` + public restaurant name only.
- Credentials continue to be decrypted **only** inside the isolated `webetu-worker` process
  (unchanged). This app must not send plaintext credentials anywhere.
- Both repos use `WEBETU_INTERNAL_API_KEY` — set it to the same value on both.

## Acceptance checklist

- [ ] `webetuPreferences.autoReservationEnabled` field + `get/setWebetuAutoReservationForUid`.
- [ ] `GET/POST /webetu/preferences/auto-reservation` (session) — toggle persists + reflects on reload.
- [ ] `GET /internal/webetu/reservation-roster` (bearer) — active+enabled users only, no secrets.
- [ ] `GET /internal/webetu/auto-reservation?userId=` (bearer) — returns `{enabled}`.
- [ ] `WEBETU_INTERNAL_API_KEY` set to the same value in both webetu-web and the backend.
- [ ] (Part B) `WEBETU_API_BASE_URL` + server-side proxy to render restaurants/reservations.

## Reference — files in this repo to mirror

- Bearer auth: `verifyInternalApiKey` (`src/security/session.ts`); session auth:
  `verifyFirebaseRequest` / `verifyFirebaseSessionCookie`.
- Existing internal route to copy: `app/internal/webetu/restaurants/route.ts`.
- Existing browser route to copy: `app/webetu/restaurants/route.ts`,
  `app/webetu/preferences/route.ts`.
- Domain layer + helpers: `src/domains/webetu.ts`, `src/lib/utils.ts`
  (`webetuCredentialRefId`, `validateFirebaseUid`, `httpError`, `WEBETU_FALLBACK_RESTAURANT`).
- The switch UI (already built, already calls A2): `app/_components/auto-reservation-toggle.tsx`.

The authoritative backend-side contract also lives in `webetu/README.md`.
