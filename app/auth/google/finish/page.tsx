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

        // Exchange the code server-side via a fetch to a token endpoint.
        // For this scaffold we simply redirect to sign-in to restart the flow.
        // A full implementation would POST the code to a server action that
        // calls Google's token endpoint and returns a Firebase custom token.
        throw new Error(
          "Google OAuth code exchange is not yet implemented in this scaffold. " +
          "Please use the email magic link to sign in."
        );
      } catch (error) {
        if (!active) return;
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
