"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type Status = "checking" | "online" | "offline";

const ENDPOINT = "/health";
const REQUEST_TIMEOUT_MS = 8_000;
const HEALTHY_INTERVAL_MS = 60_000;
const UNHEALTHY_INTERVAL_MS = 20_000;

/**
 * One failed probe is usually a blip -- a dropped packet, a redeploy, a laptop
 * waking up. Flipping the badge on the first miss makes it flicker, so the badge
 * only goes amber once two checks in a row have failed.
 */
const FAILURES_BEFORE_OFFLINE = 2;

const LABELS: Record<Status, string> = {
  checking: "Checking server status",
  online: "Server online",
  offline: "Server offline",
};

function relativeTime(at: number | null): string {
  if (at === null) return "";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

/**
 * A quiet backend-reachability badge for the top-right of every screen.
 *
 * Polls the same-origin `/health` route, which proxies the worker's liveness
 * check. Deliberately understated: a dot plus a small label on desktop, and the
 * bare dot under 560px (CSS hides the label), with the full wording kept in the
 * button's accessible name and in the popover.
 */
export function BackendStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const failuresRef = useRef(0);
  /** Guards every state write once the component has unmounted. */
  const activeRef = useRef(true);
  /** Holds the latest check() so the scheduling effect never re-subscribes. */
  const checkRef = useRef<() => void>(() => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const check = useCallback(async () => {
    clearTimer();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Distinguished from an abort by a newer check or by unmount: a request we
    // time out ourselves is a failed probe and must still schedule the next one.
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    let reachable = false;
    try {
      const res = await fetch(ENDPOINT, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      // A non-2xx or a network error means this app is unreachable, which is
      // just as much "down" from the user's seat as the worker being down.
      const body = res.ok ? await res.json().catch(() => null) : null;
      reachable = body?.reachable === true;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timeout);
    }

    if (!activeRef.current) return;
    // Superseded by a newer check, or paused because the tab went away. That
    // path owns the scheduling from here.
    if (controller.signal.aborted && !timedOut) return;

    if (reachable) {
      failuresRef.current = 0;
      setStatus("online");
    } else {
      failuresRef.current += 1;
      if (failuresRef.current >= FAILURES_BEFORE_OFFLINE) setStatus("offline");
    }
    setCheckedAt(Date.now());

    // Chained timeout rather than an interval: a slow probe can never stack up
    // behind itself. Poll harder while down so a recovery shows up quickly.
    timerRef.current = setTimeout(
      () => void checkRef.current(),
      reachable ? HEALTHY_INTERVAL_MS : UNHEALTHY_INTERVAL_MS,
    );
  }, [clearTimer]);

  useEffect(() => {
    checkRef.current = () => void check();
  }, [check]);

  useEffect(() => {
    activeRef.current = true;
    void check();

    // Polling a hidden tab buys nothing, so it pauses and catches up on return.
    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        clearTimer();
        abortRef.current?.abort();
      } else {
        void checkRef.current();
      }
    }
    function handleOnline() {
      void checkRef.current();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    return () => {
      activeRef.current = false;
      clearTimer();
      abortRef.current?.abort();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
    };
  }, [check, clearTimer]);

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const popoverId = useId();
  const label = LABELS[status];
  const checked = relativeTime(checkedAt);

  return (
    <div className="backend-status-wrap" ref={containerRef} data-status={status}>
      <button
        type="button"
        className="backend-status"
        data-status={status}
        aria-label={checked ? `${label}. Last checked ${checked}.` : label}
        aria-busy={status === "checking"}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="backend-status-dot" aria-hidden="true" />
        <span className="backend-status-label" aria-live="polite">
          {status === "checking" ? "" : label}
        </span>
      </button>
      <div
        id={popoverId}
        role="status"
        className="backend-status-popover"
        data-open={open ? "true" : "false"}
        hidden={!open}
      >
        <p className="backend-status-popover-title">{label}</p>
        <p className="backend-status-popover-body">
          {status === "offline"
            ? "The server isn't responding right now. This happens from time to time and usually clears within a few minutes. Your settings and reservations are safe."
            : status === "online"
              ? "The reservation server is reachable."
              : "Contacting the reservation server..."}
        </p>
        {checked ? <p className="backend-status-popover-meta">Last checked {checked}</p> : null}
        <button
          type="button"
          className="secondary backend-status-recheck"
          onClick={() => void check()}
        >
          Check again
        </button>
      </div>
    </div>
  );
}
