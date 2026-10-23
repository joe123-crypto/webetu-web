import { NextRequest, NextResponse } from "next/server";
import { signState } from "@/src/security/crypto";
import { config, assertPublicBaseUrl, GOOGLE_SIGNIN_SCOPES, AUTH_URL } from "@/src/config";
import { googleSigninNonceCookieHeader } from "@/src/security/session";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertPublicBaseUrl();

    const body = await req.json().catch(() => ({}));
    const next = String(body.next ?? "/").trim();
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

    const nonce = crypto.randomBytes(16).toString("base64url");
    const payload = {
      flow: "signin",
      nonce,
      next: safeNext,
      ts: Date.now(),
    };

    const stateStr = signState(payload);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GOOGLE_SIGNIN_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state: stateStr,
    });

    // Bind this sign-in to this browser: /auth/google/finish/token only accepts a
    // code whose state carries the same nonce as this cookie.
    const response = NextResponse.json({ url: `${AUTH_URL}?${params.toString()}` });
    response.headers.set("Set-Cookie", googleSigninNonceCookieHeader(nonce));
    return response;
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
