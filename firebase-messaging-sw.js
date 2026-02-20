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

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'تطبيق إتقان';
  const body = data.body || 'إشعار جديد';
  const badgeCount = parseInt(data.badge || '1', 10) || 1;
  const tag = data.tag || 'it9an-' + (data.postId || Date.now());
  if ('setAppBadge' in navigator) {
    try { navigator.setAppBadge(badgeCount); } catch(e) {}
  }
  const iconUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect fill='%230f4c3a' width='192' height='192' rx='24'/%3E%3Ctext x='96' y='120' font-size='100' text-anchor='middle' fill='%23d4af37' font-family='serif'%3Eٱ%3C/text%3E%3C/svg%3E";
  const options = {
    body,
    icon: iconUrl,
    badge: iconUrl,
    tag,
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200, 100, 200],
    data: { url: data.url || '', postId: data.postId || '', fileId: data.fileId || '', badge: String(badgeCount) }
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const url = d.url || (d.postId ? './index.html?postId=' + d.postId + '&fileId=' + (d.fileId || '') : './index.html');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((c) => {
    if (c.length) { c[0].focus(); if (c[0].navigate) c[0].navigate(url); }
    else if (self.clients.openWindow) self.clients.openWindow(url);
  }));
});
