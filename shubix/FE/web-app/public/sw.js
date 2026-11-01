/* Shubix service worker: makes the app installable and quick to open.
   - The app's own files (scripts, styles, fonts, icons, the studio's models) are kept after the first visit.
   - Pages always come from the network when there is one (fresh data); with no connection, the last copy of the page
     is shown, else a friendly "You're offline" page.
   - Nothing from /api is ever cached: projects, credits and accounts are always live. */
const VERSION = "shubix-v3"; // v3: the gold logo and icons
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE, "/icon-192.png", "/icon-512.png", "/brand/shubix-gold-sm.webp"])).then(() => self.skipWaiting()));
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

// a notification from long work that ended while the person was elsewhere (lib/background.ts): a tap brings the studio back
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname === new URL(url, self.location.origin).pathname) || list[0];
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
