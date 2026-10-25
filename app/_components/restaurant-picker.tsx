import { RefreshCw } from "lucide-react";

import { StatusNotice } from "@/app/_components/status-ui";
import { InfoHint } from "@/app/_components/info-hint";
import { RESTAURANT_SELECTED_EVENT } from "@/src/lib/onboarding";

// Client logic for the restaurant selection panels. Colocated with the markup so
// the UI can be reused (meal-reservation page and onboarding) without duplicating
// the behavior. The script is self-contained: it queries the data-* hooks below
// and runs on initial HTML load. After a successful selection it announces it as
// a DOM event so the onboarding guide can react.
const pickerScript = `
(function() {
  var restaurantPanel = document.querySelector("[data-restaurant-panel]");
  var yourRestaurants = document.querySelector("[data-your-restaurants]");
  var yourRestaurantsMessage = document.querySelector("[data-your-restaurants-message]");
  var refreshButton = document.querySelector("[data-your-restaurants-refresh]");

  if (!restaurantPanel && !yourRestaurants) return;

  // When an explicit choice is required, the fallback restaurant the preferences
  // API returns must not be presented as the user's selection.
  var hideFallbackDefault = !!restaurantPanel && restaurantPanel.dataset.requireChoice === "true" && restaurantPanel.dataset.hasSavedDefault !== "true";

  function setMessage(el, message, tone) {
    el.querySelector("[data-status-label]").textContent = message || "";
    el.dataset.statusKind = tone || "info";
  }
  async function readJson(response) {
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
    return body;
  }

  // Identify a restaurant by its ONOU depot id when known: the same canteen can carry
  // different catalogIds in the static catalog and the live list. Fall back to catalogId.
  function selectionKey(r) {
    if (!r) return null;
    var idDepot = Number(r.idDepot);
    if (Number.isInteger(idDepot) && idDepot > 0) return "depot:" + idDepot;
    return r.catalogId ? "catalog:" + r.catalogId : null;
  }

  var selectedKey = null;

  // Mark the currently-selected restaurant in the list
  function highlightSelection() {
    if (!yourRestaurants) return;
    yourRestaurants.querySelectorAll("[data-selection-key]").forEach(function(el) {
      el.setAttribute("aria-pressed", selectedKey && el.dataset.selectionKey === selectedKey ? "true" : "false");
    });
  }

  // Save the chosen restaurant as the user's default and update the panels
  async function selectRestaurant(r) {
    if (yourRestaurantsMessage) setMessage(yourRestaurantsMessage, "", "info");
    try {
      await readJson(await fetch("/webetu/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ restaurant: r })
      }));
      selectedKey = selectionKey(r);
      highlightSelection();
      if (yourRestaurantsMessage) setMessage(yourRestaurantsMessage, "Restaurant preference saved.", "complete");
      document.dispatchEvent(new CustomEvent(${JSON.stringify(RESTAURANT_SELECTED_EVENT)}));
    } catch (err) {
      if (yourRestaurantsMessage) setMessage(yourRestaurantsMessage, err.message || "Could not save restaurant preference.", "error");
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
      btn.dataset.selectionKey = selectionKey(r) || "";
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = r.name || r.catalogId || "Unknown";
      btn.addEventListener("click", function() { selectRestaurant(r); });
      container.appendChild(btn);
    });
  }

  // Reflect the saved default in the selection highlight
  async function loadPreferences() {
    if (hideFallbackDefault) return;
    try {
      var prefs = await readJson(await fetch("/webetu/preferences", { method: "GET", credentials: "same-origin" }));
      if (prefs && prefs.defaultRestaurant) {
        selectedKey = selectionKey(prefs.defaultRestaurant);
      }
    } catch (e) {}
  }

  // Your Restaurants panel: the user's live ONOU restaurants (falls back to catalog server-side)
  // showPlaceholder is false for a manual refresh so the current options stay on
  // screen while the request runs, instead of blanking out and jumping the layout.
  async function loadYourRestaurants(showPlaceholder) {
    if (!yourRestaurants) return;
    if (showPlaceholder !== false) yourRestaurants.innerHTML = "<p>Loading restaurants…</p>";
    try {
      var data = await readJson(await fetch("/webetu/restaurants/live", { method: "GET", credentials: "same-origin", cache: "no-store" }));
      renderOptions(yourRestaurants, data.restaurants || []);
    } catch (err) {
      yourRestaurants.innerHTML = "<p>Could not load restaurants.</p>";
      if (yourRestaurantsMessage) setMessage(yourRestaurantsMessage, err.message || "Could not load restaurants.", "error");
    }
  }

  // Manual refetch of the live list: the ONOU read-API can be slow or briefly
  // unavailable, and without this the only way out of "Could not load restaurants."
  // is a full page reload.
  var isRefreshing = false;
  async function refreshYourRestaurants() {
    if (isRefreshing) return;
    isRefreshing = true;
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.dataset.loading = "true";
    }
    if (yourRestaurantsMessage) setMessage(yourRestaurantsMessage, "", "info");
    try {
      await loadYourRestaurants(false);
      highlightSelection();
    } finally {
      isRefreshing = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        delete refreshButton.dataset.loading;
      }
    }
  }

  if (refreshButton) refreshButton.addEventListener("click", refreshYourRestaurants);

  async function loadRestaurants() {
    await loadPreferences();
    await loadYourRestaurants(true);
    highlightSelection();
  }

  loadRestaurants();
})();
`;

type RestaurantPickerProps = {
  // Onboarding asks the user to pick explicitly, so the fallback default is not
  // shown as selected until they have saved a choice of their own.
  requireExplicitChoice?: boolean;
  hasSavedDefault?: boolean;
};

// Shared restaurant selection list for the meal-reservation page and onboarding.
export function RestaurantPicker({ requireExplicitChoice = false, hasSavedDefault = false }: RestaurantPickerProps) {
  return (
    <>
      <section
        className="panel panel-narrow"
        aria-labelledby="your-restaurants-title"
        data-restaurant-panel
        data-require-choice={requireExplicitChoice ? "true" : undefined}
        data-has-saved-default={hasSavedDefault ? "true" : undefined}
      >
        <div className="panel-head">
          <div>
            <h2 id="your-restaurants-title" className="panel-title">
              Your Restaurants
              <InfoHint label="Your Restaurants">
                Restaurants available for your meal reservations.
              </InfoHint>
            </h2>
          </div>
          <button
            type="button"
            className="restaurant-refresh"
            data-your-restaurants-refresh
            aria-label="Refresh restaurant list"
            title="Refresh restaurant list"
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
        <div data-your-restaurants className="restaurant-list">
          <p>Loading restaurants&hellip;</p>
        </div>
        <StatusNotice data-your-restaurants-message />
      </section>
      <script dangerouslySetInnerHTML={{ __html: pickerScript }} />
    </>
  );
}
