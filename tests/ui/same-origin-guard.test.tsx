import { describe, expect, it } from "vitest";
import { assertSameOriginJsonRequest } from "@/src/security/session";

// Guards the auth routes that create a session without needing one first. A cross-site
// form can POST a text/plain body that still parses as JSON, which would let another
// site sign a victim into the attacker's account (login CSRF).
describe("assertSameOriginJsonRequest", () => {
  const origin = "https://app.example";

  function req(headers: Record<string, string>) {
    return { headers: new Headers(headers), nextUrl: { origin } };
  }

  function statusOf(headers: Record<string, string>) {
    try {
      assertSameOriginJsonRequest(req(headers));
    } catch (err) {
      return (err as { status?: number }).status;
    }
    return "ok";
  }

  it("allows the app's own JSON fetch", () => {
    expect(statusOf({ "content-type": "application/json", origin })).toBe("ok");
    expect(statusOf({ "content-type": "application/json; charset=utf-8", origin })).toBe("ok");
    expect(
      statusOf({ "content-type": "application/json", "sec-fetch-site": "same-origin" })
    ).toBe("ok");
  });

  it("refuses bodies a cross-site form can send", () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""]) {
      expect(statusOf({ "content-type": type, origin })).toBe(415);
    }
    expect(statusOf({ "content-type": "application/jsonp", origin })).toBe(415);
  });

  it("refuses another origin even with a JSON content type", () => {
    expect(statusOf({ "content-type": "application/json", origin: "https://evil.example" })).toBe(403);
    expect(statusOf({ "content-type": "application/json", origin: "null" })).toBe(403);
    expect(
      statusOf({ "content-type": "application/json", "sec-fetch-site": "cross-site" })
    ).toBe(403);
    expect(
      statusOf({ "content-type": "application/json", "sec-fetch-site": "same-site" })
    ).toBe(403);
  });
});
