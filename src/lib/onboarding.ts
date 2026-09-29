export const ONBOARDING_TOTAL_STEPS = 3;

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

// Steps must be completed in order: restaurants need saved credentials (the live
// restaurant list comes from Webetu), and the overview needs both.
export function furthestReachableStep({ credentialsSaved, restaurantChosen }: OnboardingProgress): number {
  if (!credentialsSaved) return 1;
  if (!restaurantChosen) return 2;
  return ONBOARDING_TOTAL_STEPS;
}

// Whether the requirement for leaving `step` is already met.
export function isStepComplete(step: number, progress: OnboardingProgress): boolean {
  return furthestReachableStep(progress) > step || step >= ONBOARDING_TOTAL_STEPS;
}
