import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import {
  getWebetuAutoReservationForUid,
  setWebetuAutoReservationForUid,
} from "@/src/domains/webetu";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const result = await getWebetuAutoReservationForUid(decoded.uid);
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

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const body = await req.json().catch(() => ({}));
    const result = await setWebetuAutoReservationForUid(decoded.uid, body.enabled);
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
