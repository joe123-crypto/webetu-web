import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import {
  httpError,
  validateFirebaseUid,
  webetuCredentialRefId,
  normalizeWebetuCredentials,
  normalizeRestaurantDate,
  normalizeRestaurantLookup,
  builtInWebetuRestaurants,
  publicRestaurantFields,
  storedRestaurantFields,
  liveWebetuRestaurantFromPayload,
  webetuRestaurantOverrideId,
  webetuLocation,
  webetuLocationIsStale,
  webetuVerifyThrottleDecision,
  WEBETU_FALLBACK_RESTAURANT,
  type WebetuLocation,
} from "@/src/lib/utils";
import { encryptCentralSecret, decryptCentralSecret } from "@/src/security/crypto";

export async function getWebetuCredentialStatus(uid: string) {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const refId = webetuCredentialRefId(safeUid);
  const doc = await db.collection("credentialRefs").doc(refId).get();
  if (!doc.exists) {
    return {
      configured: false,
      connected: false,
      status: "not_saved",
      updatedAt: null,
      lastVerifiedAt: null,
    };
  }
  const data = doc.data() || {};
  const isActive = data.status === "active";
  return {
    configured: isActive,
    connected: isActive,
    status: isActive ? "active" : data.status === "revoked" ? "revoked" : data.status ?? "not_saved",
    updatedAt: data.updatedAt?.toDate()?.toISOString() ?? null,
    lastVerifiedAt: data.lastVerifiedAt?.toDate()?.toISOString() ?? null,
  };
}

export async function getWebetuUsername(uid: string): Promise<string | null> {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const refId = webetuCredentialRefId(safeUid);
  const doc = await db.collection("credentialRefs").doc(refId).get();
  if (!doc.exists) return null;
  const data = doc.data() || {};
  if (!data.secret) return null;
  const creds = decryptCentralSecret(data.secret, refId);
  const username = creds?.username;
  return typeof username === "string" && username ? username : null;
}

// Per-user rate limit for credential verification. Verifying makes our backend attempt a
// Webetu login with whatever pair the caller supplies, so without a cap a signed-in user
// could brute-force other students' Webetu accounts through our server. Counted in
// webetuVerifyAttempts/{uid} as a fixed window.
//
// Throws 429 when the window's budget is spent. The caller consumes an attempt only when
// a real verification is about to happen (never when verification is skipped), and calls
// resetWebetuVerifyAttempts after a success so an honest user who mistyped is not left
// throttled.
export async function consumeWebetuVerifyAttempt(uid: string): Promise<void> {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const ref = db.collection("webetuVerifyAttempts").doc(safeUid);
  const now = Date.now();

  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const data = doc.data() || {};
    const decision = webetuVerifyThrottleDecision({
      now,
      windowStartMs: data.windowStartAt?.toMillis?.() ?? null,
      count: typeof data.count === "number" ? data.count : null,
    });
    if (!decision.allowed) {
      throw httpError(
        429,
        "Too many verification attempts. Please wait a few minutes and try again."
      );
    }
    t.set(
      ref,
      {
        userId: safeUid,
        count: decision.count,
        ...(decision.windowReset
          ? { windowStartAt: FieldValue.serverTimestamp() }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

// Clear a user's verify budget after a confirmed-good login, so earlier typos do not
// count against someone who has demonstrably supplied working credentials.
export async function resetWebetuVerifyAttempts(uid: string): Promise<void> {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  await db.collection("webetuVerifyAttempts").doc(safeUid).delete();
}

// Give an attempt back when verification produced no verdict (worker down, timeout).
// The budget exists to stop brute-forcing, and an attempt that returns no valid/invalid
// signal tells an attacker nothing -- so charging for it only punishes real users during
// an outage. Decrements rather than clearing, so a forced failure can't wipe the budget.
export async function refundWebetuVerifyAttempt(uid: string): Promise<void> {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const ref = db.collection("webetuVerifyAttempts").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists) return;
    const current = doc.data()?.count;
    if (typeof current !== "number" || current <= 0) return;
    t.update(ref, {
      count: Math.max(0, current - 1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function saveWebetuCredentials(uid: string, body: any) {
  const safeUid = validateFirebaseUid(uid);
  const creds = normalizeWebetuCredentials(body);
  const db = getFirestoreDb();
  const refId = webetuCredentialRefId(safeUid);
  const secret = encryptCentralSecret(creds, refId);
  const credsRef = db.collection("credentialRefs").doc(refId);
  const centralRef = db.collection("users").doc(safeUid);
  // These credentials may belong to a different Webetu account than the one the
  // cached ONOU location was discovered from, so drop it and let the next
  // restaurant lookup re-discover.
  const metadataRef = db.collection("webetuMetadata").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(centralRef);
    t.delete(metadataRef);
    t.set(credsRef, {
      userId: safeUid,
      service: "webetu",
      purpose: "username_password",
      secret,
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
      lastVerifiedAt: FieldValue.serverTimestamp(),
    });
    if (doc.exists) {
      t.update(centralRef, {
        "services.webetu": "connected",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(centralRef, {
        services: {
          gmail: "not_connected",
          calendar: "not_connected",
          jobs: "not_subscribed",
          webetu: "connected",
          news: "not_subscribed",
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { connected: true };
}

export async function revokeWebetuCredentials(uid: string) {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const refId = webetuCredentialRefId(safeUid);
  const credsRef = db.collection("credentialRefs").doc(refId);
  const centralRef = db.collection("users").doc(safeUid);
  // The location was discovered from the account being disconnected; don't keep it
  // for whichever account is connected next.
  const metadataRef = db.collection("webetuMetadata").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(credsRef);
    const userDoc = await t.get(centralRef);
    t.delete(metadataRef);
    if (doc.exists) {
      t.update(credsRef, {
        status: "revoked",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (userDoc.exists) {
      t.update(centralRef, {
        "services.webetu": "not_connected",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { revoked: true };
}

export function webetuPreferencesFromData(data: any) {
  if (!data) {
    return {
      defaultRestaurant: publicRestaurantFields(WEBETU_FALLBACK_RESTAURANT),
      overrides: {},
    };
  }
  const defaultRestaurant =
    publicRestaurantFields(data.defaultRestaurant) ??
    publicRestaurantFields(WEBETU_FALLBACK_RESTAURANT);
  const overrides: Record<string, any> = {};
  if (data.overrides && typeof data.overrides === "object") {
    for (const [date, val] of Object.entries(data.overrides)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        overrides[date] = val === "skip" ? "skip" : publicRestaurantFields(val);
      }
    }
  }
  return { defaultRestaurant, overrides };
}

export async function getWebetuPreferencesForUid(uid: string) {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const doc = await db.collection("webetuPreferences").doc(safeUid).get();
  return webetuPreferencesFromData(doc.data());
}

// Per-user ONOU location (wilaya/residence) the worker discovered from the
// student's Webetu account. Cached in webetuMetadata/{uid} so later restaurant
// lookups can pass it through and skip re-discovery. Returns null when nothing
// usable is saved yet — including when the stored pair is malformed, since this
// value is forwarded to the worker, which books against it. `stale` marks a location
// due for re-verification; callers should stop reusing it then, so the worker
// re-discovers and a wrong entry can be corrected.
export async function getWebetuMetadataForUid(
  uid: string
): Promise<(WebetuLocation & { stale: boolean }) | null> {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const doc = await db.collection("webetuMetadata").doc(safeUid).get();
  const data = doc.data();
  if (!data) return null;
  const location = webetuLocation(data.wilaya, data.residence);
  if (!location) return null;
  const verifiedAtMs =
    typeof data.updatedAt?.toMillis === "function" ? data.updatedAt.toMillis() : null;
  return { ...location, stale: webetuLocationIsStale(verifiedAtMs) };
}

export async function saveWebetuMetadataForUid(
  uid: string,
  metadata: WebetuLocation
): Promise<void> {
  const safeUid = validateFirebaseUid(uid);
  const location = webetuLocation(metadata?.wilaya, metadata?.residence);
  if (!location) return;
  const db = getFirestoreDb();
  const ref = db.collection("webetuMetadata").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    t.set(
      ref,
      {
        userId: safeUid,
        ...location,
        // First discovery only; a later correction moves updatedAt instead.
        ...(doc.exists ? {} : { discoveredAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

// Whether the user has explicitly chosen a default restaurant. Unlike
// getWebetuPreferencesForUid, this does not count the fallback restaurant.
export async function hasSavedWebetuDefaultRestaurant(uid: string): Promise<boolean> {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const doc = await db.collection("webetuPreferences").doc(safeUid).get();
  return Boolean(doc.data()?.defaultRestaurant);
}

export async function setWebetuDefaultRestaurantForUid(uid: string, restaurantInput: any) {
  const safeUid = validateFirebaseUid(uid);
  const restaurant = liveWebetuRestaurantFromPayload(restaurantInput);
  const db = getFirestoreDb();
  const prefRef = db.collection("webetuPreferences").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(prefRef);
    if (doc.exists) {
      t.update(prefRef, {
        defaultRestaurant: storedRestaurantFields(restaurant, "user_default"),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(prefRef, {
        userId: safeUid,
        defaultRestaurant: storedRestaurantFields(restaurant, "user_default"),
        overrides: {},
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  const doc = await prefRef.get();
  return webetuPreferencesFromData(doc.data());
}

export async function getWebetuAutoReservationForUid(uid: string): Promise<{ enabled: boolean }> {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const doc = await db.collection("webetuPreferences").doc(safeUid).get();
  return { enabled: doc.data()?.autoReservationEnabled === true };
}

export async function setWebetuAutoReservationForUid(
  uid: string,
  enabledInput: unknown
): Promise<{ enabled: boolean }> {
  const safeUid = validateFirebaseUid(uid);
  const enabled = enabledInput === true;
  const db = getFirestoreDb();
  const prefRef = db.collection("webetuPreferences").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(prefRef);
    if (doc.exists) {
      t.update(prefRef, {
        autoReservationEnabled: enabled,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(prefRef, {
        userId: safeUid,
        autoReservationEnabled: enabled,
        overrides: {},
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { enabled };
}

export async function getWebetuEmailNotificationForUid(
  uid: string
): Promise<{ enabled: boolean }> {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const doc = await db.collection("webetuPreferences").doc(safeUid).get();
  // Opt-out default: absent field means notifications are ON.
  return { enabled: doc.data()?.emailNotificationEnabled !== false };
}

export async function setWebetuEmailNotificationForUid(
  uid: string,
  enabledInput: unknown
): Promise<{ enabled: boolean }> {
  const safeUid = validateFirebaseUid(uid);
  const enabled = enabledInput === true;
  const db = getFirestoreDb();
  const prefRef = db.collection("webetuPreferences").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(prefRef);
    if (doc.exists) {
      t.update(prefRef, {
        emailNotificationEnabled: enabled,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(prefRef, {
        userId: safeUid,
        emailNotificationEnabled: enabled,
        overrides: {},
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { enabled };
}

// Roster for the backend cron: active-credential ("connected") users plus their
// auto-reservation flag and public default-restaurant name. Never leaks secrets.
export async function listWebetuReservationRoster() {
  const db = getFirestoreDb();
  const snap = await db
    .collection("credentialRefs")
    .where("service", "==", "webetu")
    .where("status", "==", "active")
    .get();

  const users = await Promise.all(
    snap.docs.map(async (doc) => {
      const userId = doc.data()?.userId as string | undefined;
      if (!userId) return null;
      const prefDoc = await db.collection("webetuPreferences").doc(userId).get();
      const prefData = prefDoc.data();
      const restaurant =
        publicRestaurantFields(prefData?.defaultRestaurant) ??
        publicRestaurantFields(WEBETU_FALLBACK_RESTAURANT);
      return {
        userId,
        enabled: prefData?.autoReservationEnabled === true,
        restaurant: { name: restaurant?.name ?? WEBETU_FALLBACK_RESTAURANT.name },
      };
    })
  );

  const filtered = users.filter((u): u is NonNullable<typeof u> => u !== null);
  return { ok: true as const, count: filtered.length, users: filtered };
}

export async function setWebetuRestaurantOverrideForUid(uid: string, body: any) {
  const safeUid = validateFirebaseUid(uid);
  const date = normalizeRestaurantDate(body.date);
  const action = body.action === "skip" ? "skip" : "override";
  const restaurant = action === "skip" ? null : liveWebetuRestaurantFromPayload(body.restaurant);
  const db = getFirestoreDb();
  const prefRef = db.collection("webetuPreferences").doc(safeUid);
  const overrideRef = db
    .collection("webetuOverrides")
    .doc(webetuRestaurantOverrideId(safeUid, date));
  await db.runTransaction(async (t) => {
    const doc = await t.get(prefRef);
    if (action === "skip") {
      t.set(overrideRef, {
        userId: safeUid,
        date,
        action: "skip",
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (doc.exists) {
        t.update(prefRef, {
          [`overrides.${date}`]: "skip",
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        t.set(prefRef, {
          userId: safeUid,
          overrides: { [date]: "skip" },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } else {
      const stored = storedRestaurantFields(restaurant, "user_override");
      t.set(overrideRef, {
        userId: safeUid,
        date,
        action: "override",
        restaurant: stored,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (doc.exists) {
        t.update(prefRef, {
          [`overrides.${date}`]: stored,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        t.set(prefRef, {
          userId: safeUid,
          overrides: { [date]: stored },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  });
  const finalDoc = await prefRef.get();
  return webetuPreferencesFromData(finalDoc.data());
}

export async function ensureWebetuRestaurantCatalog() {
  const db = getFirestoreDb();
  const metaRef = db.collection("webetuCatalogMeta").doc("status");
  const meta = await metaRef.get();
  if (meta.exists && meta.data()?.hasBuiltIn) return;
  const batch = db.batch();
  for (const entry of builtInWebetuRestaurants()) {
    const ref = db.collection("webetuRestaurants").doc(entry.catalogId);
    batch.set(ref, storedRestaurantFields(entry, "builtin"));
  }
  batch.set(metaRef, { hasBuiltIn: true, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
}

export async function listWebetuRestaurantCatalog() {
  await ensureWebetuRestaurantCatalog();
  const db = getFirestoreDb();
  const snap = await db.collection("webetuRestaurants").get();
  const catalog = snap.docs.map((doc) => publicRestaurantFields(doc.data())).filter(Boolean);
  return catalog;
}

export async function resolveWebetuRestaurant(input: any) {
  if (!input) return publicRestaurantFields(WEBETU_FALLBACK_RESTAURANT);
  if (typeof input === "object" && input.idDepot) {
    return publicRestaurantFields(liveWebetuRestaurantFromPayload(input));
  }
  const query = normalizeRestaurantLookup(input);
  if (!query) return publicRestaurantFields(WEBETU_FALLBACK_RESTAURANT);
  const catalog = await listWebetuRestaurantCatalog();
  for (const r of catalog) {
    if (r?.catalogId === query || normalizeRestaurantLookup(r?.name) === query) return r;
  }
  for (const r of catalog) {
    if (r && normalizeRestaurantLookup(r.name).includes(query)) return r;
  }
  return publicRestaurantFields(WEBETU_FALLBACK_RESTAURANT);
}
