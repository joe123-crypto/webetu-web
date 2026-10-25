import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getWebetuCredentialStatus, getWebetuUsername } from "@/src/domains/webetu";
import { isOnboardingRequired } from "@/src/domains/users";
import { validatePublicUserId } from "@/src/lib/utils";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { CredentialsVault } from "@/app/_components/credentials-vault";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "AWRS | Vault",
  description: "Manage your Webetu credentials vault.",
};

export default async function VaultPage({
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

  const vaultPath = `/${publicUserId}/vault`;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(vaultPath)}`);

  const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
  if (!verified) redirect(`/login?next=${encodeURIComponent(vaultPath)}`);

  const uid = verified.uid;
  const userLabel = verified.name ?? verified.email ?? "Account";

  if (await isOnboardingRequired(uid).catch(() => false)) redirect(`/${publicUserId}/onboarding`);

  const [webetuStatus, savedUsername] = await Promise.all([
    getWebetuCredentialStatus(uid).catch(() => null),
    getWebetuUsername(uid).catch(() => null),
  ]);

  return (
    <DashboardShell active="vault" publicUserId={publicUserId} userLabel={userLabel}>
      <div className="dashboard-topbar">
        <h1>Vault</h1>
      </div>

      <CredentialsVault status={webetuStatus} savedUsername={savedUsername} />
    </DashboardShell>
  );
}
