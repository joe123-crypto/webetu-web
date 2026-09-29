import { StatusNotice, StatusPill, type StatusKind } from "@/app/_components/status-ui";
import { InfoHint } from "@/app/_components/info-hint";

export type CredentialsVaultProps = {
  savedUsername?: string | null;
  webetuLabel: string;
  webetuKind: StatusKind;
  webetuSaveLabel: string;
  webetuConfigured: boolean;
};

// Client logic for the Webetu credentials vault. Colocated with the markup so
// the section can be reused (settings page and onboarding) without duplicating
// the behavior. The script is self-contained: it queries the data-* hooks below
// and runs on initial HTML load.
const vaultScript = `
(function() {
  var webetuForm = document.querySelector("[data-webetu-form]");
  var webetuUsername = document.querySelector("[data-webetu-username]");
  var webetuPassword = document.querySelector("[data-webetu-password]");
  var webetuPasswordToggle = document.querySelector("[data-webetu-password-toggle]");
  var webetuSaveButton = document.querySelector("[data-webetu-save]");
  var webetuRevokeButton = document.querySelector("[data-webetu-revoke]");
  var webetuStatusEl = document.querySelector("[data-webetu-status]");
  var webetuMessage = document.querySelector("[data-webetu-message]");

  if (!webetuForm) return;

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

// The Credentials Vault section: save/update/revoke Webetu credentials used for
// automatic meal reservations. Rendered on the settings page and during onboarding.
export function CredentialsVault({
  savedUsername,
  webetuLabel,
  webetuKind,
  webetuSaveLabel,
  webetuConfigured,
}: CredentialsVaultProps) {
  return (
    <>
      <section className="panel panel-narrow dashboard-form-panel" aria-labelledby="cred-title">
        <div className="panel-head">
          <div>
            <h2 id="cred-title" className="panel-title">
              Credentials Vault
              <InfoHint label="Credentials Vault">
                Save the Webetu credentials used for automatic meal reservations.
              </InfoHint>
            </h2>
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
      <script dangerouslySetInnerHTML={{ __html: vaultScript }} />
    </>
  );
}
