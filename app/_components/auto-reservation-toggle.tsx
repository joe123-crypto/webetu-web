"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { StatusNotice } from "@/app/_components/status-ui";

const ENDPOINT = "/webetu/preferences/auto-reservation";
const RUN_ENDPOINT = "/webetu/run/manual";

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed with ${response.status}`);
  }
  return body as { enabled?: boolean };
}

export function AutoReservationToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runResult, setRunResult] = useState<
    { kind: "complete" | "error"; message: string } | null
  >(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // Stop the faux-progress interval if the component unmounts mid-run.
  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  function stopProgress() {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }

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
        err instanceof Error ? err.message : "Could not update automatic reservation."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleManualRun() {
    if (runBusy) return;
    setRunBusy(true);
    setRunResult(null);
    setRunProgress(0);

    // The backend returns a single response with no incremental progress, so ease a
    // faux-progress fill toward ~90% and decelerate so it never lands on 100 itself.
    stopProgress();
    progressTimer.current = setInterval(() => {
      setRunProgress((p) => Math.min(89.5, p + Math.max(0.5, (90 - p) * 0.05)));
    }, 200);

    try {
      const response = await fetch(RUN_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed with ${response.status}`);
      }
      stopProgress();
      setRunProgress(100);
      setRunResult({
        kind: "complete",
        message:
          typeof body?.summary === "string" && body.summary
            ? body.summary
            : "Reservation run complete.",
      });
    } catch (err) {
      stopProgress();
      setRunProgress(100);
      setRunResult({
        kind: "error",
        message: err instanceof Error ? err.message : "Reservation run failed.",
      });
    } finally {
      stopProgress();
      setRunBusy(false);
      // Snap to 100 briefly (above), then reset the fill.
      setTimeout(() => setRunProgress(0), 400);
    }
  }

  return (
    <section className="panel auto-reservation-panel" aria-labelledby={labelId}>
      <div className="auto-reservation-actions">
        <div className="switch-row">
          <span id={labelId} className="switch-label">
            Automatic Reservation
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
        <button
          type="button"
          className="secondary manual-run-button"
          disabled={runBusy}
          onClick={handleManualRun}
        >
          <span
            className="manual-run-progress"
            style={{ width: `${runProgress}%` }}
            aria-hidden="true"
          />
          <span className="manual-run-label">
            {runBusy ? (
              <>
                <LoaderCircle className="manual-run-spinner" aria-hidden="true" />
                Reserving… {Math.round(runProgress)}%
              </>
            ) : (
              "Manual Run"
            )}
          </span>
        </button>
      </div>
      {error && (
        <StatusNotice kind="error" variant="message">
          {error}
        </StatusNotice>
      )}
      {runResult && (
        <StatusNotice kind={runResult.kind} variant="message">
          {runResult.message}
        </StatusNotice>
      )}
    </section>
  );
}
