import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_ALERT_MIN_OUTAGE_MS, BACKEND_ALERT_MAX_SEND_ATTEMPTS } from "@/src/lib/utils";

// recordBackendProbe is the only place that touches Firestore, so this file stands in a
// fake for it. The pure decision logic is covered in backend-alert.test.tsx; what is left
// to prove here is the orchestration: the guards that must run *before* any Firestore
// access, the commit-then-send ordering, the retry when a send fails, and that a losing
// instance in a race re-reads and stays quiet.
const state = vi.hoisted(() => ({
  doc: undefined as Record<string, unknown> | undefined,
  writes: [] as Record<string, unknown>[],
  dbCalls: 0,
  transactions: 0,
  /** When set, the first transaction runs its callback twice, as a lock conflict would. */
  retryOnce: false,
  /** Runs between the discarded attempt and the retry: another instance committing. */
  onConflict: null as null | (() => void),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__SERVER_TIMESTAMP__" },
}));

vi.mock("@/src/firebase/admin", () => ({
  getFirestoreDb: () => {
    state.dbCalls += 1;
    return {
      collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
      runTransaction: async (fn: (t: unknown) => Promise<void>) => {
        state.transactions += 1;
        const attempts = state.retryOnce ? 2 : 1;
        state.retryOnce = false;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const isFinal = attempt === attempts - 1;
          const buffered: Record<string, unknown>[] = [];
          await fn({
            // Each attempt re-reads, which is the whole point of a retry.
            get: async () => ({ exists: state.doc !== undefined, data: () => state.doc }),
            set: (_ref: unknown, data: Record<string, unknown>) => buffered.push(data),
          });
          if (!isFinal) {
            // The attempt is discarded, then a competing writer commits.
            state.onConflict?.();
            continue;
          }
          for (const data of buffered) {
            state.writes.push(data);
            state.doc = { ...(state.doc ?? {}), ...data };
          }
        }
      },
    };
  },
}));

const sendBackendAlertEmail = vi.hoisted(() =>
  vi.fn(async (_ctx: Record<string, unknown>) => true),
);
vi.mock("@/src/lib/email", () => ({ sendBackendAlertEmail }));

async function loadRecorder() {
  vi.resetModules();
  const mod = await import("@/src/domains/alerts");
  return mod.recordBackendProbe;
}

function enableAlerting() {
  vi.stubEnv("ALERT_EMAIL_TO", "owner@example.com");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("WEBETU_API_BASE_URL", "http://127.0.0.1:8787");
}

const NOW = 1_800_000_000_000;

beforeEach(() => {
  // restoreMocks restores spies but does not unregister the factories above.
  state.doc = undefined;
  state.writes.length = 0;
  state.dbCalls = 0;
  state.transactions = 0;
  state.retryOnce = false;
  state.onConflict = null;
  sendBackendAlertEmail.mockClear();
  sendBackendAlertEmail.mockResolvedValue(true);
});

describe("recordBackendProbe guards", () => {
  it("touches no Firestore and sends nothing without ALERT_EMAIL_TO", async () => {
    vi.stubEnv("ALERT_EMAIL_TO", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const record = await loadRecorder();

    await record({ reachable: false, reason: "network_error", at: NOW });

    expect(state.dbCalls).toBe(0);
    expect(sendBackendAlertEmail).not.toHaveBeenCalled();
  });

  it("touches no Firestore without a Resend key, so no alert is marked sent", async () => {
    vi.stubEnv("ALERT_EMAIL_TO", "owner@example.com");
    vi.stubEnv("RESEND_API_KEY", "");
    const record = await loadRecorder();

    await record({ reachable: false, reason: "network_error", at: NOW });

    expect(state.dbCalls).toBe(0);
    expect(state.doc).toBeUndefined();
    expect(sendBackendAlertEmail).not.toHaveBeenCalled();
  });

  it("treats a missing base URL as a misconfiguration, not an outage", async () => {
    enableAlerting();
    const record = await loadRecorder();

    await record({ reachable: false, reason: "not_configured", at: NOW });

    expect(state.dbCalls).toBe(0);
    expect(sendBackendAlertEmail).not.toHaveBeenCalled();
  });
});

describe("recordBackendProbe bookkeeping", () => {
  it("records a first failure without emailing", async () => {
    enableAlerting();
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW });

    expect(state.transactions).toBe(1);
    expect(state.writes[0]).toMatchObject({
      reachable: false,
      reason: "timeout",
      consecutiveFailures: 1,
      alerted: false,
      updatedAtMs: NOW,
    });
    expect(sendBackendAlertEmail).not.toHaveBeenCalled();
  });

  it("emails once the thresholds are crossed, after the commit", async () => {
    enableAlerting();
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW });
    await record({ reachable: false, reason: "timeout", at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS });

    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(1);
    expect(sendBackendAlertEmail.mock.calls[0][0]).toMatchObject({
      failureCount: 2,
      outageStartedAtMs: NOW,
      reason: "timeout",
    });
    expect(state.doc).toMatchObject({ alerted: true, sendAttempts: 1 });
  });

  it("sends exactly one email across a long outage with sparse traffic", async () => {
    // Steps of 20 minutes: the first implementation reset its counters after 15, so this
    // walk would have produced either no email at all or a stream of them.
    enableAlerting();
    const record = await loadRecorder();

    for (let i = 0; i < 25; i += 1) {
      await record({ reachable: false, reason: "network_error", at: NOW + i * 20 * 60_000 });
    }

    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(1);
  });

  it("clears the record on recovery without emailing, so the next outage alerts", async () => {
    enableAlerting();
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW });
    await record({ reachable: false, reason: "timeout", at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS });
    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(1);

    const recoveredAt = NOW + BACKEND_ALERT_MIN_OUTAGE_MS + 10_000;
    await record({ reachable: true, reason: "ok", at: recoveredAt });
    // No recovery email -- the owner opted out -- but the state must be cleared.
    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(1);
    expect(state.doc).toMatchObject({ reachable: true, consecutiveFailures: 0, alerted: false });
    expect(state.doc?.firstFailureAtMs).toBeNull();

    const secondOutageAt = recoveredAt + 10_000;
    await record({ reachable: false, reason: "timeout", at: secondOutageAt });
    await record({
      reachable: false,
      reason: "timeout",
      at: secondOutageAt + BACKEND_ALERT_MIN_OUTAGE_MS,
    });
    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(2);
  });

  it("stamps a server timestamp alongside the plain millis", async () => {
    enableAlerting();
    const record = await loadRecorder();

    await record({ reachable: true, reason: "ok", at: NOW });

    expect(state.writes[0]).toMatchObject({ updatedAt: "__SERVER_TIMESTAMP__", updatedAtMs: NOW });
  });
});

describe("recordBackendProbe under contention", () => {
  it("sends nothing when another instance won the race and already alerted", async () => {
    // The losing transaction is retried with a fresh read. It must see the winner's
    // marker and stand down -- this is what makes "one email" true across instances.
    enableAlerting();
    state.doc = {
      reachable: false,
      consecutiveFailures: 1,
      firstFailureAtMs: NOW,
      alerted: false,
      sendAttempts: 0,
      updatedAtMs: NOW,
    };
    state.retryOnce = true;
    state.onConflict = () => {
      state.doc = { ...(state.doc ?? {}), consecutiveFailures: 2, alerted: true, sendAttempts: 1 };
    };
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS });

    expect(sendBackendAlertEmail).not.toHaveBeenCalled();
    expect(state.doc).toMatchObject({ alerted: true });
  });
});

describe("recordBackendProbe send failures", () => {
  it("gives the sent marker back so the next probe retries", async () => {
    enableAlerting();
    sendBackendAlertEmail.mockResolvedValue(false);
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW });
    await record({ reachable: false, reason: "timeout", at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS });

    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(1);
    // Marker released, attempt counter kept -- so the next probe tries again, but not forever.
    expect(state.doc).toMatchObject({ alerted: false, sendAttempts: 1 });

    await record({
      reachable: false,
      reason: "timeout",
      at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS + 20_000,
    });
    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(2);
  });

  it("stops retrying at the attempt cap", async () => {
    enableAlerting();
    sendBackendAlertEmail.mockResolvedValue(false);
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW });
    for (let i = 1; i <= BACKEND_ALERT_MAX_SEND_ATTEMPTS + 3; i += 1) {
      await record({
        reachable: false,
        reason: "timeout",
        at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS + i * 20_000,
      });
    }

    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(BACKEND_ALERT_MAX_SEND_ATTEMPTS);
  });

  it("does not resurrect a finished outage when the send failed", async () => {
    // The rollback runs after the main transaction committed, so the world may have moved
    // on. A recovery that landed in between must not be overwritten.
    enableAlerting();
    sendBackendAlertEmail.mockImplementation(async () => {
      state.doc = {
        reachable: true,
        consecutiveFailures: 0,
        firstFailureAtMs: null,
        alerted: false,
        sendAttempts: 0,
        updatedAtMs: NOW + 1_000,
      };
      return false;
    });
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW });
    await record({ reachable: false, reason: "timeout", at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS });

    expect(state.doc).toMatchObject({ reachable: true, consecutiveFailures: 0 });
    expect(state.doc?.firstFailureAtMs).toBeNull();
  });
});

describe("recordBackendProbe never propagates", () => {
  it("swallows a Firestore failure", async () => {
    enableAlerting();
    vi.doMock("@/src/firebase/admin", () => ({
      getFirestoreDb: () => ({
        collection: () => ({ doc: () => ({}) }),
        runTransaction: async () => {
          throw new Error("UNAVAILABLE: firestore is down");
        },
      }),
    }));
    const record = await loadRecorder();

    await expect(record({ reachable: false, reason: "timeout", at: NOW })).resolves.toBeUndefined();
    expect(sendBackendAlertEmail).not.toHaveBeenCalled();
    vi.doUnmock("@/src/firebase/admin");
  });

  it("swallows a send that throws", async () => {
    enableAlerting();
    sendBackendAlertEmail.mockRejectedValueOnce(new Error("resend exploded"));
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW });
    await expect(
      record({ reachable: false, reason: "timeout", at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS }),
    ).resolves.toBeUndefined();
  });
});
