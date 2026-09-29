import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getWebetuCredentialStatus, getWebetuUsername } from "@/src/domains/webetu";
import { isOnboardingRequired } from "@/src/domains/users";
import { validatePublicUserId } from "@/src/lib/utils";
import { OnboardingGuide } from "@/app/_components/onboarding-guide";
import { CredentialsVault } from "@/app/_components/credentials-vault";
import { RestaurantPicker } from "@/app/_components/restaurant-picker";
import type { StatusKind } from "@/app/_components/status-ui";
import { PARENT_BRAND, PARENT_LOGO_SRC, PRODUCT_NAME } from "@/src/lib/brand";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "AWRS | Get started",
  description: "Set up your account to start automating meal reservations.",
};

const TOTAL_STEPS = 3;

function parseStep(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(1, value), TOTAL_STEPS);
}

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

  // Finished users never see onboarding again.
  if (!(await isOnboardingRequired(uid))) redirect(`/${publicUserId}`);

  const { step: stepParam } = await searchParams;
  const step = parseStep(stepParam);

  let stepBody: ReactNode = null;

  if (step === 1) {
    const [webetuStatus, savedUsername] = await Promise.all([
      getWebetuCredentialStatus(uid).catch(() => null),
      getWebetuUsername(uid).catch(() => null),
    ]);
    const webetuConfigured = !!webetuStatus?.configured;
    const webetuLabel = webetuConfigured
      ? "Saved"
      : webetuStatus?.status === "revoked"
      ? "Revoked"
      : webetuStatus
      ? "Not saved"
      : "Unavailable";
    const webetuKind: StatusKind = webetuConfigured
      ? "complete"
      : webetuStatus?.status === "revoked"
      ? "revoked"
      : webetuStatus
      ? "pending"
      : "error";
    const webetuSaveLabel = webetuConfigured ? "Update credentials" : "Save credentials";

    stepBody = (
      <CredentialsVault
        savedUsername={savedUsername}
        webetuLabel={webetuLabel}
        webetuKind={webetuKind}
        webetuSaveLabel={webetuSaveLabel}
        webetuConfigured={webetuConfigured}
      />
    );
  } else if (step === 2) {
    stepBody = <RestaurantPicker />;
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
      <div className="onboarding-brand-block">
        <span className="brand-wordmark brand-wordmark-sm">{PRODUCT_NAME}</span>
        <span className="dashboard-endorsement" aria-label={`a ${PARENT_BRAND} product`}>
          <span>by</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PARENT_LOGO_SRC} alt={PARENT_BRAND} />
        </span>
      </div>

      <div className="onboarding-layout">
        <OnboardingGuide step={step} publicUserId={publicUserId} />
        <div className="onboarding-step-body">{stepBody}</div>
      </div>
    </main>
  );
}
