/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * offline.js — shared by every page.
 *
 *  1. Full-screen "You're offline" screen with a Refresh button. It appears
 *     the moment the connection drops (or GitHub becomes unreachable) and
 *     stays until the person taps Refresh and the connection is confirmed.
 *  2. Service-worker registration, with a safety net so an app update can
 *     never reload the page in the middle of an upload.
 *
 * Pages can expose window.GitSyncIsBusy = () => boolean to say "work is in
 * progress" — while that is true we never auto-reload and we warn before
 * the tab is closed.
 */
(function () {
  'use strict';

  var PING_TIMEOUT_MS = 6000;
  var overlay = null;
  var state = 'online';          // online | offline | restored | checking
  var checking = false;
  var reloading = false;

  function isBusy() {
    try { return typeof window.GitSyncIsBusy === 'function' && !!window.GitSyncIsBusy(); }
    catch (e) { return false; }
  }

  /* ---------- Connection probe ----------
     Asks our own origin for a tiny file, bypassing every cache. The service
     worker deliberately ignores requests carrying __ping, so a cached copy
     can never make us think we're online when we're not. */
  function ping() {
    return new Promise(function (resolve) {
      var done = false;
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (done) return; done = true;
        if (ctrl) ctrl.abort();
        resolve(false);
      }, PING_TIMEOUT_MS);
      fetch('manifest.json?__ping=' + Date.now(), {
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        if (done) return; done = true; clearTimeout(timer);
        resolve(res.status < 500);
      }).catch(function () {
        if (done) return; done = true; clearTimeout(timer);
        resolve(false);
      });
    });
  }

  /* ---------- Overlay ---------- */
  var WIFI_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M22 8.8a15 15 0 0 0-9.3-4.6"/><path d="M5 12.9a10 10 0 0 1 3.6-2.1"/><path d="M19 12.9a10 10 0 0 0-4.7-2.7"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="M3 3l18 18"/></svg>';
  var WIFI_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.9a10 10 0 0 1 14 0"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/></svg>';
  var REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';

  function build() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'offline-screen';
    overlay.className = 'ofl hidden';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ofl-title');
    overlay.setAttribute('aria-describedby', 'ofl-msg');
    overlay.innerHTML =
      '<div class="ofl-card">' +
        '<div class="ofl-icon" id="ofl-icon"><span class="ofl-pulse"></span><span class="ofl-pulse ofl-pulse-2"></span><span class="ofl-glyph" id="ofl-glyph">' + WIFI_OFF + '</span></div>' +
        '<h1 class="ofl-title" id="ofl-title">You\u2019re offline</h1>' +
        '<p class="ofl-msg" id="ofl-msg">GitSync can\u2019t reach the internet. Check your connection, then tap Refresh.</p>' +
        '<ul class="ofl-tips" id="ofl-tips">' +
          '<li>Turn off Airplane mode</li>' +
          '<li>Reconnect to Wi\u2011Fi or turn on mobile data</li>' +
          '<li>Move to a spot with a stronger signal</li>' +
        '</ul>' +
        '<button type="button" class="btn btn-primary btn-block ofl-btn" id="ofl-refresh">' +
          '<span class="ofl-btn-ico" id="ofl-btn-ico">' + REFRESH + '</span><span id="ofl-btn-text">Refresh</span>' +
        '</button>' +
        '<p class="ofl-status" id="ofl-status" aria-live="polite"></p>' +
        '<p class="ofl-foot">Your GitHub account stays saved on this device.</p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#ofl-refresh').addEventListener('click', onRefresh);
    return overlay;
  }

  function el(id) { return document.getElementById(id); }

  function render() {
    build();
    var btn = el('ofl-refresh'), txt = el('ofl-btn-text'), title = el('ofl-title'),
        msg = el('ofl-msg'), glyph = el('ofl-glyph'), tips = el('ofl-tips');
    overlay.setAttribute('data-state', state);
    btn.disabled = (state === 'checking');
    if (state === 'restored') {
      title.textContent = 'You\u2019re back online';
      msg.textContent = 'Your connection is working again. Tap Refresh to load GitSync.';
      glyph.innerHTML = WIFI_ON;
      tips.classList.add('hidden');
      txt.textContent = 'Refresh';
    } else if (state === 'checking') {
      txt.textContent = 'Checking connection\u2026';
    } else {
      title.textContent = 'You\u2019re offline';
      msg.textContent = 'GitSync can\u2019t reach the internet. Check your connection, then tap Refresh.';
      glyph.innerHTML = WIFI_OFF;
      tips.classList.remove('hidden');
      txt.textContent = 'Refresh';
    }
  }

  function setStatus(text, isError) {
    var s = el('ofl-status');
    if (!s) return;
    s.textContent = text || '';
    s.className = 'ofl-status' + (isError ? ' err' : '');
  }

  function show(newState) {
    build();
    state = newState || 'offline';
    render();
    overlay.classList.remove('hidden');
    document.documentElement.classList.add('ofl-lock');
    var btn = el('ofl-refresh');
    if (btn && !btn.disabled) { try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function hide() {
    state = 'online';
    if (overlay) overlay.classList.add('hidden');
    document.documentElement.classList.remove('ofl-lock');
    setStatus('');
  }

  function reloadPage() {
    reloading = true;
    // A visit to offline.html itself should land on the app, not reload the fallback.
    if (/offline\.html$/.test(location.pathname)) { location.replace('./index.html'); return; }
    location.reload();
  }

  function onRefresh() {
    if (checking) return;
    checking = true;
    var prev = state;
    state = 'checking';
    render();
    setStatus('');
    ping().then(function (ok) {
      checking = false;
      if (ok) {
        if (isBusy()) {
          // Don't throw away an upload in progress — just let them carry on.
          hide();
          toast('Back online');
          return;
        }
        reloadPage();
      } else {
        state = (prev === 'restored') ? 'offline' : prev;
        if (state === 'checking') state = 'offline';
        render();
        setStatus('Still no connection. Check Wi\u2011Fi or mobile data and try again.', true);
        var card = overlay.querySelector('.ofl-card');
        card.classList.remove('ofl-shake'); void card.offsetWidth; card.classList.add('ofl-shake');
      }
    });
  }

  function toast(text) {
    if (window.UI && typeof UI.toast === 'function') UI.toast(text);
  }

  /* ---------- Connection events ---------- */
  function goOffline() { if (!checking) show('offline'); else state = 'offline'; }

  function goOnline() {
    // The browser says we're back — confirm for real before saying so.
    ping().then(function (ok) {
      if (!ok) return;
      if (!overlay || overlay.classList.contains('hidden')) return;
      if (isBusy()) { hide(); toast('Back online'); return; }
      if (!checking) { show('restored'); }
    });
  }

  var probing = false;
  function onNetworkError() {
    // A GitHub request failed at the network level. If our own origin is
    // unreachable too, the connection is down — show the offline screen.
    if (probing || (overlay && !overlay.classList.contains('hidden'))) return;
    probing = true;
    ping().then(function (ok) {
      probing = false;
      if (!ok) show('offline');
    });
  }

  window.addEventListener('offline', goOffline);
  window.addEventListener('online', goOnline);
  window.addEventListener('gitsync:network-error', onNetworkError);

  window.GitSyncOffline = { show: function () { show('offline'); }, hide: hide, ping: ping };

  function boot() {
    build();
    if (navigator.onLine === false) show('offline');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* ---------- Protect work in progress ---------- */
  window.addEventListener('beforeunload', function (e) {
    if (reloading || !isBusy()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* ---------- Service worker ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').then(function (reg) {
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound', function () {
          var fresh = reg.installing;
          if (!fresh) return;
          fresh.addEventListener('statechange', function () {
            if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
              fresh.postMessage('skipWaiting');
            }
          });
        });
        // Look for a new version whenever the app comes back to the foreground.
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible' && navigator.onLine !== false) {
            reg.update().catch(function () { /* ignore */ });
          }
        });
      }).catch(function () { /* ignore */ });

      // A new service worker just took over. Reload to pick up the new files —
      // but never in the middle of an upload; wait until it's finished.
      // (Skipped on the very first install — there is nothing stale to replace.)
      var hadController = !!navigator.serviceWorker.controller;
      var refreshed = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshed || !hadController) return;
        refreshed = true;
        function go() {
          if (isBusy()) { setTimeout(go, 1500); return; }
          reloading = true;
          window.location.reload();
        }
        go();
      });
    });
  }
})();
