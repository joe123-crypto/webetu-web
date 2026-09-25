import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { listWebetuRestaurantCatalog } from "@/src/domains/webetu";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await verifyFirebaseRequest(req);
    const catalog = await listWebetuRestaurantCatalog();
    return NextResponse.json({ catalog });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
