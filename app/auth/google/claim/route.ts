import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Placeholder: Google claim endpoint for pending OAuth tokens.
// A later agent implements full Gmail token claim logic.
export async function POST() {
  return NextResponse.json({ ok: true, claimed: false, reason: "not_implemented" });
}
