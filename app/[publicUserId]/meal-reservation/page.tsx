import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { isOnboardingRequired } from "@/src/domains/users";
import { validatePublicUserId } from "@/src/lib/utils";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { RestaurantPicker } from "@/app/_components/restaurant-picker";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "AWRS | Meal Reservation",
  description: "Manage your Webetu meal reservation restaurant preferences.",
};

export default async function MealReservationPage({
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

  const mealPath = `/${publicUserId}/meal-reservation`;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(mealPath)}`);

  const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
  if (!verified) redirect(`/login?next=${encodeURIComponent(mealPath)}`);

  const uid = verified.uid;
  const userLabel = verified.name ?? verified.email ?? "Account";

  if (await isOnboardingRequired(uid).catch(() => false)) redirect(`/${publicUserId}/onboarding`);

  return (
    <DashboardShell active="meal-reservation" publicUserId={publicUserId} userLabel={userLabel}>
      <div className="dashboard-topbar">
        <h1>Select Restaurant</h1>
      </div>

      <RestaurantPicker />
    </DashboardShell>
  );
}
