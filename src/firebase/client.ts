import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";

export type FirebaseClientSettings = {
  configured: boolean;
  missing: string[];
  firebase: FirebaseOptions;
  emailLinkUrl: string;
};

export async function loadFirebaseClientSettings(fetcher: typeof fetch = fetch) {
  const response = await fetcher("/config/firebase", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const settings = (await response.json().catch(() => ({}))) as Partial<FirebaseClientSettings> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(settings.error || "Could not load Firebase configuration.");
  }
  if (!settings.configured || !settings.firebase) {
    const missing = settings.missing?.join(", ") || "Firebase browser configuration";
    throw new Error(`Sign-in is not configured. Missing: ${missing}.`);
  }
  return settings as FirebaseClientSettings;
}

export function initializeFirebaseClient(settings: FirebaseClientSettings) {
  const app = getApps().length > 0 ? getApp() : initializeApp(settings.firebase);
  return getAuth(app);
}
