// Minimal app-shell service worker. Data offline lives in IndexedDB behind
// LocalStore (D55/D56) — this SW only keeps the shell loadable in airplane
// mode. Deliberately NOT the Background Sync API (D58).

const SHELL_CACHE = "cos-shell-v1";
const STATIC_CACHE = "cos-static-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/", "/capture", "/tray"])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return; // never intercept Supabase/API traffic — sync handles its own retries
  }

  // Hashed build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      }),
    );
    return;
  }

  // Navigations: network-first, fall back to cached shell offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached ?? caches.match("/");
        }),
    );
  }
});
