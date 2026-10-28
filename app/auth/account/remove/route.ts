import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { authorizeAccountRemoval, removeAccount } from "@/src/domains/account-removal";
import { assertSameOriginJsonRequest, clearSessionCookieHeader, parseCookies } from "@/src/security/session";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  let started = false;
  try {
    assertSameOriginJsonRequest(req);
    const body = await req.json().catch(() => ({}));
    if (body.confirmation !== "DELETE") throw httpError(400, "Type DELETE to confirm permanent account removal.");
    const session = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE_NAME];
    if (!session) throw httpError(401, "Sign in before removing your account.");
    const uid = await authorizeAccountRemoval(session);
    started = true;
    await removeAccount(uid);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.headers.set("Set-Cookie", clearSessionCookieHeader());
    return response;
  } catch (err) {
    const error = err as Error & { status?: number; code?: string };
    console.error("Account removal incomplete", { requestId, started, code: error.code ?? error.name });
    return NextResponse.json({
      ok: false,
      error: started
        ? "Account removal is incomplete. Some data may already be deleted and access may be disabled. Retry removal here. If it keeps failing, contact support with this reference: " + requestId
        : error.status ? error.message : "Could not verify account removal. Please try again.",
      requestId,
    }, { status: error.status ?? 500, headers: { "Cache-Control": "no-store" } });
  }
}
