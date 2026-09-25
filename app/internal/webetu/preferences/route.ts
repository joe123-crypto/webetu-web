import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { getWebetuPreferencesForUid } from "@/src/domains/webetu";
import { validateFirebaseUid } from "@/src/lib/utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const uid = req.nextUrl.searchParams.get("uid");
    if (!uid) throw new Error("Missing uid query parameter");
    const safeUid = validateFirebaseUid(uid);
    const result = await getWebetuPreferencesForUid(safeUid);
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
