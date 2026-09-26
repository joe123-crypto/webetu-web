import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { validatePublicUserId } from "@/src/lib/utils";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Webetu | Meal Reservation",
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

  const userLabel = verified.name ?? verified.email ?? "Account";

  const pageScript = `
(function() {
  var restaurantList = document.querySelector("[data-restaurant-list]");
  var restaurantStatus = document.querySelector("[data-restaurant-status]");
  var restaurantMessage = document.querySelector("[data-restaurant-message]");

  function setMessage(el, message, tone) {
    el.querySelector("[data-status-label]").textContent = message || "";
    el.dataset.statusKind = tone || "info";
  }
  function setPill(el, label, kind) {
    el.querySelector("[data-status-label]").textContent = label;
    el.dataset.statusKind = kind || "info";
  }
  async function readJson(response) {
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
    return body;
  }

  // Restaurant selection
  async function loadRestaurants() {
    if (!restaurantList) return;
    restaurantList.innerHTML = "<p>Loading restaurants…</p>";
    try {
      var data = await readJson(await fetch("/webetu/restaurants", { method: "GET", credentials: "same-origin" }));
      var catalog = data.catalog || [];
      if (!catalog.length) {
        restaurantList.innerHTML = "<p>No restaurants available.</p>";
        return;
      }
      restaurantList.innerHTML = "";
      catalog.forEach(function(r) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "restaurant-option";
        btn.dataset.catalogId = r.catalogId || "";
        btn.textContent = r.name || r.catalogId || "Unknown";
        btn.addEventListener("click", async function() {
          if (restaurantStatus) setPill(restaurantStatus, "Saving…", "loading");
          if (restaurantMessage) setMessage(restaurantMessage, "", "info");
          try {
            await readJson(await fetch("/webetu/preferences", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ restaurant: r })
            }));
            if (restaurantStatus) setPill(restaurantStatus, r.name || r.catalogId || "Selected", "complete");
            if (restaurantMessage) setMessage(restaurantMessage, "Restaurant preference saved.", "complete");
          } catch (err) {
            if (restaurantStatus) setPill(restaurantStatus, "Error", "error");
            if (restaurantMessage) setMessage(restaurantMessage, err.message || "Could not save restaurant preference.", "error");
          }
        });
        restaurantList.appendChild(btn);
      });
    } catch (err) {
      restaurantList.innerHTML = "<p>Could not load restaurants.</p>";
    }
  }

  loadRestaurants();
})();
`;

  return (
    <>
      <DashboardShell active="meal-reservation" publicUserId={publicUserId} userLabel={userLabel}>
        <div className="dashboard-topbar">
          <h1>Meal Reservation</h1>
        </div>

        {/* Restaurant selection panel */}
        <section className="panel panel-narrow" aria-labelledby="restaurant-title">
          <div className="panel-head">
            <div>
              <h2 id="restaurant-title">Default Restaurant</h2>
              <p>Choose the restaurant for your daily meal reservations.</p>
            </div>
            <StatusPill data-restaurant-status kind="pending">Not set</StatusPill>
          </div>
          <div data-restaurant-list className="restaurant-list">
            <p>Loading restaurants&hellip;</p>
          </div>
          <StatusNotice data-restaurant-message />
        </section>
      </DashboardShell>
      <script dangerouslySetInnerHTML={{ __html: pageScript }} />
    </>
  );
}
