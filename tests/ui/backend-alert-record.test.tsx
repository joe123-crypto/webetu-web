import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_ALERT_MIN_OUTAGE_MS } from "@/src/lib/utils";

// recordBackendProbe is the only place that touches Firestore, so this file stands in a
// fake for it. Nothing else in tests/ mocks firebase-admin -- the pure decision logic is
// covered in backend-alert.test.tsx; what is left to prove here is the orchestration: the
// guards that must run *before* any Firestore access, and that the commit and the email
// stay in the right order.
const state = vi.hoisted(() => ({
  doc: undefined as Record<string, unknown> | undefined,
  writes: [] as Record<string, unknown>[],
  dbCalls: 0,
  transactions: 0,
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
        return fn({
          get: async () => ({ exists: state.doc !== undefined, data: () => state.doc }),
          set: (_ref: unknown, data: Record<string, unknown>) => {
            state.writes.push(data);
            // merge: true
            state.doc = { ...(state.doc ?? {}), ...data };
          },
        });
      },
    };
  },
}));

const sendBackendAlertEmail = vi.hoisted(() =>
  vi.fn(async (_ctx: Record<string, unknown>) => {}),
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
  sendBackendAlertEmail.mockClear();
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
    // Committing `alerted: true` for mail that could never be delivered would mute the
    // outage entirely -- worse than not alerting.
    vi.stubEnv("ALERT_EMAIL_TO", "owner@example.com");
    vi.stubEnv("RESEND_API_KEY", "");
    const record = await loadRecorder();

    await record({ reachable: false, reason: "network_error", at: NOW });

    expect(state.dbCalls).toBe(0);
    expect(state.doc).toBeUndefined();
    expect(sendBackendAlertEmail).not.toHaveBeenCalled();
  });

  it("treats a missing base URL as a misconfiguration, not an outage", async () => {
    // Otherwise a preview deployment reports a permanent outage on every visit.
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
    // The marker is committed, which is what silences every later probe in this outage.
    expect(state.doc).toMatchObject({ alerted: true });
  });

  it("sends exactly one email across a long outage", async () => {
    enableAlerting();
    const record = await loadRecorder();

    for (let i = 0; i < 25; i += 1) {
      await record({ reachable: false, reason: "network_error", at: NOW + i * 20_000 });
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
    await record({ reachable: false, reason: "timeout", at: secondOutageAt + BACKEND_ALERT_MIN_OUTAGE_MS });
    expect(sendBackendAlertEmail).toHaveBeenCalledTimes(2);
  });

  it("stamps a server timestamp alongside the plain millis", async () => {
    // The millis drive every comparison; updatedAt exists so the doc reads well in the
    // Firebase console.
    enableAlerting();
    const record = await loadRecorder();

    await record({ reachable: true, reason: "ok", at: NOW });

    expect(state.writes[0]).toMatchObject({ updatedAt: "__SERVER_TIMESTAMP__", updatedAtMs: NOW });
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

  it("swallows a send failure", async () => {
    enableAlerting();
    sendBackendAlertEmail.mockRejectedValueOnce(new Error("resend exploded"));
    const record = await loadRecorder();

    await record({ reachable: false, reason: "timeout", at: NOW });
    await expect(
      record({ reachable: false, reason: "timeout", at: NOW + BACKEND_ALERT_MIN_OUTAGE_MS }),
    ).resolves.toBeUndefined();
  });
});
