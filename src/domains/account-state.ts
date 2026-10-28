import type { Firestore, Transaction } from "firebase-admin/firestore";
import { httpError } from "@/src/lib/utils";

// Read in the SAME transaction as every user-data write. Deletion updates this
// document first, so concurrent writes retry and cannot resurrect removed data.
export async function assertAccountWritable(db: Firestore, t: Transaction, uid: string) {
  const user = await t.get(db.collection("users").doc(uid));
  if (!user.exists || user.data()?.deletionRequested === true) {
    throw httpError(409, "This account is being removed or no longer exists.");
  }
}
