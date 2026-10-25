import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";

function worker(fetcher: typeof fetch) {
  const handlers: Record<string, (event: any) => void> = {};
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://app.example" },
      addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; },
    },
    fetch: fetcher,
    URL,
    Response,
  });
  return handlers.fetch;
}

describe("browser installation", () => {
  it("declares a stable standalone app with a launcher icon", () => {
    expect(manifest()).toMatchObject({
      id: "/", start_url: "/", scope: "/", display: "standalone", short_name: "AWRS",
      icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
    });
  });

  it("returns live account navigation responses without caching", async () => {
    const response = new Response("private account page");
    const fetcher = vi.fn().mockResolvedValue(response);
    const respondWith = vi.fn();
    const request = { method: "GET", mode: "navigate", url: "https://app.example/account" };
    worker(fetcher)({ request, respondWith });
    expect(fetcher).toHaveBeenCalledWith(request);
    expect(await respondWith.mock.calls[0][0]).toBe(response);
  });

  it("provides an uncached offline page when navigation cannot reach the network", async () => {
    const respondWith = vi.fn();
    worker(vi.fn().mockRejectedValue(new TypeError("offline")))({
      request: { method: "GET", mode: "navigate", url: "https://app.example/" }, respondWith,
    });
    const response = await respondWith.mock.calls[0][0] as Response;
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("You’re offline");
  });

  it.each([
    { method: "POST", mode: "navigate", url: "https://app.example/auth/session" },
    { method: "GET", mode: "cors", url: "https://app.example/webetu/credentials" },
    { method: "GET", mode: "navigate", url: "https://accounts.google.com/" },
  ])("leaves non-navigation, mutation and external requests alone: $url", (request) => {
    const fetcher = vi.fn();
    const respondWith = vi.fn();
    worker(fetcher)({ request, respondWith });
    expect(fetcher).not.toHaveBeenCalled();
    expect(respondWith).not.toHaveBeenCalled();
  });
});
