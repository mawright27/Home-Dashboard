/* ==========================================================================
   Home Dashboard — service-worker.js
   Caches the app shell (HTML/CSS/JS/manifest/icons) so the dashboard keeps
   rendering the last known screen if the device briefly loses network —
   important on a wall display with no way for anyone to hit "reload".
   ========================================================================== */

const CACHE_NAME = "home-dashboard-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
];

// Install: pre-cache the app shell.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: drop any caches from a previous version of this app.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for the app shell, with a network-first fallback for
// anything else (e.g. a future real weather/calendar/sensor API) so live
// data is preferred when available but the UI never goes blank offline.
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const isAppShellRequest = APP_SHELL.some((path) => {
    const url = new URL(path, self.location.href);
    return request.url === url.href;
  });

  if (isAppShellRequest) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
