import { describe, expect, it } from "vitest";
import {
  furthestReachableStep,
  isOnboardingComplete,
  isStepComplete,
  parseOnboardingStep,
} from "@/src/lib/onboarding";

const nothingDone = { credentialsSaved: false, restaurantChosen: false };
const credentialsOnly = { credentialsSaved: true, restaurantChosen: false };
const allDone = { credentialsSaved: true, restaurantChosen: true };

describe("parseOnboardingStep", () => {
  it("defaults to the first step for missing or invalid input", () => {
    expect(parseOnboardingStep(undefined)).toBe(1);
    expect(parseOnboardingStep("")).toBe(1);
    expect(parseOnboardingStep("abc")).toBe(1);
  });

  it("clamps to the valid step range", () => {
    expect(parseOnboardingStep("0")).toBe(1);
    expect(parseOnboardingStep("-4")).toBe(1);
    expect(parseOnboardingStep("2")).toBe(2);
    expect(parseOnboardingStep("99")).toBe(2);
  });
});

describe("furthestReachableStep", () => {
  it("keeps users on settings until credentials are saved", () => {
    expect(furthestReachableStep(nothingDone)).toBe(1);
    // A chosen restaurant alone doesn't unlock anything: steps go in order.
    expect(furthestReachableStep({ credentialsSaved: false, restaurantChosen: true })).toBe(1);
  });

  it("unlocks the restaurants step once credentials are saved", () => {
    expect(furthestReachableStep(credentialsOnly)).toBe(2);
    expect(furthestReachableStep(allDone)).toBe(2);
  });
});

describe("isStepComplete", () => {
  it("reports whether each step's task is done", () => {
    expect(isStepComplete(1, nothingDone)).toBe(false);
    expect(isStepComplete(1, credentialsOnly)).toBe(true);
    expect(isStepComplete(2, credentialsOnly)).toBe(false);
    expect(isStepComplete(2, allDone)).toBe(true);
  });
});

describe("isOnboardingComplete", () => {
  it("requires both credentials and a chosen restaurant", () => {
    expect(isOnboardingComplete(nothingDone)).toBe(false);
    expect(isOnboardingComplete(credentialsOnly)).toBe(false);
    expect(isOnboardingComplete(allDone)).toBe(true);
  });
});
