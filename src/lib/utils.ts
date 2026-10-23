import crypto from "node:crypto";

export function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

export function escapeHtmlAttribute(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function rejectHeaderInjection(value: unknown, field: string) {
  const text = String(value ?? "");
  if (/[\r\n]/.test(text)) throw httpError(400, `${field} cannot contain line breaks.`);
  return text.trim();
}

export function validateFirebaseUid(uid: unknown) {
  const value = String(uid ?? "");
  if (!value || value.length > 128) {
    throw httpError(401, "A valid Firebase user is required.");
  }
  return value;
}

export function normalizePhone(value: unknown) {
  const text = String(value ?? "").trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) throw httpError(400, "phone is required.");
  const phone = `+${digits}`;
  if (phone.length < 9 || phone.length > 16) throw httpError(400, "phone must normalize to 9-16 digits.");
  return phone;
}

export function whatsappPhoneHash(phone: string) {
  return crypto.createHash("sha256").update(`whatsapp:${normalizePhone(phone)}`).digest("hex").slice(0, 12);
}

export function maskPhone(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 4)}...${phone.slice(-4)}`;
}

export function isPublicUserId(value: unknown) {
  return /^usr_[A-Za-z0-9_-]{16}$/.test(String(value ?? ""));
}

export function validatePublicUserId(value: unknown) {
  const text = String(value ?? "");
  if (!isPublicUserId(text)) throw httpError(404, "User route not found.");
  return text;
}

export function generatePublicUserId() {
  return `usr_${crypto.randomBytes(12).toString("base64url")}`;
}

export function splitName(displayName: string | null | undefined) {
  const parts = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function isGoogleSignIn(decodedToken: any) {
  return decodedToken?.firebase?.sign_in_provider === "google.com";
}

// ---------------------------------------------------------------------------
// Webetu-specific helpers
// ---------------------------------------------------------------------------

import { FieldValue } from "firebase-admin/firestore";

export const WEBETU_FALLBACK_RESTAURANT = Object.freeze({
  catalogId: "bab-ezzouar-03",
  name: "الإقامة الجامعية 03 باب الزوار",
  idDepot: 190,
  residence: 5185801,
  wilaya: null,
  active: true,
});

export function webetuCredentialRefId(userId: string) {
  const safeUid = validateFirebaseUid(userId);
  return `webetu_username_password_${safeUid}`;
}

export function webetuRestaurantOverrideId(userId: string, date: string) {
  return `${validateFirebaseUid(userId)}_${normalizeRestaurantDate(date)}`;
}

export function normalizeWebetuCredentials(input: any = {}) {
  const username = rejectHeaderInjection(input.username, "username");
  const password = String(input.password ?? "");
  if (!username) throw httpError(400, "username is required.");
  if (username.length > 120) throw httpError(400, "username is too long.");
  if (!password) throw httpError(400, "password is required.");
  if (password.length > 256) throw httpError(400, "password is too long.");
  if (password.includes("\0")) throw httpError(400, "password is invalid.");
  return { username, password };
}

// Verifying credentials makes our server attempt a Webetu login on the caller's behalf,
// which would otherwise let a signed-in user brute-force arbitrary Webetu accounts
// through us. Cap how often one user may do that.
export const WEBETU_VERIFY_WINDOW_MS = 10 * 60 * 1000;
export const WEBETU_VERIFY_MAX_ATTEMPTS = 10;

export type WebetuVerifyThrottleDecision = {
  allowed: boolean;
  // Attempt count to persist for the current window (1 when the window rolled over).
  count: number;
  // True when this attempt starts a fresh window, so the caller resets windowStart.
  windowReset: boolean;
};

// The short window stops bursts; the daily cap bounds the total, so a slow guesser
// gets at most this many tries per day. Neither counter is reset by a successful
// verify: a user could otherwise interleave their own valid credentials with guesses
// at someone else's password and reset the budget forever.
export const WEBETU_VERIFY_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WEBETU_VERIFY_DAILY_MAX_ATTEMPTS = 30;

type WindowInput = {
  now: number;
  windowStartMs?: number | null;
  count?: number | null;
};

// One fixed-window counter. A missing or malformed windowStartMs is treated as "no
// window yet" and starts a fresh one.
function fixedWindowDecision(
  input: WindowInput,
  windowMs: number,
  maxAttempts: number
): WebetuVerifyThrottleDecision {
  const { now } = input;
  const windowStartMs =
    typeof input.windowStartMs === "number" && Number.isFinite(input.windowStartMs)
      ? input.windowStartMs
      : null;
  const stored =
    typeof input.count === "number" && Number.isFinite(input.count) && input.count > 0
      ? Math.floor(input.count)
      : 0;

  // No window yet, or the previous one has elapsed: this attempt starts a new one.
  // A windowStart in the future (clock skew) also rolls over rather than locking out.
  const expired =
    windowStartMs === null || now - windowStartMs >= windowMs || now < windowStartMs;
  if (expired) return { allowed: true, count: 1, windowReset: true };

  if (stored >= maxAttempts) {
    return { allowed: false, count: stored, windowReset: false };
  }
  return { allowed: true, count: stored + 1, windowReset: false };
}

// Decide whether one more verify attempt is allowed in the short (10-minute) window.
// Pure so the rollover/limit logic is testable without Firestore.
export function webetuVerifyThrottleDecision(input: WindowInput): WebetuVerifyThrottleDecision {
  return fixedWindowDecision(input, WEBETU_VERIFY_WINDOW_MS, WEBETU_VERIFY_MAX_ATTEMPTS);
}

// Same decision for the 24-hour cap. An attempt must be allowed by both.
export function webetuVerifyDailyDecision(input: WindowInput): WebetuVerifyThrottleDecision {
  return fixedWindowDecision(
    input,
    WEBETU_VERIFY_DAILY_WINDOW_MS,
    WEBETU_VERIFY_DAILY_MAX_ATTEMPTS
  );
}

export type WebetuVerifyVerdict = "valid" | "invalid" | "unavailable" | "skip";

// Map a Webetu worker verify-credentials response (or a skip signal) to a verdict
// the save route acts on. Pure + exported so the save-vs-block decision is unit
// tested without a live worker.
//   - "skip":        verification is not configured (no worker) -> save as before.
//   - "valid":       the worker confirmed a successful Webetu login -> save.
//   - "invalid":     the worker got a definitive auth rejection -> block, "No such user".
//   - "unavailable": any other shape (non-ok, transient, malformed) -> block, retry.
// A non-definitive result is deliberately "unavailable", never "valid": we only
// save credentials we could actually confirm.
export function classifyVerifyResponse(
  input: { skip?: boolean; ok?: boolean; valid?: unknown } | null | undefined
): WebetuVerifyVerdict {
  if (!input) return "unavailable";
  if (input.skip) return "skip";
  if (input.ok !== true) return "unavailable";
  if (input.valid === true) return "valid";
  if (input.valid === false) return "invalid";
  return "unavailable";
}

export function normalizeRestaurantLookup(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeRestaurantDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, "date must be YYYY-MM-DD.");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw httpError(400, "date must be a valid calendar date.");
  }
  return text;
}

export function builtInWebetuRestaurants() {
  return [WEBETU_FALLBACK_RESTAURANT];
}

export function publicRestaurantFields(entry: any) {
  if (!entry) return null;
  const name = entry.name ?? entry.nameAR ?? entry.nameFR ?? "";
  return {
    catalogId: entry.catalogId ?? null,
    name,
    nameAR: entry.nameAR ?? null,
    nameFR: entry.nameFR ?? null,
    idDepot: entry.idDepot == null ? null : Number(entry.idDepot),
    residence: entry.residence == null ? null : Number(entry.residence),
    wilaya: entry.wilaya == null ? null : String(entry.wilaya),
    breakfast: entry.breakfast == null ? null : Boolean(entry.breakfast),
    lunch: entry.lunch == null ? null : Boolean(entry.lunch),
    dinner: entry.dinner == null ? null : Boolean(entry.dinner),
  };
}

export function storedRestaurantFields(entry: any, source = "catalog") {
  if (!entry || !entry.name || !entry.idDepot)
    throw httpError(400, "Restaurant entry is incomplete.");
  return {
    catalogId: entry.catalogId ?? `onou-depot-${Number(entry.idDepot)}`,
    name: entry.name,
    nameAR: entry.nameAR ?? null,
    nameFR: entry.nameFR ?? null,
    idDepot: Number(entry.idDepot),
    residence: entry.residence == null ? null : Number(entry.residence),
    wilaya: entry.wilaya == null ? null : String(entry.wilaya),
    breakfast: entry.breakfast == null ? null : Boolean(entry.breakfast),
    lunch: entry.lunch == null ? null : Boolean(entry.lunch),
    dinner: entry.dinner == null ? null : Boolean(entry.dinner),
    source,
    selectedAt: FieldValue.serverTimestamp(),
    lastVerifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function liveWebetuRestaurantFromPayload(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "restaurant must be a supported restaurant object.");
  }
  const idDepot = Number(input.idDepot ?? input.id_depot ?? input.id);
  if (!Number.isInteger(idDepot) || idDepot <= 0) {
    throw httpError(400, "restaurant idDepot is required.");
  }
  const nameAR = String(input.nameAR ?? input.nameAr ?? input.name_ar ?? "").trim();
  const nameFR = String(
    input.nameFR ?? input.nameFr ?? input.name_fr ?? input.nameEN ?? "",
  ).trim();
  const name = String(input.name ?? (nameAR || nameFR)).trim();
  if (!name) throw httpError(400, "restaurant name is required.");
  return {
    catalogId: String(input.catalogId ?? input.catalog_id ?? `onou-depot-${idDepot}`),
    name,
    nameAR: nameAR || name,
    nameFR: nameFR || name,
    idDepot,
    residence:
      input.residence == null || input.residence === "" ? null : Number(input.residence),
    wilaya: input.wilaya == null || input.wilaya === "" ? null : String(input.wilaya),
    breakfast: input.breakfast == null ? null : Boolean(input.breakfast),
    lunch: input.lunch == null ? null : Boolean(input.lunch),
    dinner: input.dinner == null ? null : Boolean(input.dinner),
    source: String(input.source ?? "onou_getdepotres"),
  };
}

// The student's ONOU location (wilaya code + residence id), as cached per user so
// the worker can skip its Webetu enrichment round-trips. Shared by the Firestore
// read/write helpers and by the live-restaurants route.
export type WebetuLocation = { wilaya: string; residence: number };

// Normalize a wilaya/residence pair, or null when it is not usable. A wilaya is an
// Algerian code (1-3 digits, commonly zero-padded); a residence id is a positive
// integer, mirroring the `idDepot > 0` check above. Used on the way into Firestore
// and on the way back out, so a junk document can neither be written nor sent on to
// the worker as a query param.
export function webetuLocation(wilaya: unknown, residence: unknown): WebetuLocation | null {
  if (wilaya == null || residence == null) return null;
  const code = String(wilaya).trim();
  if (!/^[0-9]{1,3}$/.test(code)) return null;
  const id = Number(residence);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { wilaya: code, residence: id };
}

// How long a cached location is reused before it is re-verified. Sending a saved
// location makes the worker skip discovery and answer "override", so a saved value
// is self-confirming: without a window like this, a wrong entry — including one
// written by the earlier provenance bug — would be pinned to the user forever.
// Re-verifying costs one user a handful of Webetu calls once a month.
export const WEBETU_LOCATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Whether a cached location is due for re-verification. An unknown timestamp counts
// as stale, so a document written before this field existed gets re-checked once.
export function webetuLocationIsStale(
  verifiedAtMs: number | null | undefined,
  now: number = Date.now()
): boolean {
  if (typeof verifiedAtMs !== "number" || !Number.isFinite(verifiedAtMs)) return true;
  return now - verifiedAtMs >= WEBETU_LOCATION_TTL_MS;
}

// Decide whether a worker read-API response carries a location worth persisting for
// this user, given the location we reused for the request (null when we had none, or
// deliberately didn't reuse a stale one). Returns the location to save, or null to
// leave Firestore alone.
//
// Only a location the worker read back from Webetu on that very call (`wilayaSource:
// "discovered"`) is saved: its other labels mean the value came from the worker's own
// hardcoded Algiers fallback, its local cache, or the override we just sent, none of
// which is evidence about where this student actually is. When we reused nothing, a
// discovered location is always written — even if it matches what is on file — so a
// re-verification refreshes the timestamp instead of re-discovering on every request.
//
// Kept here as a pure function so it is unit-testable without standing up auth and
// Firestore, which is also why liveRestaurantFromWorkerEntry lives in this file.
export function webetuLocationToPersist(
  body: any,
  reused: WebetuLocation | null
): WebetuLocation | null {
  if (!body || typeof body !== "object") return null;
  if (body.wilayaSource !== "discovered") return null;
  const discovered = webetuLocation(body.wilaya, body.residence);
  if (!discovered) return null;
  if (
    reused &&
    reused.wilaya === discovered.wilaya &&
    reused.residence === discovered.residence
  ) {
    return null;
  }
  return discovered;
}

// Map one restaurant from the worker read-API ({ idDepot, name, nameAR, nameFR, meals })
// into the shape the preferences save path accepts. Normalizes through
// liveWebetuRestaurantFromPayload, so anything returned here is guaranteed saveable;
// entries without a usable depot id or name yield null. The worker omits `meals` when
// no meal is offered, so a missing list means all meal flags are false.
export function liveRestaurantFromWorkerEntry(entry: any) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const meals: string[] = Array.isArray(entry.meals) ? entry.meals.map(String) : [];
  try {
    return liveWebetuRestaurantFromPayload({
      ...entry,
      breakfast: entry.breakfast ?? meals.includes("breakfast"),
      lunch: entry.lunch ?? meals.includes("lunch"),
      dinner: entry.dinner ?? meals.includes("dinner"),
    });
  } catch {
    return null;
  }
}

// Nobody tells the owner when the backend worker goes down -- the reachability probe in
// app/health/route.ts only ever reaches the visitor's status badge. These helpers decide,
// from the bookkeeping stored in Firestore, whether a failed probe is worth an email.
//
// Two thresholds, because either one alone is wrong:
//
//   * A count, so a single dropped request is not an outage. Matches the client badge's
//     FAILURES_BEFORE_OFFLINE, so the owner's inbox and the visitor's badge agree on what
//     "down" means.
//   * A duration, because the count is shared across serverless instances and therefore
//     traffic-dependent: under load two different visitors can push it to 2 within a
//     second, which is a blip. The duration is what makes the debounce mean the same thing
//     at any traffic level.
export const BACKEND_ALERT_FAILURES_BEFORE_ALERT = 2;
export const BACKEND_ALERT_MIN_OUTAGE_MS = 20_000;

// Outer safety net, not the rule that decides whether an outage is new -- that is the last
// observed outcome (see backendAlertDecision). A record this old is abandoned so a flag
// stranded by some unforeseen path cannot mute alerting forever. It is deliberately far
// longer than any plausible gap in traffic: a shorter window would reset the failure
// counters of a real outage just because nobody happened to visit, which is the one thing
// this must not do.
export const BACKEND_ALERT_STALE_STATE_MS = 24 * 60 * 60_000;

// How many times one outage may re-attempt a failed send before giving up. Delivery is
// retried by clearing the `alerted` flag, so without a cap a permanently broken sender
// would attempt a send on every probe for the length of the outage.
export const BACKEND_ALERT_MAX_SEND_ATTEMPTS = 5;

// Why a probe failed, in coarse buckets. The probe deliberately discards the underlying
// error message: it can carry the worker's base URL or a resolved address, and these
// values reach an email.
export type BackendProbeReason =
  | "ok"
  | "not_configured"
  | "timeout"
  | "network_error"
  | "bad_body"
  | `http_${number}`;

export type BackendAlertStoredState = {
  // The last outcome actually observed. This -- not elapsed time -- is what says whether a
  // failed probe continues an outage or starts one.
  reachable?: boolean | null;
  consecutiveFailures?: number | null;
  firstFailureAtMs?: number | null;
  alerted?: boolean | null;
  sendAttempts?: number | null;
  updatedAtMs?: number | null;
};

export type BackendAlertDecision = {
  shouldAlert: boolean;
  // Exactly what to persist; the caller writes these verbatim.
  next: {
    consecutiveFailures: number;
    firstFailureAtMs: number | null;
    alerted: boolean;
    sendAttempts: number;
  };
  // Diagnostics for the email body. `outageStartedAtMs` is the first failure this app
  // *observed*, which is not necessarily when the backend went down.
  outageStartedAtMs: number | null;
  failureCount: number;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Decide whether this probe outcome warrants an email, given what is on record. Pure so
// the threshold logic is testable without Firestore -- same split as
// webetuVerifyThrottleDecision above.
//
// Whether a failed probe continues an outage or starts a new one is decided by the last
// outcome this app *observed*, never by how long ago it observed it. Alerting is
// visitor-triggered, so a gap in the record means nobody looked -- not that the backend
// recovered. Deciding by elapsed time instead would reset the failure counters of a real
// outage whenever traffic went quiet, which on a low-traffic site means never alerting at
// all, and would clear the `alerted` flag mid-outage and send a second email.
//
// A reachable probe is what ends an outage: it clears the counters and the `alerted` flag,
// which is what lets the *next* outage alert again. It never emails (the owner opted out
// of recovery mail), but it must still be recorded.
export function backendAlertDecision(input: {
  now: number;
  reachable: boolean;
  stored?: BackendAlertStoredState | null;
}): BackendAlertDecision {
  const { now, reachable } = input;
  const raw = input.stored ?? null;

  // Abandon a record only when it is absurdly old, or stamped in the future (clock skew).
  // This is a safety net against a stranded flag, not the outage-identity rule.
  const updatedAtMs = finiteNumber(raw?.updatedAtMs);
  const usable =
    raw !== null &&
    updatedAtMs !== null &&
    updatedAtMs <= now &&
    now - updatedAtMs < BACKEND_ALERT_STALE_STATE_MS;
  const stored = usable ? raw : null;

  if (reachable) {
    const storedFirstFailureAtMs = finiteNumber(stored?.firstFailureAtMs);
    return {
      shouldAlert: false,
      next: { consecutiveFailures: 0, firstFailureAtMs: null, alerted: false, sendAttempts: 0 },
      outageStartedAtMs: storedFirstFailureAtMs,
      failureCount: 0,
    };
  }

  // The failure continues an outage only if the last thing we saw was also a failure.
  // Anything else -- a reachable probe, no record at all, an abandoned record -- means this
  // probe is the first evidence of a new outage, so nothing is carried over.
  const prior = stored?.reachable === false ? stored : null;

  const storedFailuresRaw = finiteNumber(prior?.consecutiveFailures);
  const storedFailures =
    storedFailuresRaw !== null && storedFailuresRaw > 0 ? Math.floor(storedFailuresRaw) : 0;
  const alerted = prior?.alerted === true;
  const storedAttemptsRaw = finiteNumber(prior?.sendAttempts);
  const storedAttempts =
    storedAttemptsRaw !== null && storedAttemptsRaw > 0 ? Math.floor(storedAttemptsRaw) : 0;
  const storedFirstFailureAtMs = finiteNumber(prior?.firstFailureAtMs);

  const failureCount = storedFailures + 1;
  // A first-failure stamp in the future would make the outage look negative-length, so it
  // is treated as absent and this probe becomes the start.
  const firstFailureAtMs =
    storedFirstFailureAtMs !== null && storedFirstFailureAtMs <= now ? storedFirstFailureAtMs : now;
  // Clamped, so skew between instances fails toward *not* emailing.
  const observedSpanMs = Math.max(0, now - firstFailureAtMs);

  const shouldAlert =
    !alerted &&
    storedAttempts < BACKEND_ALERT_MAX_SEND_ATTEMPTS &&
    failureCount >= BACKEND_ALERT_FAILURES_BEFORE_ALERT &&
    observedSpanMs >= BACKEND_ALERT_MIN_OUTAGE_MS;

  return {
    shouldAlert,
    next: {
      consecutiveFailures: failureCount,
      firstFailureAtMs,
      // Once an email has gone out, every later failure in the same outage stays silent.
      // Cleared again only by a reachable probe, or by a send that failed and is retried.
      alerted: alerted || shouldAlert,
      sendAttempts: shouldAlert ? storedAttempts + 1 : storedAttempts,
    },
    outageStartedAtMs: firstFailureAtMs,
    failureCount,
  };
}

// Plain-language gloss for a probe reason, for the alert email. Anything unrecognized
// degrades to a generic line rather than being echoed, so an unexpected value can never
// smuggle upstream text into the message.
export function backendProbeReasonLabel(reason: string): string {
  if (reason === "timeout") return "Connection timed out";
  if (reason === "network_error") return "Connection refused, DNS failure, or no route to host";
  if (reason === "bad_body") {
    return 'Answered, but not with {"ok": true} — possibly a tunnel interstitial or an error page';
  }
  if (reason === "not_configured") return "No backend base URL is configured";
  if (reason === "ok") return "Reachable";
  const http = /^http_(\d{3})$/.exec(reason);
  if (http) return `Upstream answered HTTP ${http[1]}`;
  return "Unreachable for an unrecognized reason";
}

// Format a span as "4m 12s" / "3h 05m" / "2d 04h". Used for "down for" in the alert email.
export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}
