import { describe, expect, it } from "vitest";
import {
  backendAlertDecision,
  backendProbeReasonLabel,
  formatDurationShort,
  BACKEND_ALERT_MIN_OUTAGE_MS,
  BACKEND_ALERT_STALE_STATE_MS,
  type BackendAlertStoredState,
} from "@/src/lib/utils";
import { backendAlertSubject, buildBackendAlertHtml } from "@/src/lib/email";

const NOW = 1_800_000_000_000;

// A record that is recent enough not to be discarded as stale.
function stored(overrides: Partial<BackendAlertStoredState> = {}): BackendAlertStoredState {
  return { consecutiveFailures: 0, firstFailureAtMs: null, alerted: false, updatedAtMs: NOW, ...overrides };
}

describe("backendAlertDecision", () => {
  it("counts a first failure without alerting", () => {
    const d = backendAlertDecision({ now: NOW, reachable: false, stored: null });
    expect(d.shouldAlert).toBe(false);
    expect(d.next.consecutiveFailures).toBe(1);
    // The clock starts here, which is what the duration threshold is measured from.
    expect(d.next.firstFailureAtMs).toBe(NOW);
    expect(d.next.alerted).toBe(false);
  });

  it("alerts once the count and the minimum outage duration are both met", () => {
    const firstFailureAtMs = NOW - BACKEND_ALERT_MIN_OUTAGE_MS;
    const d = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: stored({ consecutiveFailures: 1, firstFailureAtMs, updatedAtMs: firstFailureAtMs }),
    });
    expect(d.shouldAlert).toBe(true);
    expect(d.failureCount).toBe(2);
    expect(d.outageStartedAtMs).toBe(firstFailureAtMs);
    expect(d.next.alerted).toBe(true);
  });

  it("does not alert when the count is met but the outage is still too short", () => {
    // Two instances can push the shared counter to the threshold within a second; that is
    // a blip, and the duration guard is the only thing that tells them apart.
    const d = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: stored({ consecutiveFailures: 1, firstFailureAtMs: NOW - 500, updatedAtMs: NOW - 500 }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.next.consecutiveFailures).toBe(2);
  });

  it("stays silent for every later failure in the same outage", () => {
    const d = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: stored({
        consecutiveFailures: 9,
        firstFailureAtMs: NOW - 10 * 60_000,
        alerted: true,
        updatedAtMs: NOW - 20_000,
      }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.next.alerted).toBe(true);
  });

  it("clears the counters and the flag on a reachable probe, without alerting", () => {
    const d = backendAlertDecision({
      now: NOW,
      reachable: true,
      stored: stored({ consecutiveFailures: 4, firstFailureAtMs: NOW - 60_000, alerted: true }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.next).toEqual({ consecutiveFailures: 0, firstFailureAtMs: null, alerted: false });
    // Still reported, so a caller could state the duration -- the owner just opted out of
    // receiving a recovery email.
    expect(d.outageStartedAtMs).toBe(NOW - 60_000);
  });

  it("alerts again for a later outage once a success has cleared the flag", () => {
    const recovered = backendAlertDecision({
      now: NOW,
      reachable: true,
      stored: stored({ consecutiveFailures: 3, firstFailureAtMs: NOW - 60_000, alerted: true }),
    });
    const firstFailureAtMs = NOW + 1_000;
    const again = backendAlertDecision({
      now: firstFailureAtMs + BACKEND_ALERT_MIN_OUTAGE_MS,
      reachable: false,
      stored: { ...recovered.next, firstFailureAtMs, consecutiveFailures: 1, updatedAtMs: firstFailureAtMs },
    });
    expect(again.shouldAlert).toBe(true);
  });

  it("discards a stale record so a new outage is not muted by an old flag", () => {
    // The flag is only ever cleared by a successful probe, and alerting is
    // visitor-triggered -- so without this a quiet spell could silence alerts for good.
    const staleAt = NOW - BACKEND_ALERT_STALE_STATE_MS - 1;
    const d = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: stored({ consecutiveFailures: 7, firstFailureAtMs: staleAt, alerted: true, updatedAtMs: staleAt }),
    });
    expect(d.next.consecutiveFailures).toBe(1);
    expect(d.next.alerted).toBe(false);
    // And it reports no invented multi-hour duration.
    expect(d.outageStartedAtMs).toBe(NOW);
  });

  it("treats malformed, negative and future stored values as absent", () => {
    for (const bad of [Number.NaN, -5, Infinity, "3" as unknown as number, null, undefined]) {
      const d = backendAlertDecision({
        now: NOW,
        reachable: false,
        stored: stored({ consecutiveFailures: bad }),
      });
      expect(d.next.consecutiveFailures).toBe(1);
      expect(d.shouldAlert).toBe(false);
    }
    // A future updatedAtMs (clock skew) discards the record rather than locking out.
    const skewed = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: stored({ consecutiveFailures: 5, alerted: true, updatedAtMs: NOW + 60_000 }),
    });
    expect(skewed.next.consecutiveFailures).toBe(1);
    expect(skewed.next.alerted).toBe(false);
  });

  it("never reports a negative outage length when the stored start is in the future", () => {
    const d = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: stored({ consecutiveFailures: 1, firstFailureAtMs: NOW + 90_000 }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.outageStartedAtMs).toBe(NOW);
  });

  it("only alerts once across a run of failing probes", () => {
    // Walk a real outage forward a probe at a time and count the emails.
    let state = stored({ updatedAtMs: NOW - 1 });
    let alerts = 0;
    for (let i = 0; i < 20; i += 1) {
      const now = NOW + i * 20_000;
      const d = backendAlertDecision({ now, reachable: false, stored: state });
      if (d.shouldAlert) alerts += 1;
      state = { ...d.next, updatedAtMs: now };
    }
    expect(alerts).toBe(1);
  });
});

describe("backendProbeReasonLabel", () => {
  it("glosses the known reasons and the http_NNN family", () => {
    expect(backendProbeReasonLabel("timeout")).toContain("timed out");
    expect(backendProbeReasonLabel("network_error")).toContain("Connection refused");
    expect(backendProbeReasonLabel("bad_body")).toContain("tunnel interstitial");
    expect(backendProbeReasonLabel("http_502")).toBe("Upstream answered HTTP 502");
  });

  it("does not echo an unrecognized reason", () => {
    // The gloss is a fixed string, so an unexpected value cannot smuggle upstream text
    // (a resolved address, a token-bearing URL) into the email.
    const label = backendProbeReasonLabel("getaddrinfo ENOTFOUND secret.internal");
    expect(label).toBe("Unreachable for an unrecognized reason");
    expect(label).not.toContain("secret.internal");
  });
});

describe("formatDurationShort", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(formatDurationShort(45_000)).toBe("45s");
    expect(formatDurationShort(4 * 60_000 + 12_000)).toBe("4m 12s");
    expect(formatDurationShort(3 * 3_600_000 + 5 * 60_000)).toBe("3h 05m");
    expect(formatDurationShort(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 04h");
  });

  it("does not invent a duration from a nonsense span", () => {
    expect(formatDurationShort(-1)).toBe("unknown");
    expect(formatDurationShort(Number.NaN)).toBe("unknown");
  });
});

describe("buildBackendAlertHtml", () => {
  const ctx = {
    detectedAtMs: NOW,
    outageStartedAtMs: NOW - 4 * 60_000,
    failureCount: 3,
    reason: "timeout",
  };

  it("carries what the owner needs to triage", () => {
    const html = buildBackendAlertHtml(ctx);
    expect(html).toContain("Backend worker unreachable");
    expect(html).toContain("Consecutive failed probes:</strong> 3");
    expect(html).toContain(new Date(ctx.detectedAtMs).toISOString());
    expect(html).toContain(new Date(ctx.outageStartedAtMs).toISOString());
    expect(html).toContain("4m 00s");
    expect(html).toContain("timed out");
  });

  it("says that no further email is coming, so silence is not read as recovery", () => {
    expect(buildBackendAlertHtml(ctx)).toContain("No further email will be sent for this outage");
  });

  it("matches the house footer", () => {
    expect(buildBackendAlertHtml(ctx)).toContain("This is an automated notification from");
  });

  it("omits the outage rows when no start time is known", () => {
    const html = buildBackendAlertHtml({ ...ctx, outageStartedAtMs: null });
    expect(html).not.toContain("Outage started");
    expect(html).not.toContain("Down for");
  });

  it("escapes an unexpected reason rather than injecting it", () => {
    const html = buildBackendAlertHtml({ ...ctx, reason: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
  });

  it("leaks no secret into the body", () => {
    // The probe target is included on purpose -- /healthz is unauthenticated and it is
    // the one thing identifying which worker. Credentials are not.
    const html = buildBackendAlertHtml(ctx);
    for (const secret of [
      process.env.WEBETU_INTERNAL_API_KEY,
      process.env.RESEND_API_KEY,
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
      process.env.CENTRAL_DATA_ENCRYPTION_SECRET,
    ]) {
      if (secret) expect(html).not.toContain(secret);
    }
    expect(html).not.toMatch(/Authorization|Bearer /i);
  });
});

describe("backendAlertSubject", () => {
  it("names the product and the fault", () => {
    expect(backendAlertSubject()).toMatch(/backend worker unreachable$/);
  });
});
