/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/* GitSync — service worker
   Caches the static app shell (HTML/CSS/JS/icons) so the app installs and
   opens instantly, offline included. GitHub API calls and third-party
   scripts are always fetched live and are never intercepted here — syncing
   itself always needs a real network connection.

   Strategy: NETWORK-FIRST for the app shell. Whenever the device is online,
   the latest HTML/CSS/JS is always used (and the cache is refreshed with
   it) — a stale cached style.css or bundle can never "stick" and silently
   keep an old build (theme colors, icons, script fixes, etc.) around after
   an update. The cache is only used as an offline fallback.

   IMPORTANT: bump CACHE_VERSION whenever the app shell changes. Bumping it
   guarantees the old cache is deleted on activate, so nothing from a
   previous build can linger even in edge cases. */

const CACHE_VERSION = 'gitsync-v6';
const APP_SHELL = [
  './',
  './index.html',
  './custom.html',
  './style.css',
  './manifest.json',
  './js/auth.js',
  './js/github.js',
  './js/applog.js',
  './js/files.js',
  './js/zip.js',
  './js/compare.js',
  './js/commit.js',
  './js/ui.js',
  './js/picker.js',
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
        // Delete every cache that isn't the current version — this is what
        // actually clears out a stale build the moment a new one activates.
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  // Lets the page force an immediate takeover after it detects a waiting
  // worker, instead of waiting for every tab to close.
  if (event.data === 'skipWaiting') self.skipWaiting();
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
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
