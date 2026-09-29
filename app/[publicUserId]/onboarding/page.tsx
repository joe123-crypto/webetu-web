import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import {
  getWebetuCredentialStatus,
  getWebetuUsername,
  hasSavedWebetuDefaultRestaurant,
} from "@/src/domains/webetu";
import { isOnboardingRequired } from "@/src/domains/users";
import { validatePublicUserId } from "@/src/lib/utils";
import {
  furthestReachableStep,
  isStepComplete,
  parseOnboardingStep,
  type OnboardingProgress,
} from "@/src/lib/onboarding";
import { OnboardingGuide } from "@/app/_components/onboarding-guide";
import { OnboardingSignOut } from "@/app/_components/onboarding-sign-out";
import { CredentialsVault } from "@/app/_components/credentials-vault";
import { RestaurantPicker } from "@/app/_components/restaurant-picker";
import { PARENT_BRAND, PARENT_LOGO_SRC, PRODUCT_NAME } from "@/src/lib/brand";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "AWRS | Get started",
  description: "Set up your account to start automating meal reservations.",
};

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicUserId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { publicUserId } = await params;

  try {
    validatePublicUserId(publicUserId);
  } catch {
    notFound();
  }

  const onboardingPath = `/${publicUserId}/onboarding`;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(onboardingPath)}`);

  const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
  if (!verified) redirect(`/login?next=${encodeURIComponent(onboardingPath)}`);

  const uid = verified.uid;
  const userLabel = verified.name ?? verified.email ?? null;

  // Finished users never see onboarding again. On a read error stay here: the
  // dashboard pages treat errors as "not required", so this can't loop.
  if (!(await isOnboardingRequired(uid).catch(() => true))) redirect(`/${publicUserId}`);

  const [webetuStatus, restaurantChosen] = await Promise.all([
    getWebetuCredentialStatus(uid).catch(() => null),
    hasSavedWebetuDefaultRestaurant(uid).catch(() => false),
  ]);
  const progress: OnboardingProgress = {
    credentialsSaved: !!webetuStatus?.configured,
    restaurantChosen,
  };

  // Steps must be done in order; a hand-edited ?step= can't skip ahead.
  const { step: stepParam } = await searchParams;
  const requestedStep = parseOnboardingStep(stepParam);
  const reachableStep = furthestReachableStep(progress);
  if (requestedStep > reachableStep) redirect(`${onboardingPath}?step=${reachableStep}`);
  const step = requestedStep;

  let stepBody: ReactNode;
  if (step === 1) {
    const savedUsername = await getWebetuUsername(uid).catch(() => null);
    stepBody = <CredentialsVault status={webetuStatus} savedUsername={savedUsername} />;
  } else if (step === 2) {
    stepBody = <RestaurantPicker requireExplicitChoice hasSavedDefault={progress.restaurantChosen} />;
  } else {
    stepBody = (
      <section className="panel panel-narrow onboarding-finish">
        <h2 className="panel-title">You&rsquo;re ready to go</h2>
        <p>
          Your credentials and restaurant are set. Open your dashboard to track your
          reservation runs and status any time.
        </p>
      </section>
    );
  }

  return (
    <main className="onboarding-app">
      <header className="onboarding-header">
        <div className="onboarding-brand-block">
          <span className="brand-wordmark brand-wordmark-sm">{PRODUCT_NAME}</span>
          <span className="dashboard-endorsement" aria-label={`a ${PARENT_BRAND} product`}>
            <span>by</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PARENT_LOGO_SRC} alt={PARENT_BRAND} />
          </span>
        </div>
        <OnboardingSignOut userLabel={userLabel} />
      </header>

      <div className="onboarding-layout">
        <OnboardingGuide
          step={step}
          publicUserId={publicUserId}
          ready={isStepComplete(step, progress)}
        />
        <div className="onboarding-step-body">{stepBody}</div>
      </div>
    </main>
  );
}
