import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginJsonRequest, clearSessionCookieHeader } from "@/src/security/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Keeps other sites from signing users out with a cross-site form post.
    assertSameOriginJsonRequest(req);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status ?? 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookieHeader());
  return response;
}
