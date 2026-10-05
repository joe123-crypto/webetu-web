import { describe, expect, it } from "vitest";
import {
  classifyVerifyResponse,
  webetuVerifyThrottleDecision,
  WEBETU_VERIFY_MAX_ATTEMPTS,
  WEBETU_VERIFY_WINDOW_MS,
} from "@/src/lib/utils";

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

  // Regression guard: the route must hand the worker's `valid` through untouched.
  // An earlier version coerced it with `body.valid === true`, which turned a missing
  // verdict into "invalid" and showed "No such user is found." for a working account.
  it("never reports invalid for a non-boolean verdict", () => {
    for (const valid of [undefined, null, "false", 0, 1, {}]) {
      expect(classifyVerifyResponse({ ok: true, valid: valid as unknown })).not.toBe(
        "invalid"
      );
    }
    // Only a real `false` is an invalid verdict.
    expect(classifyVerifyResponse({ ok: true, valid: false })).toBe("invalid");
  });
});

// The verify endpoint makes our backend log in to Webetu on the caller's behalf, so one
// user's attempts are capped per window. This is the pure part of that decision.
describe("webetuVerifyThrottleDecision", () => {
  const now = 1_700_000_000_000;

  it("starts a fresh window on the first attempt", () => {
    expect(webetuVerifyThrottleDecision({ now, windowStartMs: null, count: null })).toEqual({
      allowed: true,
      count: 1,
      windowReset: true,
    });
  });

  it("counts up inside an open window", () => {
    expect(webetuVerifyThrottleDecision({ now, windowStartMs: now - 1000, count: 3 })).toEqual({
      allowed: true,
      count: 4,
      windowReset: false,
    });
  });

  it("blocks once the budget is spent", () => {
    const decision = webetuVerifyThrottleDecision({
      now,
      windowStartMs: now - 1000,
      count: WEBETU_VERIFY_MAX_ATTEMPTS,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.windowReset).toBe(false);
  });

  it("allows the attempt that lands exactly at the limit", () => {
    const decision = webetuVerifyThrottleDecision({
      now,
      windowStartMs: now - 1000,
      count: WEBETU_VERIFY_MAX_ATTEMPTS - 1,
    });
    expect(decision).toEqual({
      allowed: true,
      count: WEBETU_VERIFY_MAX_ATTEMPTS,
      windowReset: false,
    });
  });

  it("rolls over once the window has elapsed, even at the cap", () => {
    expect(
      webetuVerifyThrottleDecision({
        now,
        windowStartMs: now - WEBETU_VERIFY_WINDOW_MS,
        count: 999,
      })
    ).toEqual({ allowed: true, count: 1, windowReset: true });
  });

  it("never locks a user out on malformed or skewed stored state", () => {
    // A future windowStart (clock skew) and junk counts must not strand the user.
    expect(
      webetuVerifyThrottleDecision({ now, windowStartMs: now + 60_000, count: 999 }).allowed
    ).toBe(true);
    expect(
      webetuVerifyThrottleDecision({
        now,
        windowStartMs: Number.NaN,
        count: Number.NaN,
      }).allowed
    ).toBe(true);
    // Junk count inside a live window is treated as zero prior attempts, not as the cap.
    expect(
      webetuVerifyThrottleDecision({ now, windowStartMs: now - 1000, count: -5 })
    ).toEqual({ allowed: true, count: 1, windowReset: false });
  });
});
