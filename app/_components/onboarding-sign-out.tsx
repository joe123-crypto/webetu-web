"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { endDashboardSession } from "@/app/_components/dashboard-account-menu";

type OnboardingSignOutProps = {
  userLabel?: string | null;
};

// Onboarding hides the dashboard nav and account menu, so this is the only way
// out for someone who signed in with the wrong account.
export function OnboardingSignOut({ userLabel }: OnboardingSignOutProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSignOut() {
    setBusy(true);
    setError("");
    try {
      await endDashboardSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="onboarding-account">
      {userLabel ? <span className="onboarding-account-label">{userLabel}</span> : null}
      <button className="onboarding-sign-out" type="button" disabled={busy} onClick={handleSignOut}>
        <LogOut aria-hidden="true" />
        {busy ? "Signing out..." : "Sign out"}
      </button>
      {error ? <p className="onboarding-account-error" role="alert">{error}</p> : null}
    </div>
  );
}
