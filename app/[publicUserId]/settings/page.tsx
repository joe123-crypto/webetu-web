import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { getWebetuCredentialStatus, getWebetuUsername } from "@/src/domains/webetu";
import { validatePublicUserId } from "@/src/lib/utils";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";
import { EmailNotificationToggle } from "@/app/_components/email-notification-toggle";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Webetu | Settings",
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
})();
`;

  return (
    <>
      <DashboardShell active="settings" publicUserId={publicUserId} userLabel={userLabel}>
        <div className="dashboard-topbar">
          <h1>Settings</h1>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          <span className="settings-tab is-active" role="tab" aria-selected="true">
            Credentials Vault
          </span>
        </div>

        {/* Credentials Vault */}
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
                defaultValue={savedUsername ?? ""}
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

        <EmailNotificationToggle />
      </DashboardShell>
      <script dangerouslySetInnerHTML={{ __html: pageScript }} />
    </>
  );
}
