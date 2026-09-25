"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut, ShieldCheck, UserRound } from "lucide-react";

export async function endDashboardSession(
  fetcher: typeof fetch = fetch,
  redirect: (url: string) => void = (url) => window.location.assign(url),
) {
  const response = await fetcher("/auth/session/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  });
  if (!response.ok) throw new Error("Could not sign out. Please try again.");

  try {
    const firebaseClient = await import("@/src/firebase/client");
    const settings = await firebaseClient.loadFirebaseClientSettings(fetcher);
    const { signOut } = await import("firebase/auth");
    await signOut(firebaseClient.initializeFirebaseClient(settings));
  } catch {
    // The server session is authoritative; Firebase cleanup is best effort.
  }
  redirect("/login");
}

type DashboardAccountMenuProps = {
  userLabel?: string | null;
};

export function DashboardAccountMenu({ userLabel = "Account" }: DashboardAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const displayLabel = userLabel || "Account";
  const buttonLabel = userLabel ? `Account menu for ${displayLabel}` : "Account menu";

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setBusy(true);
    setError("");
    try {
      await endDashboardSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-account" ref={rootRef}>
      <button
        className="dashboard-user"
        type="button"
        ref={buttonRef}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={buttonLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dashboard-user-avatar" aria-hidden="true">
          <UserRound />
        </span>
        <span className="dashboard-user-label">{displayLabel}</span>
        <ChevronDown className={open ? "is-open" : undefined} aria-hidden="true" />
      </button>
      {open ? (
        <div className="dashboard-account-menu" id={menuId} role="menu">
          <a href="/privacy-policy" role="menuitem">
            <ShieldCheck aria-hidden="true" />
            Privacy &amp; Policy
          </a>
          <button type="button" role="menuitem" disabled={busy} onClick={handleSignOut}>
            <LogOut aria-hidden="true" />
            {busy ? "Signing out..." : "Sign out"}
          </button>
        </div>
      ) : null}
      {error ? <p className="dashboard-account-error" role="alert">{error}</p> : null}
    </div>
  );
}
