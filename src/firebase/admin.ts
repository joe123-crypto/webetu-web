import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { config, requireConfig } from "@/src/config";

let cachedApp: ReturnType<typeof initializeApp> | null = null;
let cachedAuth: ReturnType<typeof getAuth> | null = null;
let cachedDb: ReturnType<typeof getFirestore> | null = null;

export function getFirebaseAdminApp() {
  if (cachedApp) return cachedApp;
  const existingApps = getApps();
  if (existingApps.length > 0) {
    cachedApp = existingApps[0];
    return cachedApp;
  }
  requireConfig(["firebaseProjectId", "firebaseServiceAccountJsonBase64"]);
  try {
    const serviceAccountJson = Buffer.from(config.firebaseServiceAccountJsonBase64, "base64").toString("utf8");
    const serviceAccount = JSON.parse(serviceAccountJson);
    cachedApp = initializeApp({
      credential: cert(serviceAccount),
      projectId: config.firebaseProjectId,
    });
    return cachedApp;
  } catch (error) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON_BASE64:", error);
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON_BASE64");
  }
}

export function getFirebaseAdminAuth() {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getFirebaseAdminApp());
  return cachedAuth;
}

export function getFirestoreDb() {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getFirebaseAdminApp());
  return cachedDb;
}
