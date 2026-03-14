/* PWA Service Worker: Push (Ton+Vibration) + sparsames Offline-Caching */
const CACHE_NAME = 'it9an-v1';
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || e.request.method !== 'GET') return;
  if (u.pathname.includes('firestore') || u.pathname.includes('firebase') || u.pathname.includes('googleapis')) return;
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
}, { capture: true });

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || payload || {};
  if (handleDismiss(data)) return;
  const title = data.title || 'تطبيق إتقان';
  const body = data.body || 'إشعار جديد';
  const badgeCount = parseInt(data.badge || '1', 10) || 1;
  const tag = data.tag || 'it9an-' + (data.postId || Date.now());
  if ('setAppBadge' in navigator) {
    try { navigator.setAppBadge(badgeCount); } catch(e) {}
  }
  const iconUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect fill='%230f4c3a' width='192' height='192' rx='24'/%3E%3Ctext x='96' y='120' font-size='100' text-anchor='middle' fill='%23d4af37' font-family='serif'%3Eٱ%3C/text%3E%3C/svg%3E";
  const urlParams = new URLSearchParams();
  if (data.postId) urlParams.set('postId', data.postId);
  if (data.fileId) urlParams.set('fileId', data.fileId);
  if (data.notifId) urlParams.set('notifId', data.notifId);
  if (data.replyTimestamp) urlParams.set('replyTimestamp', data.replyTimestamp);
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
    data: { url, postId: data.postId || '', fileId: data.fileId || '', notifId: data.notifId || '', replyTimestamp: data.replyTimestamp || '', badge: String(badgeCount) }
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const base = new URL('index.html', self.registration.scope).href.replace(/\/index\.html$/, '');
  const urlParams = new URLSearchParams();
  if (d.postId) urlParams.set('postId', d.postId);
  if (d.fileId) urlParams.set('fileId', d.fileId);
  if (d.notifId) urlParams.set('notifId', d.notifId);
  if (d.replyTimestamp) urlParams.set('replyTimestamp', d.replyTimestamp);
  const url = urlParams.toString() ? (base + '/index.html?' + urlParams.toString()) : (base + '/index.html');
  e.waitUntil((function() {
    var urlWithFresh = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();
    return self.clients.openWindow ? self.clients.openWindow(urlWithFresh) : Promise.resolve();
  })());
});
