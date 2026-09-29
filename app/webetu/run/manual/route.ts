import { NextRequest, NextResponse } from "next/server";
import { config } from "@/src/config";
import { verifyFirebaseRequest } from "@/src/security/session";

export const runtime = "nodejs";
// The agent performs a full reservation run (3 meals/day for 3 days) synchronously,
// which can take a while, so allow a long serverless execution window.
export const maxDuration = 300;

const FETCH_TIMEOUT_MS = 290_000;

// Proxy a manual reservation run to the backend agent and forward its outcome to the
// browser. Authenticates the incoming request via Firebase, then calls the agent with
// the internal API key. Never leaks the key or backend URL to the client.
export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);

    if (!config.webetuApiBaseUrl || !config.internalApiKey) {
      return NextResponse.json(
        { ok: false, error: "Reservation service is not configured." },
        { status: 503 }
      );
    }

    const res = await fetch(
      `${config.webetuApiBaseUrl}/api/webetu/users/${encodeURIComponent(decoded.uid)}/trigger-run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.internalApiKey}`,
          "content-type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );

    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok === false) {
      const message =
        (body && typeof body.error === "string" && body.error) ||
        "Reservation run failed.";
      const status = res.ok ? 502 : res.status;
      return NextResponse.json({ ok: false, error: message }, { status });
    }

    return NextResponse.json(body);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
