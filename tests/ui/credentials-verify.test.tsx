import { describe, expect, it } from "vitest";
import { classifyVerifyResponse } from "@/src/lib/utils";

// classifyVerifyResponse decides save-vs-block for the credentials save route:
// the POST /webetu/credentials handler saves on "valid"/"skip" and blocks on
// "invalid" (-> "No such user is found.") or "unavailable" (-> retry message).
describe("classifyVerifyResponse", () => {
  it("skips verification when no worker is configured", () => {
    expect(classifyVerifyResponse({ skip: true })).toBe("skip");
  });

  it("is valid when the worker confirms the login", () => {
    expect(classifyVerifyResponse({ ok: true, valid: true })).toBe("valid");
  });

  it("is invalid when the worker rejects the credentials", () => {
    expect(classifyVerifyResponse({ ok: true, valid: false })).toBe("invalid");
  });

  it("is unavailable when the worker could not be reached", () => {
    expect(classifyVerifyResponse({ ok: false })).toBe("unavailable");
  });

  it("treats a missing or malformed response as unavailable (never valid)", () => {
    expect(classifyVerifyResponse(null)).toBe("unavailable");
    expect(classifyVerifyResponse(undefined)).toBe("unavailable");
    expect(classifyVerifyResponse({})).toBe("unavailable");
    // ok:true but no boolean verdict -> cannot confirm -> block, don't save.
    expect(classifyVerifyResponse({ ok: true })).toBe("unavailable");
    expect(classifyVerifyResponse({ ok: true, valid: "yes" as unknown })).toBe(
      "unavailable"
    );
  });
});
