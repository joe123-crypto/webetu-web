import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { signState } from "@/src/security/crypto";
import { config, assertPublicBaseUrl, GOOGLE_SIGNIN_SCOPES, AUTH_URL } from "@/src/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertPublicBaseUrl();
    const decoded = await verifyFirebaseRequest(req);

    const body = await req.json().catch(() => ({}));
    const next = String(body.next ?? "/").trim();
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

    const payload = {
      uid: decoded.uid,
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

    return NextResponse.json({ url: `${AUTH_URL}?${params.toString()}` });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
