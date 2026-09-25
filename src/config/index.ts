import fsSync from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

export const GOOGLE_IDENTITY_SCOPES = "openid email profile";
export const GOOGLE_SIGNIN_SCOPES = GOOGLE_IDENTITY_SCOPES;
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const DEFAULT_PUBLIC_BASE_URL = "http://localhost:3000";
export const SESSION_COOKIE_NAME = "webetu_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
export const GOOGLE_SIGNIN_NONCE_COOKIE = "webetu_google_signin";
export const GOOGLE_SIGNIN_NONCE_MAX_AGE_SECONDS = 10 * 60;

export function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fsSync.existsSync(envPath)) return;
  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match || process.env[match[1]] !== undefined) continue;
    const raw = match[2].trim();
    process.env[match[1]] = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

// Ensure .env is loaded before exporting config
loadDotEnv();

function resolvePublicBaseUrl() {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost.replace(/\/+$/, "")}`;
  return DEFAULT_PUBLIC_BASE_URL;
}

const publicBaseUrl = resolvePublicBaseUrl();

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  publicBaseUrl,
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  redirectUri: process.env.GOOGLE_REDIRECT_URI ?? `${publicBaseUrl}/auth/google/callback`,
  tokenEncryptionSecret: process.env.TOKEN_ENCRYPTION_SECRET ?? "",
  oauthStateSecret: process.env.OAUTH_STATE_SECRET ?? process.env.TOKEN_ENCRYPTION_SECRET ?? "",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "",
  firebaseApiKey: process.env.FIREBASE_API_KEY ?? "",
  firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN ?? "",
  firebaseAppId: process.env.FIREBASE_APP_ID ?? "",
  firebaseEmailLinkUrl: process.env.FIREBASE_EMAIL_LINK_URL ?? `${publicBaseUrl}/auth/firebase/finish`,
  firebaseServiceAccountJsonBase64: process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ?? "",
  internalApiKey: process.env.WEBETU_INTERNAL_API_KEY ?? "",
  centralDataEncryptionSecret: process.env.CENTRAL_DATA_ENCRYPTION_SECRET ?? process.env.TOKEN_ENCRYPTION_SECRET ?? "",
  centralDataKeyVersion: process.env.CENTRAL_DATA_KEY_VERSION ?? "v1",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number.parseInt(process.env.SMTP_PORT ?? "587", 10),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
};

export function assertPublicBaseUrl() {
  if (config.publicBaseUrl !== DEFAULT_PUBLIC_BASE_URL) return;
  if (process.env.PUBLIC_BASE_URL?.trim()) return;
  if (process.env.NODE_ENV !== "production") return;
  const err = new Error(
    "PUBLIC_BASE_URL is not set in a production deployment; refusing to emit localhost OAuth/email links. " +
      "Set PUBLIC_BASE_URL in the environment (Vercel injects VERCEL_URL automatically).",
  ) as Error & { status?: number };
  err.status = 500;
  throw err;
}

export function requireConfig(keys: (keyof typeof config)[]) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length === 0) return;
  const names = missing
    .map((key) => {
      if (key === "clientId") return "GOOGLE_CLIENT_ID";
      if (key === "clientSecret") return "GOOGLE_CLIENT_SECRET";
      if (key === "tokenEncryptionSecret") return "TOKEN_ENCRYPTION_SECRET";
      if (key === "oauthStateSecret") return "OAUTH_STATE_SECRET";
      if (key === "firebaseProjectId") return "FIREBASE_PROJECT_ID";
      if (key === "firebaseServiceAccountJsonBase64") return "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64";
      if (key === "internalApiKey") return "WEBETU_INTERNAL_API_KEY";
      if (key === "centralDataEncryptionSecret") return "CENTRAL_DATA_ENCRYPTION_SECRET";
      return key;
    })
    .join(", ");

  const err = new Error(`Missing required environment: ${names}`) as Error & { status?: number };
  err.status = 500;
  throw err;
}

export function firebaseWebConfig() {
  const firebase = {
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    projectId: config.firebaseProjectId,
    appId: config.firebaseAppId,
  };
  const required = [
    ["FIREBASE_API_KEY", firebase.apiKey],
    ["FIREBASE_AUTH_DOMAIN", firebase.authDomain],
    ["FIREBASE_PROJECT_ID", firebase.projectId],
    ["FIREBASE_APP_ID", firebase.appId],
    ["FIREBASE_EMAIL_LINK_URL", config.firebaseEmailLinkUrl],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  return {
    configured: missing.length === 0,
    missing,
    firebase,
    emailLinkUrl: config.firebaseEmailLinkUrl,
  };
}
