import { NextResponse } from "next/server";
import { config } from "@/src/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * How long one probe result is reused. This route is unauthenticated (the login
 * screen shows the indicator too), so without a cache a flood of requests would
 * become a flood of outbound probes. With it, the worker sees at most one probe
 * per window no matter how many browsers are polling.
 */
const CACHE_TTL_MS = 10_000;

type Probe = { at: number; reachable: boolean };

let cached: Probe | null = null;
/** Collapses concurrent requests that all miss the cache into a single probe. */
let inFlight: Promise<Probe> | null = null;

/**
 * Ask the worker whether it is alive. `GET /healthz` is its only unauthenticated
 * route and reads no state, which makes it the cheapest honest liveness signal.
 *
 * Anything other than a 2xx carrying `{"ok": true}` counts as unreachable, so a
 * tunnel interstitial or an HTML error page fails safe rather than reading as up.
 */
async function probe(): Promise<boolean> {
  if (!config.webetuApiBaseUrl) return false;
  try {
    const res = await fetch(`${config.webetuApiBaseUrl}/healthz`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.ok === true;
  } catch {
    return false;
  }
}

async function currentProbe(): Promise<Probe> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = probe()
    .then((reachable) => {
      cached = { at: Date.now(), reachable };
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Public liveness of the backend worker, for the status indicator in the UI.
 *
 * Always answers 200 so the client can tell the two failure modes apart: a
 * `reachable: false` body means this app is up but the worker is not, while a
 * network error or non-2xx means this app itself is unreachable. Both render as
 * "offline", but only the former is a judgement this route is making.
 *
 * The body carries a boolean and nothing else -- no base URL, no upstream status
 * code, no error text -- because the route needs no auth to be useful.
 */
export async function GET() {
  const { at, reachable } = await currentProbe();
  return NextResponse.json(
    { ok: true, reachable, checkedAt: new Date(at).toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
