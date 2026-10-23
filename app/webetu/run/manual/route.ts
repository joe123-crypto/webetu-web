import { NextRequest, NextResponse } from "next/server";
import { config } from "@/src/config";
import { verifyFirebaseRequest } from "@/src/security/session";
import {
  claimWebetuManualRun,
  getWebetuCredentialStatus,
  releaseWebetuManualRun,
} from "@/src/domains/webetu";

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

    // Only accounts with saved (and therefore verified) Webetu credentials may run.
    // The cooldown below is per account and accounts are free to create, so without
    // this, throwaway accounts could keep the backend's few run slots busy and lock
    // real users out. A throwaway account cannot pass verification.
    const credentials = await getWebetuCredentialStatus(decoded.uid);
    if (!credentials.configured) {
      return NextResponse.json(
        { ok: false, error: "Save your Webetu credentials before starting a run." },
        { status: 409 }
      );
    }

    // One run per user per cooldown: each run holds a backend worker for minutes and
    // logs in to Webetu, so an unthrottled button could take the backend down.
    await claimWebetuManualRun(decoded.uid);

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
      // 409/429 mean the backend never started this run, so don't charge the cooldown.
      if (status === 409 || status === 429) {
        await releaseWebetuManualRun(decoded.uid).catch(() => {});
      }
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
