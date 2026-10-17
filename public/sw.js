/* Shubix service worker: makes the app installable and quick to open.
   - The app's own files (scripts, styles, fonts, icons, the studio's models) are kept after the first visit.
   - Pages always come from the network when there is one (fresh data); with no connection, the last copy of the page
     is shown, else a friendly "You're offline" page.
   - Nothing from /api is ever cached: projects, credits and accounts are always live. */
const VERSION = "shubix-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE, "/icon-192.png", "/icon-512.png", "/brand/shubix-logo-sm.webp"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/vendor/") ||
  url.pathname.startsWith("/brand/") ||
  /\.(?:woff2?|png|jpg|jpeg|webp|svg|ico|wasm|onnx)$/.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(PAGES).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match(OFFLINE))),
    );
    return;
  }

  if (isStatic(url)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") caches.open(STATIC).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
