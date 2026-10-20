import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_BASE_URL = "http://127.0.0.1:8787";

// config reads WEBETU_API_BASE_URL from process.env at module load, so the env
// has to be stubbed before the route is imported -- same approach as
// internal-health.test.tsx. The route also keeps its last probe in a
// module-level cache, so every test gets a freshly imported copy rather than
// trying to age the cache out with the clock.
let GET: () => Promise<Response>;

async function loadRoute() {
  vi.resetModules();
  const mod = await import("@/app/health/route");
  return mod.GET;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(async () => {
  vi.stubEnv("WEBETU_API_BASE_URL", TEST_BASE_URL);
  GET = await loadRoute();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /health", () => {
  it("probes the worker's unauthenticated /healthz and reports it reachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TEST_BASE_URL}/healthz`);
    // No credentials go out on this probe: /healthz needs none.
    expect(init?.headers).toBeUndefined();

    const body = await res.json();
    expect(body).toMatchObject({ ok: true, reachable: true });
    expect(typeof body.checkedAt).toBe("string");
  });

  it("is never cached by the browser", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));

    const res = await GET();

    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reuses one probe for concurrent requests and for the cache window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([GET(), GET()]);
    const third = await GET();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const res of [first, second, third]) {
      expect((await res.json()).reachable).toBe(true);
    }
  });

  it("re-probes once the cache window has passed", async () => {
    // Both probes must read the same clock, so the fake timers go in before the
    // first call rather than between them.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await GET();
    vi.advanceTimersByTime(11_000);
    await GET();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports unreachable when the worker answers non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 503)));

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).reachable).toBe(false);
  });

  it("reports unreachable when the probe throws or times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).reachable).toBe(false);
  });

  it("reports unreachable when the response is not JSON", async () => {
    // A tunnel interstitial answers 200 with HTML. That is not the worker.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>You are about to visit...</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    const res = await GET();

    expect((await res.json()).reachable).toBe(false);
  });

  it("reports unreachable when the JSON body does not say ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: "yes" })));

    const res = await GET();

    expect((await res.json()).reachable).toBe(false);
  });

  it("never leaks the backend base URL or upstream error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`getaddrinfo ${TEST_BASE_URL}`)));

    const res = await GET();
    const text = JSON.stringify(await res.json());

    expect(text).not.toContain(TEST_BASE_URL);
    expect(text).not.toContain("getaddrinfo");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["checkedAt", "ok", "reachable"]);
  });
});

describe("GET /health without WEBETU_API_BASE_URL configured", () => {
  it("reports unreachable without calling fetch", async () => {
    vi.stubEnv("WEBETU_API_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const unconfigured = await loadRoute();
    const res = await unconfigured();

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await res.json()).reachable).toBe(false);
  });
});
