import { describe, expect, it } from "vitest";
import { destinationForSession } from "@/src/auth/login";

describe("destinationForSession onboarding routing", () => {
  it("sends users who still need onboarding to the onboarding route", () => {
    const dest = destinationForSession(
      { ok: true, publicUserId: "abc123", onboardingRequired: true },
      "/",
    );
    expect(dest).toBe("/abc123/onboarding");
  });

  it("prefers onboarding over an explicit next path while onboarding is required", () => {
    const dest = destinationForSession(
      { ok: true, publicUserId: "abc123", onboardingRequired: true },
      "/abc123/settings",
    );
    expect(dest).toBe("/abc123/onboarding");
  });

  it("routes finished users to their dashboard root when next is '/'", () => {
    const dest = destinationForSession(
      { ok: true, publicUserId: "abc123", onboardingRequired: false },
      "/",
    );
    expect(dest).toBe("/abc123");
  });

  it("honors a safe next path once onboarding is complete", () => {
    const dest = destinationForSession(
      { ok: true, publicUserId: "abc123", onboardingRequired: false },
      "/abc123/settings",
    );
    expect(dest).toBe("/abc123/settings");
  });
});
