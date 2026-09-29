import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { markOnboardingCompleted } from "@/src/domains/users";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    await markOnboardingCompleted(decoded.uid);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
