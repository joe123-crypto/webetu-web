import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Placeholder: Google OAuth token revoke endpoint.
export async function POST() {
  return NextResponse.json({ ok: true });
}
