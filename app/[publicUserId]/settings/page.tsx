import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { validatePublicUserId } from "@/src/lib/utils";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { getFirebaseAdminAuth } from "@/src/firebase/admin";
import { accountRemovalPending } from "@/src/domains/account-removal";
import { RemoveAccount } from "@/app/_components/remove-account";
import { EmailNotificationToggle } from "@/app/_components/email-notification-toggle";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "AWRS | Settings",
  description: "Manage your email preferences and account.",
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
  // A disabled/deleted identity may only see the deletion retry control. Keep
  // normal dashboard access on the revocation-checked session path above.
  const recovery = verified ?? await getFirebaseAdminAuth().verifySessionCookie(sessionCookie, false).catch(() => null);
  if (!recovery) redirect(`/login?next=${encodeURIComponent(settingsPath)}`);
  const pending = await accountRemovalPending(recovery.uid);
  if (pending) return (
    <main className="app-main"><h1>Finish account removal</h1><RemoveAccount pending /></main>
  );
  if (!verified) redirect(`/login?next=${encodeURIComponent(settingsPath)}`);

  const userLabel = verified.name ?? verified.email ?? "Account";

  // Account removal must remain available before onboarding is completed.

  return (
    <DashboardShell active="settings" publicUserId={publicUserId} userLabel={userLabel}>
      <div className="dashboard-topbar">
        <h1>Settings</h1>
      </div>

      <EmailNotificationToggle />
      <RemoveAccount />
    </DashboardShell>
  );
}
