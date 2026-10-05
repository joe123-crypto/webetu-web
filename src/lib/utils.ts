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
