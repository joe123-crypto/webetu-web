"use client";

import { useEffect, useRef, useState } from "react";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import {
  authErrorDetails,
  createAndVerifyServerSession,
  destinationForSession,
  safeNext,
} from "@/src/auth/login";
import { initializeFirebaseClient, loadFirebaseClientSettings } from "@/src/firebase/client";

export default function GoogleFinishPage() {
  const completingRef = useRef(false);
  const [notice, setNotice] = useState<{ kind: StatusKind; message: string }>({
    kind: "loading",
    message: "Finishing Google sign-in...",
  });

  useEffect(() => {
    let active = true;

    async function finish() {
      if (completingRef.current) return;
      completingRef.current = true;
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const next = safeNext(params.get("next"));

        if (!code) {
          throw new Error("No authorization code found. Please try signing in again.");
        }

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
        const settings = await loadFirebaseClientSettings();
        const auth = initializeFirebaseClient(settings);
        const credential = GoogleAuthProvider.credential(exchangeBody.id_token);
        const result = await signInWithCredential(auth, credential);
        const firebaseIdToken = await result.user.getIdToken(true);
        const session = await createAndVerifyServerSession(firebaseIdToken, result.user.uid);

        if (!active) return;
        setNotice({ kind: "complete", message: "Signed in. Opening your account..." });
        window.location.assign(destinationForSession(session, next));
      } catch (error) {
        if (!active) return;
        completingRef.current = false;
        setNotice({ kind: "error", message: authErrorDetails(error).message });
      }
    }

    void finish();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-main app-main-center">
      <section className="panel panel-narrow">
        <a className="toplink" href="/login">Back to sign in</a>
        <h1>Finish sign in</h1>
        <p>The app is completing your Google sign-in.</p>
        <StatusNotice kind={notice.kind} role="status" aria-live="polite" variant="block">
          {notice.message}
        </StatusNotice>
      </section>
    </main>
  );
}
