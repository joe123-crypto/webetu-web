import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TEST_KEY = "test-internal-key-abc123";
const TEST_BASE_URL = "http://127.0.0.1:8787";

// config reads WEBETU_INTERNAL_API_KEY / WEBETU_API_BASE_URL from process.env at
// module load. loadDotEnv() only fills vars that are undefined, so setting them
// before importing the route makes config.internalApiKey match TEST_KEY. Imports
// are hoisted, so we stub env and dynamically import the route in beforeAll.
let GET: (req: NextRequest) => Promise<Response>;

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/internal/health", { headers });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(async () => {
  vi.stubEnv("WEBETU_INTERNAL_API_KEY", TEST_KEY);
  vi.stubEnv("WEBETU_API_BASE_URL", TEST_BASE_URL);
  const mod = await import("@/app/internal/health/route");
  GET = mod.GET;
});

describe("GET /internal/health", () => {
  it("returns 401 and does not call fetch when Authorization header is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns 403 and does not call fetch when the bearer is wrong", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest({ Authorization: "Bearer wrong-key" }));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns 200 with the normalized run-status when the backend responds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        status: "system_failure",
        systemError: "worker crashed",
        processed: 3,
        skipped: 1,
        failures: 2,
        lastRunAt: "2026-09-28T00:00:00.000Z",
        finishedAt: "2026-09-28T00:05:00.000Z",
        nextRunAt: "2026-09-29T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest({ Authorization: `Bearer ${TEST_KEY}` }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      reachable: true,
      reservation: {
        status: "system_failure",
        systemError: "worker crashed",
        processed: 3,
        skipped: 1,
        failures: 2,
        lastRunAt: "2026-09-28T00:00:00.000Z",
        finishedAt: "2026-09-28T00:05:00.000Z",
        nextRunAt: "2026-09-29T00:00:00.000Z",
      },
    });
  });

  it("returns 200 with reachable:false when the backend fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest({ Authorization: `Bearer ${TEST_KEY}` }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, reachable: false, reservation: null });
  });
});
