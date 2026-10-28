"use client";

import { useEffect, useId, useRef, useState } from "react";
import { StatusNotice } from "@/app/_components/status-ui";
import { endDashboardSession } from "@/app/_components/dashboard-account-menu";

export function RemoveAccount({ pending = false }: { pending?: boolean }) {
  const [open, setOpen] = useState(pending);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reauthenticate, setReauthenticate] = useState(false);
  const [removed, setRemoved] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const titleId = useId();
  const warningId = useId();
  const inputId = useId();

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  function cancel() {
    if (submitting.current) return;
    setOpen(false);
    setConfirmation("");
    setError("");
    setReauthenticate(false);
    trigger.current?.focus();
  }

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || confirmation !== "DELETE") return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setReauthenticate(false);
    let serverError = "";
    try {
      const response = await fetch("/auth/account/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ confirmation }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok !== true) {
        setReauthenticate(response.status === 401);
        serverError = typeof body.error === "string" ? body.error : "";
        throw new Error("Removal not confirmed");
      }
      // Auth was deleted on the server. Clearing the local SDK state is best effort
      // and cannot turn confirmed deletion into an error or recreate the account.
      try {
        const client = await import("@/src/firebase/client");
        const settings = await client.loadFirebaseClientSettings();
        const { signOut } = await import("firebase/auth");
        await signOut(client.initializeFirebaseClient(settings));
      } catch { /* the deleted server identity is authoritative */ }
      setOpen(false);
      setRemoved(true);
    } catch {
      setError(serverError || "Removal could not be confirmed. Some data may already be deleted. Retry removal here.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (removed) return (
    <section className="panel panel-narrow dashboard-form-panel" role="status">
      <h2>Account removed</h2>
      <p>Your application data and Firebase Authentication account have been deleted.</p>
      <a className="button secondary" href="/login">Return to sign in</a>
    </section>
  );

  return (
    <section className="panel panel-narrow dashboard-form-panel remove-account-panel">
      {pending ? <p>Account removal is incomplete. Retry to finish deleting your account.</p> : null}
      <button className="danger" type="button" ref={trigger} onClick={() => setOpen(true)}>
        {pending ? "Retry Account Removal" : "Remove Account"}
      </button>
      <dialog
        ref={dialog}
        className="remove-account-dialog"
        aria-labelledby={titleId}
        aria-describedby={warningId}
        onCancel={(event) => { event.preventDefault(); cancel(); }}
      >
        <form onSubmit={remove}>
          <h2 id={titleId}>Permanently remove your account?</h2>
          <div id={warningId} className="remove-account-warning">
            <p><strong>This action cannot be undone.</strong></p>
            <p>Your Webetu web account, stored details, and associated application data will be permanently deleted, including your saved credentials, preferences, reservation history, and Firebase sign-in account. You will lose access to this account.</p>
          </div>
          <label htmlFor={inputId}>Type <strong>DELETE</strong> to confirm permanent removal</label>
          <input id={inputId} autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />
          {error ? <StatusNotice kind="error" variant="message">{error}</StatusNotice> : null}
          {reauthenticate ? (
            <button type="button" className="secondary" disabled={busy} onClick={async () => {
              try { await endDashboardSession(); }
              catch { setError("Could not sign out. Please try again."); }
            }}>Sign out and sign in again</button>
          ) : null}
          <div className="remove-account-actions">
            <button autoFocus type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button>
            <button type="submit" className="danger" disabled={busy || confirmation !== "DELETE"}>
              {busy ? "Removing account…" : "Permanently Delete Account"}
            </button>
          </div>
          {busy ? <p role="status">Deleting your account. Keep this page open until removal is confirmed.</p> : null}
        </form>
      </dialog>
    </section>
  );
}
