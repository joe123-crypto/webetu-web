"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  sendSignInLinkToEmail,
  type Auth,
  type User,
} from "firebase/auth";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import {
  AUTH_NEXT_STORAGE_KEY,
  authErrorDetails,
  createAndVerifyServerSession,
  destinationForSession,
  safeNext,
} from "@/src/auth/login";
import {
  initializeFirebaseClient,
  loadFirebaseClientSettings,
  type FirebaseClientSettings,
} from "@/src/firebase/client";

const EMAIL_STORAGE_KEY = "webetuEmailForSignIn";

type Phase =
  | "loading"
  | "ready"
  | "google"
  | "email"
  | "session"
  | "redirecting"
  | "success"
  | "error";

type Notice = { kind: StatusKind; message: string };

export function LoginContent() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [settings, setSettings] = useState<FirebaseClientSettings | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [notice, setNotice] = useState<Notice>({
    kind: "loading",
    message: "Preparing secure sign-in...",
  });
  const [email, setEmail] = useState("");
  const completionRef = useRef<Promise<void> | null>(null);
  const actionInProgressRef = useRef(false);
  const searchParams = useSearchParams();
  const nextParam = safeNext(searchParams.get("next"));
  const busy = !auth || !settings || ["loading", "google", "email", "session", "redirecting", "success"].includes(phase);

  const completeSession = useCallback((user: User, redirectNext?: string | null) => {
    if (completionRef.current) return completionRef.current;

    const task = (async () => {
      setPhase("session");
      setNotice({ kind: "loading", message: "Finishing sign-in..." });
      const idToken = await user.getIdToken(true);
      const session = await createAndVerifyServerSession(idToken, user.uid);
      setPhase("success");
      setNotice({ kind: "complete", message: "Signed in. Opening your account..." });
      window.location.assign(destinationForSession(session, redirectNext || nextParam));
    })()
      .catch((error: unknown) => {
        const details = authErrorDetails(error);
        setPhase("error");
        setNotice({ kind: "error", message: details.message });
      })
      .finally(() => {
        completionRef.current = null;
      });

    completionRef.current = task;
    return task;
  }, [nextParam]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const loadedSettings = await loadFirebaseClientSettings();
        const authInstance = initializeFirebaseClient(loadedSettings);
        if (!active) return;
        setSettings(loadedSettings);
        setAuth(authInstance);
        await authInstance.authStateReady();
        if (!active) return;

        const signedInUser = authInstance.currentUser;
        if (signedInUser) {
          await completeSession(signedInUser);
          return;
        }

        setPhase("ready");
        setNotice({ kind: "info", message: "Choose a sign-in method." });
      } catch (error) {
        if (!active) return;
        const details = authErrorDetails(error);
        setPhase("error");
        setNotice({ kind: "error", message: details.message });
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [completeSession]);

  async function handleCombinedGoogleSignIn() {
    if (busy || actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setPhase("redirecting");
    setNotice({ kind: "loading", message: "Continuing to Google..." });

    try {
      const response = await fetch("/auth/google/signin", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ next: nextParam }),
      });
      const body = await response.json().catch(() => ({}) as { url?: string; error?: string });
      if (!response.ok || !body?.url) {
        throw new Error(body?.error || "Could not start Google sign-in.");
      }
      window.location.href = body.url;
    } catch (error) {
      setPhase("error");
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not start Google sign-in.",
      });
      actionInProgressRef.current = false;
    }
  }

  async function handleEmailSignIn() {
    if (!auth || !settings || busy || actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setPhase("email");
    setNotice({ kind: "loading", message: "Sending your secure sign-in link..." });
    try {
      const actionCodeSettings = {
        url: `${settings.emailLinkUrl}?next=${encodeURIComponent(nextParam)}`,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(auth, email.trim(), actionCodeSettings);
      window.localStorage.setItem(EMAIL_STORAGE_KEY, email.trim());
      setPhase("ready");
      setNotice({ kind: "complete", message: `Sign-in link sent to ${email.trim()}.` });
    } catch (error) {
      const details = authErrorDetails(error);
      setPhase("error");
      setNotice({ kind: "error", message: details.message });
    } finally {
      actionInProgressRef.current = false;
    }
  }

  return (
    <main className="app-main app-main-center">
      <div className="auth-shell">
        <section className="auth-panel">
          <h1 style={{ fontSize: "2rem", fontWeight: 800 }}>Webetu</h1>
          <p>Sign in to manage your student meal reservations.</p>
          <StatusNotice kind={notice.kind} role="status" aria-live="polite">
            {notice.message}
          </StatusNotice>
          <button
            className="full-width"
            type="button"
            disabled={busy}
            onClick={() => void handleCombinedGoogleSignIn()}
          >
            {phase === "success"
              ? "Signed in"
              : phase === "redirecting"
              ? "Continuing to Google..."
              : "Continue with Google"}
          </button>
          <div className="divider"><span>or</span></div>
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleEmailSignIn();
            }}
          >
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              required
            />
            <button className="full-width" type="submit" disabled={busy || !email.trim()}>
              {phase === "email" ? "Sending..." : "Send Magic Link"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
