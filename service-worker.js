/* GitSync — service worker
   Caches the static app shell (HTML/CSS/JS/icons) so the app installs and
   opens instantly, offline included. GitHub API calls and third-party
   scripts are always fetched live and are never intercepted here — syncing
   itself always needs a real network connection. */

const CACHE_VERSION = 'gitsync-v1';
const APP_SHELL = [
  './',
  './index.html',
  './custom.html',
  './style.css',
  './manifest.json',
  './js/auth.js',
  './js/github.js',
  './js/files.js',
  './js/zip.js',
  './js/compare.js',
  './js/commit.js',
  './js/ui.js',
  './js/accounts.js',
  './js/app.js',
  './js/custom.js',
  './js/theme.js',
  './icons/icon-48.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/favicon.ico',
  './icons/favicon-16.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only manage same-origin GET requests for our own app shell. Everything
  // else (GitHub's API, the JSZip CDN script, etc.) goes straight to the
  // network untouched.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
