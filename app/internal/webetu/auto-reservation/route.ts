import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { getWebetuAutoReservationForUid } from "@/src/domains/webetu";
import { validateFirebaseUid } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) throw new Error("Missing userId query parameter");
    const safeUid = validateFirebaseUid(userId);
    const result = await getWebetuAutoReservationForUid(safeUid);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
