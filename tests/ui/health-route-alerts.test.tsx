import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_BASE_URL = "http://127.0.0.1:8787";

// Capture the work /health schedules instead of running it. Keeping it unexecuted is the
// point: these tests are about *what gets scheduled*, and the real task reaches Firestore.
const { scheduled } = vi.hoisted(() => ({ scheduled: [] as Array<() => Promise<void> | void> }));

vi.mock("@/src/lib/after", () => ({
  runAfterResponse: (task: () => Promise<void> | void) => {
    scheduled.push(task);
  },
}));

async function loadRoute() {
  vi.resetModules();
  const mod = await import("@/app/health/route");
  return mod.GET;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  scheduled.length = 0;
  vi.stubEnv("WEBETU_API_BASE_URL", TEST_BASE_URL);
});

describe("GET /health alert bookkeeping", () => {
  it("still answers with exactly the three public fields", async () => {
    // The probe now carries a `reason` for the email. It must never reach the body.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`getaddrinfo ${TEST_BASE_URL}`)));
    const GET = await loadRoute();

    const body = await (await GET()).json();

    expect(Object.keys(body).sort()).toEqual(["checkedAt", "ok", "reachable"]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("network_error");
    expect(text).not.toContain(TEST_BASE_URL);
  });

  it("schedules bookkeeping for a freshly fetched probe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const GET = await loadRoute();

    await GET();

    expect(scheduled).toHaveLength(1);
  });

  it("schedules nothing extra for requests served from the probe cache", async () => {
    // Without this gate one visitor hitting refresh would inflate the consecutive-failure
    // count on its own, and every request would cost a Firestore transaction.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 503)));
    const GET = await loadRoute();

    await GET();
    await GET();
    await GET();

    expect(scheduled).toHaveLength(1);
  });

  it("schedules once for concurrent requests that share one probe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const GET = await loadRoute();

    await Promise.all([GET(), GET(), GET()]);

    expect(scheduled).toHaveLength(1);
  });

  it("schedules again once the cache window has passed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 503)));
    const GET = await loadRoute();

    await GET();
    vi.advanceTimersByTime(11_000);
    await GET();

    expect(scheduled).toHaveLength(2);
    vi.useRealTimers();
  });

  it("passes the probe outcome and a coarse reason to the bookkeeping", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 502)));
    const GET = await loadRoute();
    const recordBackendProbe = vi.fn();
    vi.doMock("@/src/domains/alerts", () => ({ recordBackendProbe }));

    await GET();
    await scheduled[0]!();

    expect(recordBackendProbe).toHaveBeenCalledTimes(1);
    const [arg] = recordBackendProbe.mock.calls[0];
    expect(arg).toMatchObject({ reachable: false, reason: "http_502" });
    expect(typeof arg.at).toBe("number");
    vi.doUnmock("@/src/domains/alerts");
  });

  it("reports a timeout distinctly from a refused connection", async () => {
    const timeout = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
    const GET = await loadRoute();
    const recordBackendProbe = vi.fn();
    vi.doMock("@/src/domains/alerts", () => ({ recordBackendProbe }));

    await GET();
    await scheduled[0]!();

    expect(recordBackendProbe.mock.calls[0][0]).toMatchObject({ reason: "timeout" });
    vi.doUnmock("@/src/domains/alerts");
  });

  it("flags a missing base URL as a misconfiguration rather than an outage", async () => {
    vi.stubEnv("WEBETU_API_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const GET = await loadRoute();
    const recordBackendProbe = vi.fn();
    vi.doMock("@/src/domains/alerts", () => ({ recordBackendProbe }));

    await GET();
    await scheduled[0]!();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordBackendProbe.mock.calls[0][0]).toMatchObject({ reason: "not_configured" });
    vi.doUnmock("@/src/domains/alerts");
  });
});

describe("runAfterResponse", () => {
  it("does not throw when there is no request scope", async () => {
    // Route handlers are called directly in tests and from scripts, where next/server's
    // `after` throws. A status badge must never 500 over optional work.
    vi.resetModules();
    vi.doUnmock("@/src/lib/after");
    const { runAfterResponse } = await import("@/src/lib/after");

    expect(() => runAfterResponse(() => Promise.reject(new Error("boom")))).not.toThrow();
  });
});
