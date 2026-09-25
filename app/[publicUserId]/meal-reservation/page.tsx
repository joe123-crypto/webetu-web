import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getWebetuCredentialStatus } from "@/src/domains/webetu";
import { validatePublicUserId } from "@/src/lib/utils";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Webetu | Meal Reservation",
  description: "Manage your Webetu meal reservation credentials and restaurant preferences.",
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

  const webetuStatus = await getWebetuCredentialStatus(uid).catch(() => null);
  const webetuConfigured = !!webetuStatus?.configured;
  const webetuLabel = webetuConfigured
    ? "Saved"
    : webetuStatus?.status === "revoked"
    ? "Revoked"
    : webetuStatus
    ? "Not saved"
    : "Unavailable";
  const webetuKind = webetuConfigured
    ? "complete"
    : webetuStatus?.status === "revoked"
    ? "revoked"
    : webetuStatus
    ? "pending"
    : "error";
  const webetuSaveLabel = webetuConfigured ? "Update credentials" : "Save credentials";

  const pageScript = `
(function() {
  var webetuForm = document.querySelector("[data-webetu-form]");
  var webetuUsername = document.querySelector("[data-webetu-username]");
  var webetuPassword = document.querySelector("[data-webetu-password]");
  var webetuPasswordToggle = document.querySelector("[data-webetu-password-toggle]");
  var webetuSaveButton = document.querySelector("[data-webetu-save]");
  var webetuRevokeButton = document.querySelector("[data-webetu-revoke]");
  var webetuStatusEl = document.querySelector("[data-webetu-status]");
  var webetuMessage = document.querySelector("[data-webetu-message]");
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
  function setBusy(value) {
    if (webetuSaveButton) webetuSaveButton.disabled = value;
    if (webetuRevokeButton) webetuRevokeButton.disabled = value;
  }
  function setPasswordVisible(value) {
    webetuPassword.type = value ? "text" : "password";
    webetuPasswordToggle.textContent = value ? "Hide" : "Show";
    webetuPasswordToggle.setAttribute("aria-label", value ? "Hide Webetu password" : "Show Webetu password");
    webetuPasswordToggle.setAttribute("aria-pressed", value ? "true" : "false");
  }
  async function readJson(response) {
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
    return body;
  }
  function webetuStatusLabel(status) {
    if (status && status.configured) return "Saved";
    if (status && status.status === "revoked") return "Revoked";
    if (status && status.status === "not_saved") return "Not saved";
    return "Unavailable";
  }
  async function loadWebetuStatus() {
    setPill(webetuStatusEl, "Checking...", "loading");
    try {
      var status = await readJson(await fetch("/webetu/credentials/status", { method: "GET", credentials: "same-origin" }));
      var label = webetuStatusLabel(status);
      setPill(webetuStatusEl, label, status.configured ? "complete" : status.status === "revoked" ? "revoked" : status.status === "not_saved" ? "pending" : "error");
      if (webetuSaveButton) webetuSaveButton.textContent = status.configured ? "Update credentials" : "Save credentials";
      if (webetuRevokeButton) webetuRevokeButton.hidden = !status.configured;
    } catch (err) {
      setPill(webetuStatusEl, "Unavailable", "error");
    }
  }

  if (webetuForm) {
    webetuForm.addEventListener("submit", async function(event) {
      event.preventDefault();
      setBusy(true);
      setMessage(webetuMessage, "", "info");
      try {
        await readJson(await fetch("/webetu/credentials", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ username: webetuUsername.value, password: webetuPassword.value })
        }));
        webetuPassword.value = "";
        setPasswordVisible(false);
        setMessage(webetuMessage, "Webetu credentials saved.", "complete");
        await loadWebetuStatus();
      } catch (err) {
        setMessage(webetuMessage, err.message || "Could not save Webetu credentials.", "error");
      } finally { setBusy(false); }
    });
  }

  if (webetuRevokeButton) {
    webetuRevokeButton.addEventListener("click", async function() {
      setBusy(true);
      setMessage(webetuMessage, "", "info");
      try {
        await readJson(await fetch("/webetu/credentials/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: "{}"
        }));
        webetuPassword.value = "";
        setPasswordVisible(false);
        setMessage(webetuMessage, "Webetu credentials revoked.", "complete");
        await loadWebetuStatus();
      } catch (err) {
        setMessage(webetuMessage, err.message || "Could not revoke Webetu credentials.", "error");
      } finally { setBusy(false); }
    });
  }

  if (webetuPasswordToggle) {
    webetuPasswordToggle.addEventListener("click", function() {
      setPasswordVisible(webetuPassword.type === "password");
      webetuPassword.focus();
    });
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

        {/* Credential panel */}
        <section className="panel panel-narrow dashboard-form-panel" aria-labelledby="cred-title">
          <div className="panel-head">
            <div>
              <h2 id="cred-title">Webetu Account</h2>
              <p>Save the Webetu credentials used for automatic meal reservations.</p>
            </div>
            <StatusPill data-webetu-status kind={webetuKind}>{webetuLabel}</StatusPill>
          </div>
          <form className="form-stack" data-webetu-form>
            <label>
              Webetu username
              <input
                data-webetu-username
                name="username"
                autoComplete="username"
                maxLength={120}
                required
              />
            </label>
            <label>
              Webetu password
              <span className="password-field">
                <input
                  data-webetu-password
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={256}
                  required
                />
                <button
                  className="password-toggle"
                  data-webetu-password-toggle
                  type="button"
                  aria-label="Show Webetu password"
                  aria-pressed="false"
                >
                  Show
                </button>
              </span>
            </label>
            <div className="actions">
              <button data-webetu-save type="submit">
                {webetuSaveLabel}
              </button>
              <button
                className="danger"
                data-webetu-revoke
                type="button"
                hidden={!webetuConfigured}
              >
                Revoke
              </button>
            </div>
          </form>
          <StatusNotice data-webetu-message />
        </section>

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
