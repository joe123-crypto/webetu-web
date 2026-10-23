import { describe, expect, it } from "vitest";
import {
  classifyVerifyResponse,
  webetuVerifyThrottleDecision,
  webetuVerifyDailyDecision,
  webetuVerifyTargetDecision,
  webetuVerifyTargetKey,
  WEBETU_VERIFY_TARGET_MAX_ATTEMPTS,
  WEBETU_VERIFY_MAX_ATTEMPTS,
  WEBETU_VERIFY_WINDOW_MS,
  WEBETU_VERIFY_DAILY_MAX_ATTEMPTS,
  WEBETU_VERIFY_DAILY_WINDOW_MS,
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

// The daily cap bounds the total: the short window alone resets every 10 minutes, and
// nothing resets either counter after a successful verify.
describe("webetuVerifyDailyDecision", () => {
  const now = 1_700_000_000_000;

  it("starts a fresh daily window on the first attempt", () => {
    expect(webetuVerifyDailyDecision({ now, windowStartMs: null, count: null })).toEqual({
      allowed: true,
      count: 1,
      windowReset: true,
    });
  });

  it("counts attempts across many short windows within a day", () => {
    const start = now - 5 * WEBETU_VERIFY_WINDOW_MS;
    expect(webetuVerifyDailyDecision({ now, windowStartMs: start, count: 12 })).toEqual({
      allowed: true,
      count: 13,
      windowReset: false,
    });
  });

  it("blocks once the daily budget is spent, even after the short window resets", () => {
    const start = now - 2 * 60 * 60 * 1000;
    expect(
      webetuVerifyDailyDecision({ now, windowStartMs: start, count: WEBETU_VERIFY_DAILY_MAX_ATTEMPTS })
    ).toMatchObject({ allowed: false });
    // The short window has long expired, so it alone would allow this attempt.
    expect(
      webetuVerifyThrottleDecision({ now, windowStartMs: start, count: WEBETU_VERIFY_MAX_ATTEMPTS })
    ).toMatchObject({ allowed: true });
  });

  it("rolls over after 24 hours", () => {
    const start = now - WEBETU_VERIFY_DAILY_WINDOW_MS;
    expect(
      webetuVerifyDailyDecision({ now, windowStartMs: start, count: WEBETU_VERIFY_DAILY_MAX_ATTEMPTS })
    ).toEqual({ allowed: true, count: 1, windowReset: true });
  });

  it("rolls over rather than locking out when the window start is in the future", () => {
    expect(
      webetuVerifyDailyDecision({ now, windowStartMs: now + 60_000, count: WEBETU_VERIFY_DAILY_MAX_ATTEMPTS })
    ).toEqual({ allowed: true, count: 1, windowReset: true });
  });
});

// The per-username cap is what holds when an attacker spreads guesses over many of our
// accounts: it counts tries against one Webetu username, whoever is making them.
describe("webetuVerifyTargetDecision / webetuVerifyTargetKey", () => {
  const now = 1_700_000_000_000;

  it("blocks once one username has been tried the maximum number of times", () => {
    const start = now - 60 * 60 * 1000;
    expect(
      webetuVerifyTargetDecision({ now, windowStartMs: start, count: WEBETU_VERIFY_TARGET_MAX_ATTEMPTS - 1 })
    ).toMatchObject({ allowed: true, count: WEBETU_VERIFY_TARGET_MAX_ATTEMPTS });
    expect(
      webetuVerifyTargetDecision({ now, windowStartMs: start, count: WEBETU_VERIFY_TARGET_MAX_ATTEMPTS })
    ).toMatchObject({ allowed: false });
  });

  it("gives variants of one username the same budget", () => {
    expect(webetuVerifyTargetKey("Student42")).toBe(webetuVerifyTargetKey("  student42 "));
    expect(webetuVerifyTargetKey("202112345")).toBe(webetuVerifyTargetKey("2021 12345"));
    // Full-width digits fold to ASCII under NFKC.
    expect(webetuVerifyTargetKey("202112345")).toBe(webetuVerifyTargetKey("２０２１１２３４５"));
    expect(webetuVerifyTargetKey("student42")).not.toBe(webetuVerifyTargetKey("student43"));
  });

  it("does not store the username in the clear", () => {
    const key = webetuVerifyTargetKey("student42");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("student42");
  });
});
