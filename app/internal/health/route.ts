import { NextRequest, NextResponse } from "next/server";
import { config } from "@/src/config";
import { verifyInternalApiKey } from "@/src/security/session";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 10_000;

type WebetuRunStatus = {
  status: "success" | "partial" | "failed" | "system_failure" | "skipped" | null;
  systemError: string | null;
  processed: number | null;
  skipped: number | null;
  failures: number | null;
  lastRunAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
};

const ALLOWED_STATUSES = ["success", "partial", "failed", "system_failure", "skipped"] as const;

function normalizeStatus(value: unknown): WebetuRunStatus["status"] {
  return typeof value === "string" && (ALLOWED_STATUSES as readonly string[]).includes(value)
    ? (value as WebetuRunStatus["status"])
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function fetchWebetuRunStatus(): Promise<WebetuRunStatus | null> {
  if (!config.webetuApiBaseUrl || !config.internalApiKey) return null;
  try {
    const res = await fetch(`${config.webetuApiBaseUrl}/api/webetu/run-status`, {
      headers: { Authorization: `Bearer ${config.internalApiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || body.ok === false) return null;
    return {
      status: normalizeStatus(body.status),
      systemError: stringOrNull(body.systemError),
      processed: numberOrNull(body.processed),
      skipped: numberOrNull(body.skipped),
      failures: numberOrNull(body.failures),
      lastRunAt: stringOrNull(body.lastRunAt),
      finishedAt: stringOrNull(body.finishedAt),
      nextRunAt: stringOrNull(body.nextRunAt),
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
    const reservation = await fetchWebetuRunStatus();
    return NextResponse.json({ ok: true, reachable: reservation !== null, reservation });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status: error.status ?? 500 },
    );
  }
}
