// DEV-MODE STUB: Deregisters the previous production service worker and clears all caches.
// This file is overwritten by `npm run build` with the real Workbox SW.
// It is automatically restored to this stub by `npm run dev` via the predev script.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  );
});
