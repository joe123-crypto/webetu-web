import { describe, expect, it } from "vitest";
import { webetuManualRunDecision, WEBETU_MANUAL_RUN_COOLDOWN_MS } from "@/src/lib/utils";

// POST /webetu/run/manual claims a per-user slot before calling the backend, so one
// account cannot loop the button and tie up the backend's workers.
describe("webetuManualRunDecision", () => {
  const now = 1_700_000_000_000;

  it("allows the first run", () => {
    expect(webetuManualRunDecision({ now, lastStartedMs: null })).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it("blocks a second run inside the cooldown and says how long to wait", () => {
    expect(webetuManualRunDecision({ now, lastStartedMs: now - 60_000 })).toEqual({
      allowed: false,
      retryAfterMs: WEBETU_MANUAL_RUN_COOLDOWN_MS - 60_000,
    });
  });

  it("allows a run once the cooldown has passed", () => {
    expect(
      webetuManualRunDecision({ now, lastStartedMs: now - WEBETU_MANUAL_RUN_COOLDOWN_MS })
    ).toMatchObject({ allowed: true });
  });

  it("does not lock out on a start time in the future or a malformed one", () => {
    expect(webetuManualRunDecision({ now, lastStartedMs: now + 60_000 })).toMatchObject({
      allowed: true,
    });
    expect(webetuManualRunDecision({ now, lastStartedMs: Number.NaN })).toMatchObject({
      allowed: true,
    });
  });
});
