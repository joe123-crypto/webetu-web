import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { runAfterResponse } from "@/src/lib/after";
import type { BackendProbeReason } from "@/src/lib/utils";

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

type Probe = { at: number; reachable: boolean; reason: BackendProbeReason };

let cached: Probe | null = null;
/** Collapses concurrent requests that all miss the cache into a single probe. */
let inFlight: Promise<Probe> | null = null;

/**
 * Ask the worker whether it is alive. `GET /healthz` is its only unauthenticated
 * route and reads no state, which makes it the cheapest honest liveness signal.
 *
 * Anything other than a 2xx carrying `{"ok": true}` counts as unreachable, so a
 * tunnel interstitial or an HTML error page fails safe rather than reading as up.
 *
 * The `reason` is for the downtime alert email, never for the response body. Only the
 * error's *class* survives a thrown probe -- its message can carry the base URL or a
 * resolved address, and that would then travel to an inbox.
 */
async function probe(): Promise<{ reachable: boolean; reason: BackendProbeReason }> {
  if (!config.webetuApiBaseUrl) return { reachable: false, reason: "not_configured" };
  try {
    const res = await fetch(`${config.webetuApiBaseUrl}/healthz`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { reachable: false, reason: `http_${res.status}` };
    const body = await res.json().catch(() => null);
    return body?.ok === true
      ? { reachable: true, reason: "ok" }
      : { reachable: false, reason: "bad_body" };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return {
      reachable: false,
      reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error",
    };
  }
}

/** A probe result, plus whether this call is the one that actually fetched it. */
async function currentProbe(): Promise<{ probe: Probe; fresh: boolean }> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return { probe: cached, fresh: false };
  if (inFlight) return inFlight.then((probe) => ({ probe, fresh: false }));

  inFlight = probe()
    .then(({ reachable, reason }) => {
      cached = { at: Date.now(), reachable, reason };
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight.then((probe) => ({ probe, fresh: true }));
}

/**
 * Hand a probe outcome to the downtime-alert bookkeeping, after the response has gone out.
 *
 * Only freshly fetched probes are reported. A cache hit is not new evidence, so counting
 * one would let a single visitor hitting refresh inflate the consecutive-failure count on
 * its own -- and skipping them bounds Firestore writes to at most one transaction per
 * instance per cache window, however many browsers are polling.
 *
 * The import is dynamic on purpose. It keeps firebase-admin out of the module graph of the
 * app's hottest unauthenticated route, which matters for cold-start latency and for this
 * route staying importable in tests.
 */
function scheduleAlertBookkeeping(result: Probe) {
  runAfterResponse(async () => {
    const { recordBackendProbe } = await import("@/src/domains/alerts");
    await recordBackendProbe({
      reachable: result.reachable,
      reason: result.reason,
      at: result.at,
    });
  });
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
 * code, no error text -- because the route needs no auth to be useful. The alert
 * path below is deliberately invisible to it: scheduling is synchronous and does no
 * I/O, so the response is not delayed, and nothing it learns reaches the body.
 */
export async function GET() {
  const { probe: result, fresh } = await currentProbe();
  if (fresh) scheduleAlertBookkeeping(result);
  return NextResponse.json(
    { ok: true, reachable: result.reachable, checkedAt: new Date(result.at).toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
