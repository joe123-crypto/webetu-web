"use client";

import { useEffect, useId, useState } from "react";
import { StatusNotice } from "@/app/_components/status-ui";

const ENDPOINT = "/webetu/preferences/email-notifications";

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed with ${response.status}`);
  }
  return body as { enabled?: boolean };
}

export function EmailNotificationToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const labelId = useId();

  // Best-effort hydrate from the backend. Failures (e.g. route not built yet)
  // leave the switch at its default without surfacing an error.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const body = await readJson(
          await fetch(ENDPOINT, { method: "GET", credentials: "same-origin" })
        );
        if (active && typeof body.enabled === "boolean") setEnabled(body.enabled);
      } catch {
        /* keep default */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleToggle() {
    if (busy) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setBusy(true);
    setError("");
    try {
      const body = await readJson(
        await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ enabled: next }),
        })
      );
      if (typeof body.enabled === "boolean") setEnabled(body.enabled);
    } catch (err) {
      setEnabled(!next); // revert
      setError(
        err instanceof Error ? err.message : "Could not update email notifications."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel panel-narrow dashboard-form-panel email-notification-panel"
      aria-labelledby={labelId}
    >
      <div className="switch-row">
        <span id={labelId} className="switch-label">
          Email notification
        </span>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={enabled}
          aria-labelledby={labelId}
          disabled={busy}
          onClick={handleToggle}
        >
          <span className="switch-thumb" aria-hidden="true" />
        </button>
      </div>
      {error && (
        <StatusNotice kind="error" variant="message">
          {error}
        </StatusNotice>
      )}
    </section>
  );
}
