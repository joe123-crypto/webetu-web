import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await verifyFirebaseRequest(req);
    return NextResponse.json({ connected: false });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status ?? 401 });
  }
}
