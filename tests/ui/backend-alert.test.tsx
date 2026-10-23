import { describe, expect, it } from "vitest";
import {
  backendAlertDecision,
  backendProbeReasonLabel,
  formatDurationShort,
  BACKEND_ALERT_MIN_OUTAGE_MS,
  BACKEND_ALERT_STALE_STATE_MS,
  BACKEND_ALERT_MAX_SEND_ATTEMPTS,
  type BackendAlertStoredState,
} from "@/src/lib/utils";
import { backendAlertSubject, buildBackendAlertHtml } from "@/src/lib/email";

const NOW = 1_800_000_000_000;

/** A record whose last observed outcome was a failure: an outage in progress. */
function down(overrides: Partial<BackendAlertStoredState> = {}): BackendAlertStoredState {
  return {
    reachable: false,
    consecutiveFailures: 1,
    firstFailureAtMs: NOW,
    alerted: false,
    sendAttempts: 0,
    updatedAtMs: NOW,
    ...overrides,
  };
}

/** A record whose last observed outcome was a success. */
function up(overrides: Partial<BackendAlertStoredState> = {}): BackendAlertStoredState {
  return {
    reachable: true,
    consecutiveFailures: 0,
    firstFailureAtMs: null,
    alerted: false,
    sendAttempts: 0,
    updatedAtMs: NOW,
    ...overrides,
  };
}

describe("backendAlertDecision", () => {
  it("counts a first failure without alerting", () => {
    const d = backendAlertDecision({ now: NOW, reachable: false, stored: null });
    expect(d.shouldAlert).toBe(false);
    expect(d.next.consecutiveFailures).toBe(1);
    expect(d.next.firstFailureAtMs).toBe(NOW);
    expect(d.next.alerted).toBe(false);
  });

  it("starts a new outage when the last thing seen was a success", () => {
    const d = backendAlertDecision({
      now: NOW + 60_000,
      reachable: false,
      stored: up({ consecutiveFailures: 9, alerted: true }),
    });
    // Nothing is inherited from before the recovery.
    expect(d.next.consecutiveFailures).toBe(1);
    expect(d.next.alerted).toBe(false);
    expect(d.next.firstFailureAtMs).toBe(NOW + 60_000);
    expect(d.shouldAlert).toBe(false);
  });

  it("alerts once the count and the minimum observed span are both met", () => {
    const d = backendAlertDecision({
      now: NOW + BACKEND_ALERT_MIN_OUTAGE_MS,
      reachable: false,
      stored: down({ consecutiveFailures: 1, firstFailureAtMs: NOW }),
    });
    expect(d.shouldAlert).toBe(true);
    expect(d.failureCount).toBe(2);
    expect(d.outageStartedAtMs).toBe(NOW);
    expect(d.next.alerted).toBe(true);
    expect(d.next.sendAttempts).toBe(1);
  });

  it("does not alert when the count is met but the observed span is too short", () => {
    // Two instances can push the shared counter to the threshold within a second; that is
    // a blip, and the span guard is the only thing that tells them apart.
    const d = backendAlertDecision({
      now: NOW + 500,
      reachable: false,
      stored: down({ consecutiveFailures: 1, firstFailureAtMs: NOW }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.next.consecutiveFailures).toBe(2);
  });

  it("stays silent for every later failure in the same outage", () => {
    const d = backendAlertDecision({
      now: NOW + 10 * 60_000,
      reachable: false,
      stored: down({ consecutiveFailures: 9, firstFailureAtMs: NOW, alerted: true, sendAttempts: 1 }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.next.alerted).toBe(true);
    expect(d.next.sendAttempts).toBe(1);
  });

  it("clears the counters and the flag on a reachable probe, without alerting", () => {
    const d = backendAlertDecision({
      now: NOW,
      reachable: true,
      stored: down({ consecutiveFailures: 4, firstFailureAtMs: NOW - 60_000, alerted: true }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.next).toEqual({
      consecutiveFailures: 0,
      firstFailureAtMs: null,
      alerted: false,
      sendAttempts: 0,
    });
    expect(d.outageStartedAtMs).toBe(NOW - 60_000);
  });

  // --- The three regressions the first implementation got wrong -------------------------

  it("alerts when the two failures are far apart in time (sparse traffic)", () => {
    // Regression: the first implementation discarded any record older than 15 minutes, so
    // visitors arriving further apart than that each reset the count to 1 and a
    // continuously-down backend was NEVER reported.
    const first = backendAlertDecision({ now: NOW, reachable: false, stored: null });
    expect(first.shouldAlert).toBe(false);

    const twentyMinutesLater = NOW + 20 * 60_000;
    const second = backendAlertDecision({
      now: twentyMinutesLater,
      reachable: false,
      stored: { reachable: false, ...first.next, updatedAtMs: NOW },
    });

    expect(second.shouldAlert).toBe(true);
    expect(second.failureCount).toBe(2);
    // The outage is still dated from the first failure actually observed.
    expect(second.outageStartedAtMs).toBe(NOW);
  });

  it("does not send a second email when traffic resumes after a long gap", () => {
    // Regression: staleness used to clear `alerted` along with everything else, so a
    // traffic gap mid-outage produced a second email for the same outage.
    const alerted = down({ consecutiveFailures: 2, firstFailureAtMs: NOW, alerted: true, sendAttempts: 1 });

    const afterGap = backendAlertDecision({
      now: NOW + 60 * 60_000,
      reachable: false,
      stored: { ...alerted, updatedAtMs: NOW + 60_000 },
    });
    expect(afterGap.shouldAlert).toBe(false);

    const nextProbe = backendAlertDecision({
      now: NOW + 60 * 60_000 + 20_000,
      reachable: false,
      stored: { reachable: false, ...afterGap.next, updatedAtMs: NOW + 60 * 60_000 },
    });
    expect(nextProbe.shouldAlert).toBe(false);
  });

  it("alerts again for a genuinely separate outage after a recovery", () => {
    const recovered = backendAlertDecision({
      now: NOW,
      reachable: true,
      stored: down({ consecutiveFailures: 3, firstFailureAtMs: NOW - 60_000, alerted: true, sendAttempts: 1 }),
    });

    const downAgain = NOW + 10_000;
    const first = backendAlertDecision({
      now: downAgain,
      reachable: false,
      stored: { reachable: true, ...recovered.next, updatedAtMs: NOW },
    });
    expect(first.shouldAlert).toBe(false);

    const second = backendAlertDecision({
      now: downAgain + BACKEND_ALERT_MIN_OUTAGE_MS,
      reachable: false,
      stored: { reachable: false, ...first.next, updatedAtMs: downAgain },
    });
    expect(second.shouldAlert).toBe(true);
  });

  // --------------------------------------------------------------------------------------

  it("stops retrying a failing send after the attempt cap", () => {
    const d = backendAlertDecision({
      now: NOW + BACKEND_ALERT_MIN_OUTAGE_MS,
      reachable: false,
      stored: down({
        consecutiveFailures: 5,
        firstFailureAtMs: NOW,
        // Marker was given back after each failed send, so `alerted` is false again.
        alerted: false,
        sendAttempts: BACKEND_ALERT_MAX_SEND_ATTEMPTS,
      }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.next.sendAttempts).toBe(BACKEND_ALERT_MAX_SEND_ATTEMPTS);
  });

  it("still retries while under the attempt cap", () => {
    const d = backendAlertDecision({
      now: NOW + BACKEND_ALERT_MIN_OUTAGE_MS,
      reachable: false,
      stored: down({
        consecutiveFailures: 3,
        firstFailureAtMs: NOW,
        alerted: false,
        sendAttempts: 1,
      }),
    });
    expect(d.shouldAlert).toBe(true);
    expect(d.next.sendAttempts).toBe(2);
  });

  it("abandons an absurdly old record rather than trusting its flag forever", () => {
    const ancient = NOW - BACKEND_ALERT_STALE_STATE_MS - 1;
    const d = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: down({ consecutiveFailures: 7, firstFailureAtMs: ancient, alerted: true, updatedAtMs: ancient }),
    });
    expect(d.next.consecutiveFailures).toBe(1);
    expect(d.next.alerted).toBe(false);
    expect(d.outageStartedAtMs).toBe(NOW);
  });

  it("keeps a record that is merely old, up to the safety net", () => {
    // The whole point of the redesign: hours of quiet must not reset a real outage.
    const hoursAgo = NOW - 6 * 60 * 60_000;
    const d = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: down({ consecutiveFailures: 1, firstFailureAtMs: hoursAgo, updatedAtMs: hoursAgo }),
    });
    expect(d.shouldAlert).toBe(true);
    expect(d.failureCount).toBe(2);
  });

  it("treats malformed, negative and future stored values as absent", () => {
    for (const bad of [Number.NaN, -5, Infinity, "3" as unknown as number, null, undefined]) {
      const d = backendAlertDecision({
        now: NOW,
        reachable: false,
        stored: down({ consecutiveFailures: bad }),
      });
      expect(d.next.consecutiveFailures).toBe(1);
      expect(d.shouldAlert).toBe(false);
    }
    // A future updatedAtMs (clock skew) abandons the record rather than locking out.
    const skewed = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: down({ consecutiveFailures: 5, alerted: true, updatedAtMs: NOW + 60_000 }),
    });
    expect(skewed.next.consecutiveFailures).toBe(1);
    expect(skewed.next.alerted).toBe(false);
  });

  it("never reports a negative observed span when the stored start is in the future", () => {
    const d = backendAlertDecision({
      now: NOW,
      reachable: false,
      stored: down({ consecutiveFailures: 1, firstFailureAtMs: NOW + 90_000 }),
    });
    expect(d.shouldAlert).toBe(false);
    expect(d.outageStartedAtMs).toBe(NOW);
  });

  it("only alerts once across a long run of failing probes", () => {
    // Walk a real outage forward a probe at a time and count the emails. Steps of 20
    // minutes, deliberately far longer than any short-lived window, so a time-based reset
    // would show up here as extra emails.
    let state: BackendAlertStoredState | null = null;
    let alerts = 0;
    for (let i = 0; i < 30; i += 1) {
      const now = NOW + i * 20 * 60_000;
      const d = backendAlertDecision({ now, reachable: false, stored: state });
      if (d.shouldAlert) alerts += 1;
      state = { reachable: false, ...d.next, updatedAtMs: now };
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
    expect(html).toContain("Failed probes seen:</strong> 3");
    expect(html).toContain(new Date(ctx.detectedAtMs).toISOString());
    expect(html).toContain(new Date(ctx.outageStartedAtMs).toISOString());
    expect(html).toContain("4m 00s");
    expect(html).toContain("timed out");
  });

  it("describes the span as observed samples, never as a measured outage", () => {
    // The backend is only probed when someone loads the app, so it may have recovered and
    // failed again between two observed failures. The email must not claim otherwise.
    const html = buildBackendAlertHtml(ctx);
    expect(html).toContain("First failure seen");
    expect(html).toContain("Failures seen across");
    expect(html).toContain("samples rather than monitoring");
    expect(html).not.toMatch(/Down for|Outage started/);
  });

  it("says that no further email is coming, so silence is not read as recovery", () => {
    expect(buildBackendAlertHtml(ctx)).toContain("No further email will be sent for this outage");
  });

  it("matches the house footer", () => {
    expect(buildBackendAlertHtml(ctx)).toContain("This is an automated notification from");
  });

  it("omits the span rows when no start time is known", () => {
    const html = buildBackendAlertHtml({ ...ctx, outageStartedAtMs: null });
    expect(html).not.toContain("First failure seen");
    expect(html).not.toContain("Failures seen across");
  });

  it("escapes an unexpected reason rather than injecting it", () => {
    const html = buildBackendAlertHtml({ ...ctx, reason: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
  });

  it("leaks no secret into the body", () => {
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
