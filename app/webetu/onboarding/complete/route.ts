import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { getOnboardingProgress, markOnboardingCompleted } from "@/src/domains/users";
import { isOnboardingComplete } from "@/src/lib/onboarding";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const progress = await getOnboardingProgress(decoded.uid);
    if (!isOnboardingComplete(progress)) {
      return NextResponse.json(
        { ok: false, error: "Save your Webetu credentials and choose a restaurant before finishing." },
        { status: 409 }
      );
    }
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
