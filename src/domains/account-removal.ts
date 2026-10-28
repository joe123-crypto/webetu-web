import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { getFirebaseAdminAuth, getFirestoreDb } from "@/src/firebase/admin";
import { httpError, validateFirebaseUid, webetuCredentialRefId } from "@/src/lib/utils";

const UID_COLLECTIONS = [
  "credentialRefs", "webetuPreferences", "webetuOverrides", "webetuMetadata",
  "webetuVerifyAttempts", "webetuManualRuns", "dashboardTaskStatus",
] as const;

export async function accountRemovalPending(uid: string) {
  const user = await getFirestoreDb().collection("users").doc(validateFirebaseUid(uid)).get();
  return user.data()?.deletionRequested === true;
}

function isMissingAuthUser(error: unknown) {
  return (error as { code?: string })?.code === "auth/user-not-found";
}

// A verified, unexpired Firebase session proves ownership for deletion retries
// even after this operation has disabled/deleted Auth. This exception grants NO
// normal app access. First-time removal still checks revocation and recent auth.
export async function authorizeAccountRemoval(session: string) {
  const auth = getFirebaseAdminAuth();
  const decoded = await auth.verifySessionCookie(session, false).catch(() => {
    throw httpError(401, "Your session expired. Contact support if removal was already started.");
  });
  const uid = validateFirebaseUid(decoded.uid);
  if (await accountRemovalPending(uid)) return uid;

  try {
    await auth.getUser(uid);
  } catch (error) {
    // A lost success response can be retried without recreating any state.
    if (isMissingAuthUser(error)) return uid;
    throw error;
  }
  await auth.verifySessionCookie(session, true).catch(() => {
    throw httpError(401, "Sign in again before removing your account.");
  });
  const age = Date.now() / 1000 - decoded.auth_time;
  if (!Number.isFinite(age) || age < -60 || age > 300) {
    throw httpError(401, "For your security, sign in again before removing your account.");
  }
  return uid;
}

export async function removeAccount(uidInput: string) {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const auth = getFirebaseAdminAuth();
  const userRef = db.collection("users").doc(uid);

  // This fence survives every partial failure until Auth and all other records
  // are gone. Also fence legacy identities whose user root is missing. A retry
  // can recreate only this temporary deletion marker, never an active account.
  await db.runTransaction(async (t) => {
    const user = await t.get(userRef);
    if (user.data()?.deletionRequested !== true) {
      t.set(userRef, { deletionRequested: true, deletionRequestedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });

  try {
    await auth.updateUser(uid, { disabled: true });
  } catch (error) {
    if (!isMissingAuthUser(error)) throw error;
  }

  // recursiveDelete(document) may remove its root even when descendants fail.
  // Preserve each root (and its userId) until all child collections are gone,
  // so ownership queries and the Settings retry fence survive partial failures.
  async function deleteOwnedDocument(ref: DocumentReference) {
    for (const child of await ref.listCollections()) await db.recursiveDelete(child);
    await ref.delete();
  }

  // Known deterministic roots cover legacy documents missing a userId field.
  // Child collection deletion also covers orphaned run history.
  for (const collection of ["webetuPreferences", "webetuMetadata", "webetuVerifyAttempts", "webetuManualRuns"]) {
    await deleteOwnedDocument(db.collection(collection).doc(uid));
  }
  await deleteOwnedDocument(db.collection("credentialRefs").doc(webetuCredentialRefId(uid)));
  for (const task of ["reserve_meals", "deliver_results"]) {
    await deleteOwnedDocument(db.collection("dashboardTaskStatus").doc(`${uid}_${task}`));
  }
  // Bounded pages avoid Firestore's batch limit and large history in memory.
  for (const collection of UID_COLLECTIONS) {
    const query = db.collection(collection).where("userId", "==", uid).limit(100);
    while (true) {
      const page = await query.get();
      if (page.empty) break;
      for (const doc of page.docs) await deleteOwnedDocument(doc.ref);
    }
  }

  // Auth last, then remove the fence and any user subcollections. On any error
  // the caller reports incomplete removal and retains the cookie for retry.
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (!isMissingAuthUser(error)) throw error;
  }
  await deleteOwnedDocument(userRef);
}
