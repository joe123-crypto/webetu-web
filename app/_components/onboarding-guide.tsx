"use client";

import { useEffect, useState } from "react";
import { Check, Settings, Utensils, Home } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CREDENTIALS_STATUS_EVENT,
  ONBOARDING_TOTAL_STEPS,
  RESTAURANT_SELECTED_EVENT,
} from "@/src/lib/onboarding";

type OnboardingStep = {
  label: string;
  hint: string;
  // Shown under a disabled Next button until the step's task is done.
  pending?: string;
  icon: LucideIcon;
};

const STEPS: ReadonlyArray<OnboardingStep> = [
  {
    label: "Settings",
    hint: "Save your Webetu username and password so we can reserve meals for you automatically.",
    pending: "Save your credentials to continue.",
    icon: Settings,
  },
  {
    label: "Restaurants",
    hint: "Choose the default restaurant for your daily meal reservations.",
    pending: "Select a restaurant to continue.",
    icon: Utensils,
  },
  {
    label: "Overview",
    hint: "You're all set. Open your dashboard to review your reservation status.",
    icon: Home,
  },
];

if (STEPS.length !== ONBOARDING_TOTAL_STEPS) {
  throw new Error("Onboarding guide steps are out of sync with ONBOARDING_TOTAL_STEPS.");
}

type OnboardingGuideProps = {
  step: number;
  publicUserId: string;
  // Whether the current step's task was already done when the page rendered.
  ready: boolean;
};

export function OnboardingGuide({ step, publicUserId, ready: initialReady }: OnboardingGuideProps) {
  const total = STEPS.length;
  const current = Math.min(Math.max(1, step), total);
  const currentStep = STEPS[current - 1];
  const isLast = current >= total;
  const progress = `${(current / total) * 100}%`;

  const [ready, setReady] = useState(initialReady);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The reusable credentials/restaurant UIs announce progress as DOM events.
  useEffect(() => {
    function handleCredentials(event: Event) {
      const detail = (event as CustomEvent<{ configured?: boolean }>).detail;
      setReady(!!detail?.configured);
    }
    function handleRestaurant() {
      setReady(true);
    }

    if (current === 1) {
      document.addEventListener(CREDENTIALS_STATUS_EVENT, handleCredentials);
      return () => document.removeEventListener(CREDENTIALS_STATUS_EVENT, handleCredentials);
    }
    if (current === 2) {
      document.addEventListener(RESTAURANT_SELECTED_EVENT, handleRestaurant);
      return () => document.removeEventListener(RESTAURANT_SELECTED_EVENT, handleRestaurant);
    }
    return undefined;
  }, [current]);

  const stepHref = (target: number) => `/${publicUserId}/onboarding?step=${target}`;

  async function handleFinish() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/webetu/onboarding/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not finish onboarding. Please try again.");
      }
      window.location.assign(`/${publicUserId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish onboarding. Please try again.");
      setBusy(false);
    }
  }

  return (
    <aside className="onboarding-guide" aria-label={`Onboarding step ${current} of ${total}`}>
      <p className="onboarding-guide-eyebrow">
        Getting started · Step {current} of {total}
      </p>

      <div
        className="progress-track onboarding-guide-track"
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
      >
        <span className="progress-value" style={{ width: progress }} />
      </div>

      <ol className="onboarding-guide-steps">
        {STEPS.map((item, index) => {
          const position = index + 1;
          const state =
            position < current ? "is-done" : position === current ? "is-current" : "is-upcoming";
          const Icon = position < current ? Check : item.icon;
          return (
            <li
              key={item.label}
              className={`onboarding-guide-step ${state}`}
              aria-current={position === current ? "step" : undefined}
            >
              <span className="onboarding-guide-step-badge" aria-hidden="true">
                <Icon />
              </span>
              <span className="onboarding-guide-step-label">{item.label}</span>
            </li>
          );
        })}
      </ol>

      <h1 className="onboarding-guide-title">{currentStep.label}</h1>
      <p className="onboarding-guide-hint">{currentStep.hint}</p>

      {error ? (
        <p className="onboarding-guide-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="onboarding-guide-actions">
        {current > 1 ? (
          <a className="onboarding-guide-back" href={stepHref(current - 1)}>
            Back
          </a>
        ) : (
          <span />
        )}
        {isLast ? (
          <button className="onboarding-guide-next" type="button" onClick={handleFinish} disabled={busy}>
            {busy ? "Finishing…" : "Finish & go to dashboard"}
          </button>
        ) : ready ? (
          <a className="onboarding-guide-next" href={stepHref(current + 1)}>
            Next
          </a>
        ) : (
          <button className="onboarding-guide-next" type="button" disabled aria-describedby="onboarding-guide-pending">
            Next
          </button>
        )}
      </div>

      {!isLast && !ready && currentStep.pending ? (
        <p id="onboarding-guide-pending" className="onboarding-guide-pending">
          {currentStep.pending}
        </p>
      ) : null}
    </aside>
  );
}
