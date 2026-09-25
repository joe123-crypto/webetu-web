import { NextRequest, NextResponse } from "next/server";
import { upsertDashboardTaskStatus } from "@/src/domains/dashboard";
import { verifyInternalApiKey } from "@/src/security/session";
import { sendReservationResultEmail } from "@/src/lib/email";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const body = await req.json().catch(() => ({}));
    const result = await upsertDashboardTaskStatus(body);

    // After a successful reserve_meals upsert, send a result email best-effort.
    if (result.taskId === "reserve_meals") {
      sendReservationResultEmail({
        userId: result.userId,
        lastRunStatus: typeof body.lastRunStatus === "string" ? body.lastRunStatus : null,
        lastRunSummary: typeof body.lastRunSummary === "string" ? body.lastRunSummary : null,
      }).catch(() => {
        // already swallowed inside sendReservationResultEmail, but be safe
      });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status: error.status ?? 500 },
    );
  }
}
