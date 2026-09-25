# scripts/

## migrate-from-agent-genaie.mjs

One-time Firestore migration that copies all Webetu-related data from the
`agent_genaie` Firebase project into the new standalone `webetu-web` project.

### Prerequisites

- Node.js 18+ (the script is plain ESM — no build step).
- `firebase-admin` is already installed in this repo's `node_modules`.
- Two Firebase service-account JSON files: one for the **source** project
  (agent_genaie) and one for the **destination** project (webetu-web).
- The **same** `CENTRAL_DATA_ENCRYPTION_SECRET` is configured in both
  projects. Encrypted `credentialRefs` are copied verbatim and will decrypt
  correctly as long as the secret is identical.

### Required environment variables

| Variable | Description |
|---|---|
| `SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Base64-encoded service-account JSON for the **source** (agent_genaie) project |
| `DEST_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Base64-encoded service-account JSON for the **destination** (webetu-web) project |

Encode a service-account file:

```sh
base64 -w 0 path/to/source-service-account.json
base64 -w 0 path/to/dest-service-account.json
```

### Running the script

**Dry-run (default — prints what would be copied, writes nothing):**

```sh
SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=<base64> \
DEST_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=<base64> \
node scripts/migrate-from-agent-genaie.mjs
```

**Commit mode (actually writes to destination Firestore):**

```sh
SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=<base64> \
DEST_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=<base64> \
node scripts/migrate-from-agent-genaie.mjs --commit
```

The script is **idempotent**: it uses `set()` (full overwrite by document id)
on every write, so re-running it produces the same result without duplicating
or corrupting data. It never deletes anything from the source project.

### Collections copied

| Collection | Filter |
|---|---|
| `credentialRefs` | Only docs where `service == "webetu"` |
| `webetuPreferences` | All docs |
| `webetuOverrides` | All docs |
| `webetuRestaurants` | All docs |
| `webetuCatalogMeta` | All docs |
| `users` | Only users that have a webetu `credentialRef` or `services.webetu` set to an active/historical value |

### Collections intentionally skipped

These phone-path collections are not needed in the web-only app:

- `phoneLinksByUser`
- `phoneLinksByPhone`
- `accountLinkInvites`
- `webetuDeliveryByPhone`

---

## Firebase Auth: exporting and importing users

The migration script **does not** migrate Firebase Auth identities. Do this
separately using the Firebase CLI after the Firestore migration is complete.

### 1. Export Auth users from the source project

```sh
firebase auth:export users.json --project <SOURCE_PROJECT_ID>
```

This produces a `users.json` file (or you can use `--format=csv`).

### 2. Import Auth users into the destination project

```sh
firebase auth:import users.json \
  --project <DEST_PROJECT_ID> \
  --hash-algo=SCRYPT \
  --hash-key=<base64-hmac-key> \
  --salt-separator=<base64-salt-separator> \
  --rounds=8 \
  --mem-cost=14
```

**Important:** the hashing parameters (`--hash-algo`, `--hash-key`,
`--salt-separator`, `--rounds`, `--mem-cost`) must exactly match the source
project's password hashing configuration. You can find these values in the
Firebase console under **Authentication → Users → ⋮ → Password hash
parameters**, or in the export metadata returned by `firebase auth:export`.

For small user bases (or projects where all users sign in via Google OAuth
rather than email/password), mismatched hash parameters only affect password
login. In that case users can simply reset their password or re-authenticate
via Google — no data is lost.

### 3. Verify

After import, spot-check a few accounts in the Firebase console
(**Authentication → Users**) to confirm UIDs, emails, and sign-in providers
transferred correctly. UIDs must match the Firestore `users` document ids
copied by the migration script.
