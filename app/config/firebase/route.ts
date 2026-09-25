import { NextResponse } from "next/server";
import { firebaseWebConfig } from "@/src/config";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(firebaseWebConfig());
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
