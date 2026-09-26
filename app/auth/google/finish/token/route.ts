import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { config, requireConfig, assertPublicBaseUrl, TOKEN_URL } from "@/src/config";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

// Google's token endpoint normally answers in well under a second; cap the wait so
// a network stall surfaces as a clear error instead of hanging the request.
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

// Exchanges a Google OAuth authorization code for an OpenID Connect id_token.
// The finish page hands that id_token to the Firebase client SDK
// (signInWithCredential) to establish both the client auth state and, via
// /auth/session, the server session cookie. Only the id_token is returned to the
// browser; the access/refresh tokens never leave the server.
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  let stage = "read_request";
  try {
    assertPublicBaseUrl();
    requireConfig(["clientId", "clientSecret"]);

    const body = await req.json().catch(() => ({}));
    const code = String(body.code ?? "").trim();
    if (!code) throw httpError(400, "Authorization code is required.");

    const params = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    });

    stage = "google_token_request";
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
      });
    } catch (netErr: unknown) {
      // fetch() rejects (network down, DNS, TLS, timeout) without an HTTP status.
      // undici hides the real reason in `.cause`; pull it out so logs are actionable.
      const cause = (netErr as { cause?: { code?: string } })?.cause;
      const reason =
        (netErr as Error)?.name === "TimeoutError"
          ? `timed out after ${TOKEN_EXCHANGE_TIMEOUT_MS}ms`
          : cause?.code || (netErr as Error)?.message || "network error";
      throw httpError(502, `Could not reach Google's token endpoint (${reason}).`);
    }

    stage = "parse_google_response";
    const tokens = (await tokenResponse.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenResponse.ok || !tokens.id_token) {
      const detail = tokens.error_description || tokens.error || "Google rejected the authorization code.";
      throw httpError(502, `Google token exchange failed: ${detail}`);
    }

    return NextResponse.json({ ok: true, id_token: tokens.id_token });
  } catch (err: unknown) {
    const error = err as Error & { status?: number; code?: string };
    const status = error.status ?? 500;
    console.error("Google token exchange failed", {
      requestId,
      stage,
      status,
      error: error.message,
      code: error.code ?? error.name,
    });
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error", requestId },
      { status }
    );
  }
}
