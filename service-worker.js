/* STone Service Worker - network-first for app files (auth-safe) */
const CACHE_NAME = 'stone-v20260903152000';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.html',
  './js/storage.js',
  './js/app-core.js',
  './js/app-dashboard.js',
  './js/app-phase1.js',
  './js/app-phase2.js',
  './js/app-phase3.js',
  './js/app-phase4.js',
  './js/app-phase5.js',
  './js/app-autosync.js',
  './js/app-dashboard-order.js',
  './js/app-layout-fix.js',
  './js/app-tx.js',
  './js/app-categories.js',
  './js/app-features.js',
  './js/reports.js',
  './js/firebase.js',
  './css/stone.css',
  './css/stone-ui.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun/Sarabun-Regular.ttf',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png',
  './apple-touch-icon-180.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './icon_256x256.png',
  'https://cdn.jsdelivr.net/gh/uburiram/STone@ac6bd385a45f89e99996542626ac700f5bc80936/index.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        CORE_ASSETS.map((url) => cache.add(url).catch(() => undefined))
      );
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

function isAuthOrFirebase(url) {
  const h = url.hostname;
  return (
    h.includes('googleapis.com') ||
    h.includes('firebaseio.com') ||
    h.includes('firebaseapp.com') ||
    h.includes('firebasestorage.') ||
    h.includes('identitytoolkit.googleapis.com') ||
    h.includes('securetoken.googleapis.com') ||
    h.includes('gstatic.com') ||
    h.includes('accounts.google.com') ||
    h.includes('google.com')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (isAuthOrFirebase(url)) return;

  const isAppShell =
    req.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.includes('/js/') ||
    url.pathname.endsWith('service-worker.js');

  if (isAppShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((c) => {
            if (c) return c;
            if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
              return caches.match('./index.html');
            }
            return undefined;
          })
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
