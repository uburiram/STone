/* Somtum Service Worker - offline shell cache */
const CACHE_NAME = 'somtum-v1';
const CORE_ASSETS = [
  './',
  './somtum_offline.html',
  './somtum_release.html',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://raw.githubusercontent.com/uburiram/STone/37019fb50a43edddf1b2aaa534de2276b231e57e/icon_256x256.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS.map((url) => {
        try { return new Request(url, { mode: 'no-cors' }); } catch (e) { return url; }
      })).catch(() => {
        // Best-effort: cache what we can
        return Promise.all(CORE_ASSETS.map((url) =>
          cache.add(url).catch(() => undefined)
        ));
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Network-first for Firebase / API; cache-first for static shell
  const url = new URL(req.url);
  const isFirebase = url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com');

  if (isFirebase) {
    // Let Firebase network requests pass through (offline handled by Firestore SDK)
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.status === 200 && (req.url.startsWith(self.location.origin) || req.url.includes('cdn') || req.url.includes('fonts') || req.url.includes('raw.githubusercontent'))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);

      // Prefer cache for navigation when offline
      if (req.mode === 'navigate') {
        return fetchPromise.then((res) => res || cached || caches.match('./somtum_offline.html'));
      }
      return cached || fetchPromise;
    })
  );
});
