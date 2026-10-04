/**
 * check-user-restaurants.mjs
 *
 * READ-ONLY diagnostic: report which restaurants a given user sees.
 *   - Cached ONOU location: webetuMetadata/{uid} (wilaya/residence + when it was
 *     discovered). This is what parameterises the live list, so a stale or wrong
 *     entry here is the usual cause of "this user sees the wrong restaurants".
 *   - Live picker list: the ONOU worker read-API (what the picker offers), fetched
 *     exactly as the route does — passing the cached location when there is one, so
 *     the output matches what the user actually sees rather than a cold discovery.
 *   - Saved preferences: webetuPreferences/{uid} default + per-date overrides.
 *
 * Usage:
 *   node scripts/check-user-restaurants.mjs <uid-or-email>
 *   node scripts/check-user-restaurants.mjs user@example.com
 *
 * Required env (read from .env or the environment):
 *   FIREBASE_SERVICE_ACCOUNT_JSON_BASE64   (for Firestore + email->uid lookup)
 *   FIREBASE_PROJECT_ID
 * Optional (enables the live list):
 *   WEBETU_API_BASE_URL, WEBETU_INTERNAL_API_KEY
 *
 * This script never writes — no .set/.update/.delete.
 */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Minimal .env loader (tolerates values with spaces / "<...>" that break `source`)
// ---------------------------------------------------------------------------
function loadDotEnv(path = ".env") {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // no .env; rely on process.env
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

// ---------------------------------------------------------------------------
const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/check-user-restaurants.mjs <uid-or-email>");
  process.exit(1);
}

const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
if (!saB64 || !saB64.trim()) {
  console.error(
    "Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 — cannot read Firestore / resolve email.\n" +
      "Add it to .env (service account for the webetu-reservations project)."
  );
  process.exit(1);
}
const serviceAccount = JSON.parse(Buffer.from(saB64.trim(), "base64").toString("utf8"));
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
const auth = getAuth(app);

// ---------------------------------------------------------------------------
function restaurantLabel(r) {
  if (!r || r === "skip") return r === "skip" ? "SKIP (no reservation)" : "(none)";
  const name = r.nameFR || r.name || r.nameAR || r.catalogId || "(unnamed)";
  const meals = Array.isArray(r.meals) ? ` [${r.meals.join(", ")}]` : "";
  return `${name} — idDepot=${r.idDepot ?? "?"} catalogId=${r.catalogId ?? "?"}${meals}`;
}

function formatTimestamp(value) {
  if (!value) return "(unset)";
  try {
    return value.toDate().toISOString();
  } catch {
    return String(value);
  }
}

// Keep in step with WEBETU_LOCATION_TTL_MS in src/lib/utils.ts.
const LOCATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The cached ONOU location, read the same way the app does.
async function fetchSavedLocation(uid) {
  const snap = await db.collection("webetuMetadata").doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const wilaya = String(data.wilaya ?? "").trim();
  const residence = Number(data.residence);
  const usable = /^[0-9]{1,3}$/.test(wilaya) && Number.isInteger(residence) && residence > 0;
  const verifiedAtMs =
    typeof data.updatedAt?.toMillis === "function" ? data.updatedAt.toMillis() : null;
  const stale = verifiedAtMs == null || Date.now() - verifiedAtMs >= LOCATION_TTL_MS;
  return { wilaya, residence: data.residence, usable, stale, raw: data };
}

// Mirrors app/webetu/restaurants/live/route.ts: pass the saved location through so
// the worker skips re-discovery, and report what it says about provenance.
async function fetchLiveRestaurants(uid, saved) {
  const base = process.env.WEBETU_API_BASE_URL;
  const key = process.env.WEBETU_INTERNAL_API_KEY;
  if (!base || !key) return null;
  try {
    const url = new URL(`${base}/api/webetu/users/${encodeURIComponent(uid)}/restaurants`);
    // The route reuses a saved location only while it is fresh.
    const reuse = saved?.usable && !saved.stale;
    if (reuse) {
      url.searchParams.set("wilaya", saved.wilaya);
      url.searchParams.set("residence", String(saved.residence));
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body || body.ok === false || !Array.isArray(body.restaurants)) {
      return { error: "unexpected worker payload" };
    }
    return {
      restaurants: body.restaurants,
      wilaya: body.wilaya,
      residence: body.residence,
      wilayaSource: body.wilayaSource,
      sentSavedLocation: Boolean(reuse),
    };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
async function main() {
  // Resolve email -> uid if needed.
  let uid = target;
  let email = null;
  if (target.includes("@")) {
    email = target;
    const user = await auth.getUserByEmail(target);
    uid = user.uid;
    console.log(`Resolved ${email} -> uid ${uid}`);
  }

  console.log(`\n=== User ${uid}${email ? ` (${email})` : ""} ===`);

  // 1) Cached ONOU location — what parameterises everything below.
  console.log("\n--- Cached ONOU location (webetuMetadata) ---");
  const saved = await fetchSavedLocation(uid);
  if (!saved) {
    console.log("Nothing cached — the next restaurant lookup will re-discover.");
  } else {
    console.log(`wilaya=${saved.wilaya || "(unset)"} residence=${saved.residence ?? "(unset)"}`);
    console.log(`discoveredAt: ${formatTimestamp(saved.raw.discoveredAt)}`);
    console.log(`updatedAt:    ${formatTimestamp(saved.raw.updatedAt)}`);
    if (!saved.usable) {
      console.log("NOTE: this pair is malformed and is ignored (treated as nothing cached).");
    } else if (saved.stale) {
      console.log("NOTE: past its re-verification window — the next lookup re-discovers.");
    }
  }

  // 2) Live picker list, fetched the way the route does.
  console.log("\n--- Live picker list (ONOU worker) ---");
  const live = await fetchLiveRestaurants(uid, saved);
  if (!live) {
    console.log("(skipped — WEBETU_API_BASE_URL / WEBETU_INTERNAL_API_KEY not set)");
  } else if (live.error) {
    console.log(`(unavailable: ${live.error} — picker would fall back to static catalog)`);
  } else {
    console.log(
      `Resolved location: wilaya=${live.wilaya ?? "?"} residence=${live.residence ?? "?"} ` +
        `(source=${live.wilayaSource ?? "?"}, cached location sent=${live.sentSavedLocation})`
    );
    console.log(`${live.restaurants.length} restaurant(s):`);
    for (const r of live.restaurants) console.log(`  • ${restaurantLabel(r)}`);
  }

  // 3) Saved preferences.
  console.log("\n--- Saved preferences (webetuPreferences) ---");
  const prefSnap = await db.collection("webetuPreferences").doc(uid).get();
  if (!prefSnap.exists) {
    console.log("No preferences saved — picker default falls back to built-in (idDepot 190).");
  } else {
    const data = prefSnap.data() || {};
    console.log(`Default restaurant: ${restaurantLabel(data.defaultRestaurant)}`);
    const overrides = data.overrides && typeof data.overrides === "object" ? data.overrides : {};
    const keys = Object.keys(overrides).sort();
    if (keys.length === 0) {
      console.log("Per-date overrides: (none)");
    } else {
      console.log("Per-date overrides:");
      for (const date of keys) console.log(`  ${date}: ${restaurantLabel(overrides[date])}`);
    }
  }

  // 4) Cross-check webetuOverrides collection (authoritative per-date docs).
  const ovSnap = await db.collection("webetuOverrides").where("userId", "==", uid).get();
  if (!ovSnap.empty) {
    console.log("\n--- webetuOverrides docs ---");
    ovSnap.forEach((d) => {
      const o = d.data();
      const detail = o.action === "override" ? restaurantLabel(o.restaurant) : (o.action || "?");
      console.log(`  ${o.date}: ${detail}`);
    });
  }

  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err?.message || err);
    process.exit(1);
  });
