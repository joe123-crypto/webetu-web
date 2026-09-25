import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { setWebetuDefaultRestaurantForUid } from "@/src/domains/webetu";
import { validateFirebaseUid } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    const safeUid = validateFirebaseUid(body.uid);
    const result = await setWebetuDefaultRestaurantForUid(safeUid, body.restaurant);
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
