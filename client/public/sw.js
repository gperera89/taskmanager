// Cura service worker: offline app-shell caching. (Notifications are delivered via ntfy —
// see lib/notifications.ts — so there are no Web Push handlers here anymore.)
//
// Caching strategy (GET, same-origin only; /api/* is never cached):
//  - navigations: cache-first (stale-while-revalidate) — the cached shell paints immediately and
//    a background fetch refreshes it for next time. The page HTML embeds a server snapshot, and
//    the client store hydrates anything fresher from its IndexedDB snapshot and then pulls a live
//    render (see store.tsx), so a stale shell is only a starting point.
//  - /_next/static/: cache-first (content-hashed filenames, immutable).
//  - other static GETs (fonts, icons): stale-while-revalidate.

// Bumping this drops every previously cached shell/asset on the next activation — the escape
// hatch when a device is stuck serving a stale build.
const CACHE_VERSION = "cura-v3";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
// Where the build id of the currently cached shell is parked, so a background revalidate can tell
// "same deploy, just newer data" from "the app has been redeployed underneath this device".
const BUILD_KEY = "/__cura-shell-build";

// `next dev` stamps each compilation with its own build id and the HMR client force-reloads the
// page whenever the document it loaded doesn't match the server's current one. Serving a cached
// shell guarantees that mismatch, so cache-first navigation and the dev server together spin in
// a reload loop: HMR reloads, the worker replays the same stale shell, HMR reloads again. Stand
// down entirely on localhost — the caching here exists for the deployed PWA on a phone, and dev
// has nothing to gain from it.
const IS_DEV_HOST = ["localhost", "127.0.0.1", "[::1]"].includes(self.location.hostname);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      if (IS_DEV_HOST) return;
      try {
        const cache = await caches.open(SHELL_CACHE);
        const response = await fetch("/");
        // putShell (rather than cache.add) so the very first cached shell records its build id
        // too — otherwise the first background revalidate has nothing to compare against.
        if (isCacheableShell(response, self.location.origin + "/")) await putShell(cache, response);
      } catch {
        // No shell on this device yet; the first navigation will populate it.
      }
    })()
  );
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

// The build id is stamped into the document by layout.tsx as <meta name="cura-build" ...>.
// Parsed by regex rather than any DOM API — a service worker has no DOMParser.
function readBuildId(html) {
  const match = /<meta\s+name="cura-build"\s+content="([^"]*)"/.exec(html);
  return match ? match[1] : null;
}

async function cachedBuildId(cache) {
  const stored = await cache.match(BUILD_KEY);
  return stored ? stored.text() : null;
}

// Only ever called with a response that already passed `isCacheableShell`. Returns the build id
// it stored (null if the document carried no stamp), so the caller doesn't re-read the body.
async function putShell(cache, response) {
  const body = await response.clone().text();
  await cache.put("/", new Response(body, { status: 200, headers: response.headers }));
  const buildId = readBuildId(body);
  if (buildId) await cache.put(BUILD_KEY, new Response(buildId));
  return buildId;
}

// Never cache a redirected or non-HTML response: an expired session redirects to the Google
// sign-in flow, and caching that as the shell poisons the fallback permanently.
function isCacheableShell(response, requestUrl) {
  const responseUrl = new URL(response.url || requestUrl);
  const isHtml = (response.headers.get("Content-Type") || "").includes("text/html");
  return response.ok && !response.redirected && isHtml && responseUrl.origin === self.location.origin;
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.postMessage(message);
}

self.addEventListener("fetch", (event) => {
  if (IS_DEV_HOST) return;
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // App navigations: cache-first, revalidating in the background. This is what makes the app open
  // instantly instead of waiting out a cold serverless start plus a dozen queries to hosted
  // Postgres — the cached shell paints at once, the store re-hydrates from its IndexedDB snapshot
  // and immediately pulls a live server render to reconcile (see store.tsx).
  //
  // This used to be network-first specifically to avoid one failure mode: serving a shell from an
  // *older deploy* whose `/_next/static` chunks are gone from the CDN, which broke hydration and
  // latched that one device into "offline". Two things defuse it now:
  //  - Those chunks are themselves cache-first in STATIC_CACHE below, populated by the same
  //    service worker that cached the shell. A shell served from cache finds its own chunks in
  //    cache, CDN or no CDN.
  //  - The background revalidate compares build ids and tells the page to reload itself onto the
  //    new deploy the moment one is detected, so a device can't sit on a stale build.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match("/");

        const revalidate = (async () => {
          const response = await fetch(request);
          if (!isCacheableShell(response, request.url)) return response;
          const previousBuild = await cachedBuildId(cache);
          const nextBuild = await putShell(cache, response);
          // Only meaningful when we actually served the old shell — otherwise the caller below
          // is already returning this very response and there's nothing to reload onto.
          if (cached && previousBuild && nextBuild && previousBuild !== nextBuild) {
            await notifyClients({ type: "cura-shell-updated" });
          }
          return response;
        })();

        if (cached) {
          // Let the revalidate finish even though the response has already gone out.
          event.waitUntil(revalidate.catch(() => {}));
          return cached;
        }

        // First load on this device: nothing to serve but the network.
        try {
          return await revalidate;
        } catch {
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
