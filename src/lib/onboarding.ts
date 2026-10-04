export const ONBOARDING_TOTAL_STEPS = 2;

// DOM events the reusable credentials/restaurant UIs dispatch so the onboarding
// guide can react to progress made on the current step.
export const CREDENTIALS_STATUS_EVENT = "webetu:credentials-status";
export const RESTAURANT_SELECTED_EVENT = "webetu:restaurant-selected";

export type OnboardingProgress = {
  credentialsSaved: boolean;
  restaurantChosen: boolean;
};

export function parseOnboardingStep(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(1, value), ONBOARDING_TOTAL_STEPS);
}

// Furthest step the user may navigate to. The restaurant step needs saved
// credentials (the live restaurant list comes from Webetu), so it only unlocks
// once credentials are in place.
export function furthestReachableStep({ credentialsSaved }: OnboardingProgress): number {
  return credentialsSaved ? ONBOARDING_TOTAL_STEPS : 1;
}

// Whether the current step's own task is already done.
export function isStepComplete(step: number, progress: OnboardingProgress): boolean {
  if (step <= 1) return progress.credentialsSaved;
  return progress.credentialsSaved && progress.restaurantChosen;
}

// Whether every onboarding task is done, so the user can finish.
export function isOnboardingComplete({ credentialsSaved, restaurantChosen }: OnboardingProgress): boolean {
  return credentialsSaved && restaurantChosen;
}
