/**
 * AIS Marketing OS — Service Worker
 * Bump CACHE_VERSION on every deploy to force clients to update.
 */
const CACHE_VERSION = 'ais-v3';
const STATIC_ASSETS = ['/', '/index.html', '/app-logic.js', '/manifest.json'];

// ─── Install: pre-cache static assets ────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: delete old caches ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch strategy ───────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Google Apps Script API calls: network-first, cache last-good as fallback
  if (url.hostname.includes('script.google.com')) {
    e.respondWith(
      fetch(e.request.clone())
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets: network-first, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});
