import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getWebetuCredentialStatus, getWebetuUsername } from "@/src/domains/webetu";
import { isOnboardingRequired } from "@/src/domains/users";
import { validatePublicUserId } from "@/src/lib/utils";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { EmailNotificationToggle } from "@/app/_components/email-notification-toggle";
import { CredentialsVault } from "@/app/_components/credentials-vault";
import type { StatusKind } from "@/app/_components/status-ui";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "AWRS | Settings",
  description: "Manage your account settings and Webetu credentials vault.",
};

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ publicUserId: string }>;
}) {
  const { publicUserId } = await params;

  try {
    validatePublicUserId(publicUserId);
  } catch {
    notFound();
  }

  const settingsPath = `/${publicUserId}/settings`;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(settingsPath)}`);

  const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
  if (!verified) redirect(`/login?next=${encodeURIComponent(settingsPath)}`);

  const uid = verified.uid;
  const userLabel = verified.name ?? verified.email ?? "Account";

  if (await isOnboardingRequired(uid)) redirect(`/${publicUserId}/onboarding`);

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

  return (
    <DashboardShell active="settings" publicUserId={publicUserId} userLabel={userLabel}>
      <div className="dashboard-topbar">
        <h1>Settings</h1>
      </div>

      <CredentialsVault
        savedUsername={savedUsername}
        webetuLabel={webetuLabel}
        webetuKind={webetuKind}
        webetuSaveLabel={webetuSaveLabel}
        webetuConfigured={webetuConfigured}
      />

      <EmailNotificationToggle />
    </DashboardShell>
  );
}
