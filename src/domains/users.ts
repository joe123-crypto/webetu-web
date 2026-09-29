import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { generatePublicUserId, isPublicUserId, validateFirebaseUid } from "@/src/lib/utils";
import type { OnboardingProgress } from "@/src/lib/onboarding";
import { getWebetuCredentialStatus, hasSavedWebetuDefaultRestaurant } from "@/src/domains/webetu";

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

// Only a document created for a brand-new user carries `onboardingCompleted: false`,
// so legacy records (field absent) are treated as already onboarded and are never
// forced through onboarding.
function onboardingRequiredFromData(data: DocumentData | undefined) {
  return data?.onboardingCompleted === false;
}

export type UserAccount = {
  publicUserId: string;
  isNewUser: boolean;
  onboardingRequired: boolean;
};

// Resolves the user's account on sign-in: the stable public identifier used in
// dashboard URLs (/{publicUserId}) and whether they still need onboarding.
// Creates the record (and its public id) on first sign-in. Runs in a
// transaction so concurrent sign-ins can't mint two different ids.
export async function getOrCreateUserAccount(uidInput: string): Promise<UserAccount> {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    const data = snap.exists ? snap.data() : undefined;
    const existing = data?.publicUserId as unknown;
    if (isPublicUserId(existing)) {
      return {
        publicUserId: existing as string,
        isNewUser: false,
        onboardingRequired: onboardingRequiredFromData(data),
      };
    }

    const publicUserId = generatePublicUserId();
    if (snap.exists) {
      t.update(userRef, {
        publicUserId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { publicUserId, isNewUser: false, onboardingRequired: onboardingRequiredFromData(data) };
    }

    t.set(userRef, {
      publicUserId,
      services: { ...DEFAULT_SERVICES },
      onboardingCompleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { publicUserId, isNewUser: true, onboardingRequired: true };
  });
}

// Whether the user still needs to complete the guided onboarding flow.
export async function isOnboardingRequired(uidInput: string): Promise<boolean> {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const snap = await db.collection("users").doc(uid).get();
  return onboardingRequiredFromData(snap.data());
}

// What the user has set up so far, used to gate onboarding steps.
export async function getOnboardingProgress(uid: string): Promise<OnboardingProgress> {
  const [credentialStatus, restaurantChosen] = await Promise.all([
    getWebetuCredentialStatus(uid),
    hasSavedWebetuDefaultRestaurant(uid),
  ]);
  return { credentialsSaved: credentialStatus.configured, restaurantChosen };
}

// Marks the guided onboarding flow as finished for the user.
export async function markOnboardingCompleted(uidInput: string): Promise<void> {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  await db.collection("users").doc(uid).set(
    {
      onboardingCompleted: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
