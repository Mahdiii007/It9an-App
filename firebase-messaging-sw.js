/* PWA Service Worker: Push (Ton+Vibration) + Offline-Caching
 * CACHE_NAME bei größeren Strategie-Änderungen erhöhen (alte Caches werden in activate entfernt). */
const CACHE_NAME = 'it9an-v7';
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

function isHtmlNavigation(req, u) {
  if (req.method !== 'GET') return false;
  if (req.mode === 'navigate') return true;
  const p = u.pathname;
  return /\/index\.html$/i.test(p) || p === '/' || (p.endsWith('/') && !/\.\w+$/.test(p));
}

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || e.request.method !== 'GET') return;
  if (u.pathname.includes('firestore') || u.pathname.includes('firebase') || u.pathname.includes('googleapis')) return;

  /* Deploy-Marker nie aus Cache – sonst erkennt die App kein neues Release */
  if (u.pathname.endsWith('app-version.json')) {
    e.respondWith(fetch(e.request));
    return;
  }

  /* Immer zuerst Netzwerk für HTML/Navigation → neues index.html nach Deploy ohne PWA neu installieren */
  if (isHtmlNavigation(e.request, u)) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return r;
        })
        .catch(() => caches.match(e.request).then((c) => c || new Response('Offline', { status: 503, statusText: 'Offline' })))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && (u.pathname.endsWith('.html') || u.pathname.endsWith('.css') || u.pathname.endsWith('.js') || u.pathname === '/' || u.pathname.endsWith('/'))) {
          const clone = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((c) => c || new Response('Offline', { status: 503, statusText: 'Offline' })))
  );
});

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDoZLFvGknKztMIFAtS2-AgX6DYw4fssUA",
  authDomain: "it9an-neu.firebaseapp.com",
  projectId: "it9an-neu",
  storageBucket: "it9an-neu.firebasestorage.app",
  messagingSenderId: "196595640613",
  appId: "1:196595640613:web:9ae92c60190363d0e292cc"
});

const messaging = firebase.messaging();

const _fcmMsgDedup = new Map();
const FCM_MSG_DEDUP_MS = 8000;

function shouldSkipDuplicateFcmDelivery(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  const key = 'm:' + msgId;
  const last = _fcmMsgDedup.get(key) || 0;
  if (now - last < FCM_MSG_DEDUP_MS) return true;
  _fcmMsgDedup.set(key, now);
  setTimeout(() => { _fcmMsgDedup.delete(key); }, FCM_MSG_DEDUP_MS);
  return false;
}

function handleDismiss(data) {
  if (!data || typeof data !== 'object') return false;
  const action = String(data.action || data['action'] || '').toLowerCase();
  if (action !== 'dismiss') return false;
  const tag = String(data.tag || data['tag'] || '');
  if (tag) {
    self.registration.getNotifications().then((notifications) => {
      notifications.forEach((n) => {
        if (n.tag === tag) n.close();
      });
    });
  }
  return true;
}

self.addEventListener('push', (e) => {
  let payload = {};
  try {
    if (e.data) payload = e.data.json() || {};
  } catch (err) {}
  const d = payload.data || payload;
  if (handleDismiss(d)) {
    e.waitUntil(Promise.resolve());
    return;
  }
  e.waitUntil(Promise.resolve());
}, { capture: true });

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || payload || {};
  if (handleDismiss(data)) return;
  const tag = data.tag || 'it9an-' + (data.postId || Date.now());
  const msgId = String(payload.messageId || payload.fcmMessageId || '').trim();

  return (async () => {
    if (shouldSkipDuplicateFcmDelivery(msgId)) return;

    const title = data.title || 'تطبيق إتقان';
    const body = data.body || 'إشعار جديد';
    const badgeCount = parseInt(data.badge || '1', 10) || 1;
    if ('setAppBadge' in navigator) {
      try { navigator.setAppBadge(badgeCount); } catch(e) {}
    }
    const iconUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect fill='%230f4c3a' width='192' height='192' rx='24'/%3E%3Ctext x='96' y='120' font-size='100' text-anchor='middle' fill='%23d4af37' font-family='serif'%3Eٱ%3C/text%3E%3C/svg%3E";
    const urlParams = new URLSearchParams();
    if (data.openLesson === '1') {
      urlParams.set('openLesson', '1');
      if (data.fileId) urlParams.set('fileId', data.fileId);
      if (data.stageId) urlParams.set('stageId', data.stageId);
      if (data.notifId) urlParams.set('notifId', data.notifId);
    } else {
      if (data.postId) urlParams.set('postId', data.postId);
      if (data.fileId) urlParams.set('fileId', data.fileId);
      if (data.notifId) urlParams.set('notifId', data.notifId);
      if (data.replyTimestamp) urlParams.set('replyTimestamp', data.replyTimestamp);
      if (data.openStages === '1') urlParams.set('openStages', '1');
    }
    const base = new URL('index.html', self.registration.scope).href.replace(/\/index\.html$/, '');
    const url = urlParams.toString() ? (base + '/index.html?' + urlParams.toString()) : (base + '/index.html');
    const options = {
      body,
      icon: iconUrl,
      badge: iconUrl,
      tag,
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200, 100, 200],
      data: { url, postId: data.postId || '', fileId: data.fileId || '', notifId: data.notifId || '', replyTimestamp: data.replyTimestamp || '', openStages: data.openStages || '', openLesson: data.openLesson || '', stageId: data.stageId || '', badge: String(badgeCount) }
    };
    try {
      await self.registration.showNotification(title, options);
    } catch (err) {
      console.error('showNotification error:', err);
    }
  })();
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const base = new URL('index.html', self.registration.scope).href.replace(/\/index\.html$/, '');
  const urlParams = new URLSearchParams();
  if (d.openLesson === '1') {
    urlParams.set('openLesson', '1');
    if (d.fileId) urlParams.set('fileId', d.fileId);
    if (d.stageId) urlParams.set('stageId', d.stageId);
    if (d.notifId) urlParams.set('notifId', d.notifId);
  } else {
    if (d.postId) urlParams.set('postId', d.postId);
    if (d.fileId) urlParams.set('fileId', d.fileId);
    if (d.notifId) urlParams.set('notifId', d.notifId);
    if (d.replyTimestamp) urlParams.set('replyTimestamp', d.replyTimestamp);
    if (d.openStages === '1') urlParams.set('openStages', '1');
  }
  const url = urlParams.toString() ? (base + '/index.html?' + urlParams.toString()) : (base + '/index.html');
  e.waitUntil((function() {
    var urlWithFresh = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();
    return self.clients.openWindow ? self.clients.openWindow(urlWithFresh) : Promise.resolve();
  })());
});
