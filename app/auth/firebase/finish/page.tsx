"use client";

import { useEffect, useRef, useState } from "react";
import { isSignInWithEmailLink, signInWithEmailLink, type Auth } from "firebase/auth";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import {
  authErrorDetails,
  createAndVerifyServerSession,
  destinationForSession,
  safeNext,
} from "@/src/auth/login";
import { initializeFirebaseClient, loadFirebaseClientSettings } from "@/src/firebase/client";

const EMAIL_STORAGE_KEY = "webetuEmailForSignIn";

export default function FirebaseFinishPage() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [email, setEmail] = useState("");
  const [needsEmail, setNeedsEmail] = useState(false);
  const [busy, setBusy] = useState(true);
  const completingRef = useRef(false);
  const [notice, setNotice] = useState<{ kind: StatusKind; message: string }>({
    kind: "loading",
    message: "Checking sign-in link...",
  });

  async function finish(authInstance: Auth, confirmedEmail: string) {
    if (completingRef.current) return;
    completingRef.current = true;
    setBusy(true);
    setNotice({ kind: "loading", message: "Finishing sign-in..." });
    try {
      const result = await signInWithEmailLink(authInstance, confirmedEmail, window.location.href);
      const idToken = await result.user.getIdToken(true);
      const session = await createAndVerifyServerSession(idToken, result.user.uid);
      window.localStorage.removeItem(EMAIL_STORAGE_KEY);
      setNotice({ kind: "complete", message: "Signed in. Opening your account..." });
      const nextPath = safeNext(new URLSearchParams(window.location.search).get("next"));
      window.location.assign(destinationForSession(session, nextPath));
    } catch (error) {
      setNotice({ kind: "error", message: authErrorDetails(error).message });
      setBusy(false);
      completingRef.current = false;
    }
  }

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const settings = await loadFirebaseClientSettings();
        const authInstance = initializeFirebaseClient(settings);
        if (!active) return;
        setAuth(authInstance);
        if (!isSignInWithEmailLink(authInstance, window.location.href)) {
          setNotice({ kind: "error", message: "This sign-in link is not valid for this app." });
          setBusy(false);
          return;
        }
        const storedEmail = window.localStorage.getItem(EMAIL_STORAGE_KEY);
        if (storedEmail) {
          await finish(authInstance, storedEmail);
          return;
        }
        setNeedsEmail(true);
        setBusy(false);
        setNotice({ kind: "info", message: "Confirm the email address used to request the link." });
      } catch (error) {
        if (!active) return;
        setNotice({ kind: "error", message: authErrorDetails(error).message });
        setBusy(false);
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-main app-main-center">
      <section className="panel panel-narrow">
        <a className="toplink" href="/login">Back to sign in</a>
        <h1>Finish sign in</h1>
        <p>The app is completing your email-link sign-in.</p>
        {needsEmail ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (auth && email.trim()) void finish(auth, email.trim());
            }}
          >
            <label className="field" htmlFor="email">Confirm email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              required
            />
            <div className="actions actions-spaced">
              <button type="submit" disabled={busy || !email.trim()}>
                {busy ? "Finishing..." : "Finish sign in"}
              </button>
            </div>
          </form>
        ) : null}
        <StatusNotice kind={notice.kind} role="status" aria-live="polite" variant="block">
          {notice.message}
        </StatusNotice>
      </section>
    </main>
  );
}
