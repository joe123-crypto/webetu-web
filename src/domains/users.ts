import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { generatePublicUserId, isPublicUserId, validateFirebaseUid } from "@/src/lib/utils";

// Default connection state for a freshly created user record. Mirrors the shape
// written by saveWebetuCredentials so the document is well-formed regardless of
// whether sign-in or credential-save happens first.
const DEFAULT_SERVICES = Object.freeze({
  gmail: "not_connected",
  calendar: "not_connected",
  jobs: "not_subscribed",
  webetu: "not_connected",
  news: "not_subscribed",
});

// Returns the stable public identifier used in dashboard URLs (/{publicUserId}),
// creating and persisting one on the user's Firestore record on first sign-in.
// Runs in a transaction so concurrent sign-ins can't mint two different ids.
export async function getOrCreatePublicUserId(uidInput: string) {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    const existing = snap.exists ? (snap.data()?.publicUserId as unknown) : null;
    if (isPublicUserId(existing)) return existing as string;

    const publicUserId = generatePublicUserId();
    if (snap.exists) {
      t.update(userRef, {
        publicUserId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(userRef, {
        publicUserId,
        services: { ...DEFAULT_SERVICES },
        onboardingCompleted: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return publicUserId;
  });
}

// Whether the user still needs to complete the guided onboarding flow. Only a
// document created for a brand-new user carries `onboardingCompleted: false`, so
// legacy records (field absent) are treated as already onboarded and are never
// forced through onboarding.
export async function isOnboardingRequired(uidInput: string): Promise<boolean> {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const snap = await db.collection("users").doc(uid).get();
  return snap.data()?.onboardingCompleted === false;
}

// Marks the guided onboarding flow as finished for the user. Upserts the flag so
// it is well-formed even if the user document has not been created yet.
export async function markOnboardingCompleted(uidInput: string): Promise<void> {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    if (snap.exists) {
      t.update(userRef, {
        onboardingCompleted: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(userRef, {
        onboardingCompleted: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
}
