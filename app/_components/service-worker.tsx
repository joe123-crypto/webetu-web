"use client";

import { useEffect } from "react";

/** Enables browser installation without adding an in-app install prompt. */
export function ServiceWorker() {
  useEffect(() => {
    // Keep development assets out of service worker control.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => {
        console.warn("Could not register the app service worker:", error);
      });
  }, []);

  return null;
}
