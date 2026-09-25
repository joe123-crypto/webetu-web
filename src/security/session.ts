import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { getFirebaseAdminAuth } from "@/src/firebase/admin";
import { httpError } from "@/src/lib/utils";
import {
  config,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  GOOGLE_SIGNIN_NONCE_COOKIE,
  GOOGLE_SIGNIN_NONCE_MAX_AGE_SECONDS,
} from "@/src/config";

export function parseCookies(header: string | null | undefined) {
  const map: Record<string, string> = {};
  if (!header) return map;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length > 0) {
      map[key.trim()] = decodeURIComponent(rest.join("=").trim());
    }
  }
  return map;
}

export function serializeCookie(name: string, value: string, options: any = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  // Max-Age=0 is the explicit "delete this cookie" instruction, so it must survive
  // the falsy check that a plain truthiness test would swallow.
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

export function sessionCookieHeader(value: string) {
  return serializeCookie(SESSION_COOKIE_NAME, value, {
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
  });
}

export function clearSessionCookieHeader() {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
  });
}

// SameSite=Lax is deliberate: the browser returns from Google via a top-level
// navigation (so the cookie is sent), while cross-site POSTs to the finish/claim
// endpoints never carry it.
export function googleSigninNonceCookieHeader(value: string) {
  return serializeCookie(GOOGLE_SIGNIN_NONCE_COOKIE, value, {
    maxAge: GOOGLE_SIGNIN_NONCE_MAX_AGE_SECONDS,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
  });
}

export function clearGoogleSigninNonceCookieHeader() {
  return serializeCookie(GOOGLE_SIGNIN_NONCE_COOKIE, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
  });
}

export async function verifyFirebaseIdToken(idToken: string) {
  if (!idToken) throw httpError(401, "No ID token provided.");
  try {
    return await getFirebaseAdminAuth().verifyIdToken(idToken, true);
  } catch (err: any) {
    if (err.code === "auth/id-token-revoked") {
      throw httpError(401, "Token has been revoked.");
    }
    throw httpError(401, "Invalid ID token.");
  }
}

export async function verifyFirebaseSessionCookie(sessionCookie: string) {
  if (!sessionCookie) throw httpError(401, "No session cookie provided.");
  try {
    return await getFirebaseAdminAuth().verifySessionCookie(sessionCookie, true);
  } catch (err: any) {
    throw httpError(401, "Invalid or expired session.");
  }
}

export function extractBearerToken(header: string | null | undefined) {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function verifyFirebaseRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = extractBearerToken(authHeader);
  if (bearer) return verifyFirebaseIdToken(bearer);

  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if (sessionCookie) return verifyFirebaseSessionCookie(sessionCookie);

  throw httpError(401, "Unauthorized: missing bearer token or session cookie.");
}

export function verifyInternalApiKey(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = extractBearerToken(authHeader);
  if (!bearer) throw httpError(401, "Unauthorized: internal API key required.");
  const expected = Buffer.from(config.internalApiKey, "utf8");
  const provided = Buffer.from(bearer, "utf8");
  if (!config.internalApiKey || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw httpError(403, "Forbidden: invalid internal API key.");
  }
}
