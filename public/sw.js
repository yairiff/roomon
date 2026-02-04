/* Minimal service worker for installability (Android Chrome/Edge).
   We intentionally avoid aggressive caching to prevent stale schedule data. */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

