// Cura service worker: offline app-shell caching. (Notifications are delivered via ntfy —
// see lib/notifications.ts — so there are no Web Push handlers here anymore.)
//
// Caching strategy (GET, same-origin only; /api/* is never cached):
//  - navigations: network-first with a timeout, falling back to the last cached shell — the
//    page HTML embeds a server snapshot, and the client store then hydrates anything fresher
//    from its IndexedDB snapshot (see store.tsx), so a stale shell is only a starting point.
//  - /_next/static/: cache-first (content-hashed filenames, immutable).
//  - other static GETs (fonts, icons): stale-while-revalidate.

const CACHE_VERSION = "cura-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add("/").catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith(CACHE_VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sw-nav-timeout")), ms);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // App navigations: network-first, cached shell as the offline fallback. Every successful
  // navigation refreshes the cached copy of "/" so the fallback stays as current as possible.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
          if (response.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put("/", response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match("/", { cacheName: SHELL_CACHE });
          if (cached) return cached;
          return new Response("<h1>Offline</h1><p>Cura hasn't been loaded on this device yet.</p>", {
            status: 503,
            headers: { "Content-Type": "text/html" },
          });
        }
      })()
    );
    return;
  }

  // Hashed build assets never change under the same URL — serve from cache forever.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: STATIC_CACHE });
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })()
    );
    return;
  }

  // Static assets by extension (icons, fonts, images): stale-while-revalidate. Anything else
  // (notably Next's RSC payload fetches for router.refresh()/navigation, which are plain
  // same-origin GETs) must NOT be intercepted — caching those would serve stale server data.
  if (!/\.(png|jpg|jpeg|gif|webp|svg|ico|webmanifest|woff2?|ttf)$/.test(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { cacheName: STATIC_CACHE });
      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);
      return cached || (await network) || Response.error();
    })()
  );
});
