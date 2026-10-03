/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/* GitSync — service worker
   Caches the static app shell (HTML/CSS/JS/icons) so the app installs and
   opens instantly. GitHub API calls and third-party scripts are always
   fetched live and never intercepted here — syncing itself always needs a
   real network connection.

   Strategy: NETWORK-FIRST for the app shell, with a timeout. Whenever the
   device is online the latest HTML/CSS/JS is used (and the cache is
   refreshed with it), so a stale bundle can never "stick" after an update.
   If the network is offline — or so slow it stalls — the cached copy is
   served instead, and if there is nothing cached at all, offline.html is
   shown so the person always sees a clear "check your connection" screen
   with a Refresh button rather than a browser error page.

   Requests carrying ?__ping are the app's connection check: they are never
   answered from cache, so the check can't be fooled.

   IMPORTANT: bump CACHE_VERSION whenever the app shell changes. */

const CACHE_VERSION = 'gitsync-v12';
const NAV_TIMEOUT_MS = 6000;
const ASSET_TIMEOUT_MS = 10000;
const OFFLINE_URL = './offline.html';
const APP_SHELL = [
  './',
  './index.html',
  './custom.html',
  './commits.html',
  './profile.html',
  './edit-profile.html',
  './setup.html',
  './offline.html',
  './style.css',
  './manifest.json',
  './js/offline.js',
  './js/upload-ui.js',
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
  './js/commits.js',
  './js/theme.js',
  './js/profile.js',
  './js/edit-profile.js',
  './js/navprofile.js',
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
        // Delete every cache that isn't the current version.
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  // Lets the page force an immediate takeover after it detects a waiting worker.
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function fetchWithTimeout(req, ms) {
  // Race the network against a timer (no AbortController: passing an init
  // object would change how a navigation request is treated).
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    // 'no-cache' = always revalidate with the server, so the browser's own
    // HTTP cache can't hide being offline or serve a stale build.
    fetch(req.mode === 'navigate'
      ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : new Request(req, { cache: 'no-cache' })
    ).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function handle(event) {
  const req = event.request;
  const isNav = req.mode === 'navigate';
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetchWithTimeout(req, isNav ? NAV_TIMEOUT_MS : ASSET_TIMEOUT_MS);
    if (res && res.status === 200) {
      event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
    }
    return res;
  } catch (err) {
    // Offline, blocked, or too slow: fall back to what we have.
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (isNav) {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only manage same-origin GET requests for our own app shell. Everything
  // else (GitHub's API, the JSZip CDN script, etc.) goes straight to the
  // network untouched. Connection checks (?__ping) also bypass the cache.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.searchParams.has('__ping')) {
    return;
  }

  event.respondWith(handle(event));
});
