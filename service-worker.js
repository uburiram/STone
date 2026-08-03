/* Somtum Service Worker - network-first for app files (auth-safe) */
const CACHE_NAME = 'somtum-v11';
const CORE_ASSETS = [
  './',
  './index.html',
  './js/storage.js',
  './js/app.js',
  './js/firebase.js',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun/Sarabun-Regular.ttf',
  'https://raw.githubusercontent.com/uburiram/STone/37019fb50a43edddf1b2aaa534de2276b231e57e/icon_256x256.png'
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
  if (isAuthOrFirebase(url)) return; // never intercept Google/Firebase auth traffic

  // Network-first for HTML + own JS so auth/login fixes deploy immediately
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
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for CDN static assets
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
