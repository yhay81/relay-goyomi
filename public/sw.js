const cacheName = "relay-goyomi-v1";
const cacheablePaths = new Set([
  "/",
  "/guide",
  "/privacy",
  "/styles.css",
  "/common.js",
  "/app.js",
  "/favicon.png",
  "/manifest.webmanifest",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([...cacheablePaths])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !cacheablePaths.has(url.pathname)) return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(cacheName).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
