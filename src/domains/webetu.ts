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
  WEBETU_FALLBACK_RESTAURANT,
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

export async function saveWebetuCredentials(uid: string, body: any) {
  const safeUid = validateFirebaseUid(uid);
  const creds = normalizeWebetuCredentials(body);
  const db = getFirestoreDb();
  const refId = webetuCredentialRefId(safeUid);
  const secret = encryptCentralSecret(creds, refId);
  const credsRef = db.collection("credentialRefs").doc(refId);
  const centralRef = db.collection("users").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(centralRef);
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
  await db.runTransaction(async (t) => {
    const doc = await t.get(credsRef);
    const userDoc = await t.get(centralRef);
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
