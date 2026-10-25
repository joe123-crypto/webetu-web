// Keep every request on the network: account pages, credentials, API responses,
// and OAuth redirects must never be stored in an offline cache.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AWRS | Offline</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:1.5rem;line-height:1.6"><h1>You’re offline</h1><p>Connect to the internet to use AWRS and manage your meal reservations.</p><p><a href="/">Try again</a></p></body></html>',
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    )),
  );
});
