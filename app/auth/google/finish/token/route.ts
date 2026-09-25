import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Placeholder: Hands the finish page Google's id_token so it can create a Firebase session.
// Full implementation requires pending-token storage (Firestore or Redis).
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Google sign-in token exchange is not yet implemented. Please use the email magic link." },
    { status: 501 }
  );
}
