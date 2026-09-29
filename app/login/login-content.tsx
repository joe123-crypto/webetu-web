"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithCredential,
  type Auth,
  type User,
} from "firebase/auth";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import {
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
import {
  PARENT_BRAND,
  PARENT_LOGO_SRC,
  PRODUCT_FULL_NAME,
  PRODUCT_NAME,
} from "@/src/lib/brand";

type Phase =
  | "loading"
  | "ready"
  | "google"
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
  const completionRef = useRef<Promise<void> | null>(null);
  const finishRef = useRef(false);
  const actionInProgressRef = useRef(false);
  const searchParams = useSearchParams();
  const nextParam = safeNext(searchParams.get("next"));
  const codeParam = searchParams.get("code");
  const busy = !auth || !settings || ["loading", "google", "session", "redirecting", "success"].includes(phase);

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

  const finishGoogleSignIn = useCallback(async (authInstance: Auth, code: string) => {
    if (finishRef.current) return;
    finishRef.current = true;
    setPhase("session");
    setNotice({ kind: "loading", message: "Finishing sign in..." });
    try {
      // Exchange the authorization code for a Google id_token server-side
      // (the client secret must never reach the browser).
      const exchange = await fetch("/auth/google/finish/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code }),
      });
      const exchangeBody = (await exchange.json().catch(() => ({}))) as {
        id_token?: string;
        error?: string;
      };
      if (!exchange.ok || !exchangeBody.id_token) {
        throw new Error(exchangeBody.error || "Could not complete Google sign-in. Please try again.");
      }

      // Sign the Google credential into the Firebase client SDK, then mint the
      // server session cookie from the resulting Firebase ID token.
      const credential = GoogleAuthProvider.credential(exchangeBody.id_token);
      const result = await signInWithCredential(authInstance, credential);
      const firebaseIdToken = await result.user.getIdToken(true);
      const session = await createAndVerifyServerSession(firebaseIdToken, result.user.uid);
      setPhase("success");
      setNotice({ kind: "complete", message: "Signed in. Opening your account..." });
      window.location.assign(destinationForSession(session, nextParam));
    } catch (error) {
      finishRef.current = false;
      setPhase("error");
      setNotice({ kind: "error", message: authErrorDetails(error).message });
    }
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

        if (codeParam) {
          // Returning from the Google OAuth redirect: complete sign-in here on
          // the login page instead of on a separate finish page. Drop the code
          // from the URL so a manual retry starts clean.
          const url = new URL(window.location.href);
          url.searchParams.delete("code");
          window.history.replaceState(null, "", url.pathname + url.search);
          await finishGoogleSignIn(authInstance, codeParam);
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
  }, [completeSession, finishGoogleSignIn, codeParam]);

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

  return (
    <main className="app-main app-main-center">
      <div className="auth-shell">
        <section className="auth-panel">
          <div className="brand-lockup">
            <h1 className="brand-wordmark">{PRODUCT_NAME}</h1>
            <p className="brand-fullname">{PRODUCT_FULL_NAME}</p>
          </div>
          <p>Sign in to automate your student meal reservations on Webetu.</p>
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
        </section>
        <a
          className="brand-endorsement"
          href="https://genaie.site"
          target="_blank"
          rel="noreferrer"
          aria-label={`${PRODUCT_NAME} — a ${PARENT_BRAND} product`}
        >
          <span>by</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PARENT_LOGO_SRC} alt={PARENT_BRAND} />
        </a>
      </div>
    </main>
  );
}
