import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { validatePublicUserId } from "@/src/lib/utils";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";
import { InfoHint } from "@/app/_components/info-hint";

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
  var yourRestaurants = document.querySelector("[data-your-restaurants]");
  var yourRestaurantsMessage = document.querySelector("[data-your-restaurants-message]");

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

  var selectedCatalogId = null;

  // Mark the currently-selected restaurant across both lists
  function highlightSelection() {
    [restaurantList, yourRestaurants].forEach(function(container) {
      if (!container) return;
      container.querySelectorAll("[data-catalog-id]").forEach(function(el) {
        el.setAttribute("aria-pressed", el.dataset.catalogId === selectedCatalogId ? "true" : "false");
      });
    });
  }

  // Save the chosen restaurant as the user's default and update both lists
  async function selectRestaurant(r) {
    if (restaurantStatus) setPill(restaurantStatus, "Saving…", "loading");
    if (restaurantMessage) setMessage(restaurantMessage, "", "info");
    if (yourRestaurantsMessage) setMessage(yourRestaurantsMessage, "", "info");
    try {
      await readJson(await fetch("/webetu/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ restaurant: r })
      }));
      selectedCatalogId = r.catalogId || null;
      highlightSelection();
      if (restaurantStatus) setPill(restaurantStatus, r.name || r.catalogId || "Selected", "complete");
      if (restaurantMessage) setMessage(restaurantMessage, "Restaurant preference saved.", "complete");
    } catch (err) {
      if (restaurantStatus) setPill(restaurantStatus, "Error", "error");
      if (restaurantMessage) setMessage(restaurantMessage, err.message || "Could not save restaurant preference.", "error");
    }
  }

  // Render clickable restaurant options into a container
  function renderOptions(container, catalog) {
    if (!container) return;
    if (!catalog.length) {
      container.innerHTML = "<p>No restaurants available.</p>";
      return;
    }
    container.innerHTML = "";
    catalog.forEach(function(r) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "restaurant-option";
      btn.dataset.catalogId = r.catalogId || "";
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = r.name || r.catalogId || "Unknown";
      btn.addEventListener("click", function() { selectRestaurant(r); });
      container.appendChild(btn);
    });
  }

  // Reflect the saved default into the status pill and selection highlight
  async function loadPreferences() {
    try {
      var prefs = await readJson(await fetch("/webetu/preferences", { method: "GET", credentials: "same-origin" }));
      if (prefs && prefs.defaultRestaurant) {
        selectedCatalogId = prefs.defaultRestaurant.catalogId || null;
        if (selectedCatalogId && restaurantStatus) {
          setPill(restaurantStatus, prefs.defaultRestaurant.name || selectedCatalogId, "complete");
        }
      }
    } catch (e) {}
  }

  // Default Restaurant panel: the static restaurant catalog
  async function loadDefaultRestaurants() {
    if (!restaurantList) return;
    restaurantList.innerHTML = "<p>Loading restaurants…</p>";
    try {
      var data = await readJson(await fetch("/webetu/restaurants", { method: "GET", credentials: "same-origin" }));
      renderOptions(restaurantList, data.catalog || []);
    } catch (err) {
      restaurantList.innerHTML = "<p>Could not load restaurants.</p>";
    }
  }

  // Your Restaurants panel: the user's live ONOU restaurants (falls back to catalog server-side)
  async function loadYourRestaurants() {
    if (!yourRestaurants) return;
    yourRestaurants.innerHTML = "<p>Loading restaurants…</p>";
    try {
      var data = await readJson(await fetch("/webetu/restaurants/live", { method: "GET", credentials: "same-origin" }));
      renderOptions(yourRestaurants, data.restaurants || []);
    } catch (err) {
      yourRestaurants.innerHTML = "<p>Could not load restaurants.</p>";
      if (yourRestaurantsMessage) setMessage(yourRestaurantsMessage, err.message || "Could not load restaurants.", "error");
    }
  }

  async function loadRestaurants() {
    await loadPreferences();
    await Promise.all([loadDefaultRestaurants(), loadYourRestaurants()]);
    highlightSelection();
  }

  loadRestaurants();
})();
`;

  return (
    <>
      <DashboardShell active="meal-reservation" publicUserId={publicUserId} userLabel={userLabel}>
        <div className="dashboard-topbar">
          <h1>Select Restaurant</h1>
        </div>

        {/* Restaurant selection panel */}
        <section className="panel panel-narrow" aria-labelledby="restaurant-title">
          <div className="panel-head">
            <div>
              <h2 id="restaurant-title" className="panel-title">
                Default Restaurant
                <InfoHint label="Default Restaurant">
                  Choose the restaurant for your daily meal reservations.
                </InfoHint>
              </h2>
            </div>
            <StatusPill data-restaurant-status kind="pending">Not set</StatusPill>
          </div>
          <div data-restaurant-list className="restaurant-list">
            <p>Loading restaurants&hellip;</p>
          </div>
          <StatusNotice data-restaurant-message />
        </section>

        {/* Your restaurants panel */}
        <section className="panel panel-narrow" aria-labelledby="your-restaurants-title">
          <div className="panel-head">
            <div>
              <h2 id="your-restaurants-title" className="panel-title">
                Your Restaurants
                <InfoHint label="Your Restaurants">
                  Restaurants available for your meal reservations.
                </InfoHint>
              </h2>
            </div>
          </div>
          <div data-your-restaurants className="restaurant-list">
            <p>Loading restaurants&hellip;</p>
          </div>
          <StatusNotice data-your-restaurants-message />
        </section>
      </DashboardShell>
      <script dangerouslySetInnerHTML={{ __html: pageScript }} />
    </>
  );
}
