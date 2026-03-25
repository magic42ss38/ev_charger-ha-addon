/* EV Charger PWA - Service Worker v1.0 - subdomain edition */
const CACHE_NAME = 'ev-charger-v3.1.2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'Hors ligne' }), {
          headers: { 'Content-Type': 'application/json' }, status: 503
        })
      )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

self.addEventListener('push', e => {
  let data = { title: '🔋 EV Charger', body: 'Notification de recharge' };
  if (e.data) { try { data = e.data.json(); } catch { data.body = e.data.text(); } }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'ev-charger',
      requireInteraction: true,
      actions: [
        { action: 'stop', title: '⛔ Arrêter' },
        { action: 'view', title: '👁 Voir' }
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'stop') {
    e.waitUntil(fetch('/api/switch/off', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + self.__HA_TOKEN }
    }));
  }
  e.waitUntil(clients.openWindow('/'));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SET_TOKEN') self.__HA_TOKEN = e.data.token;
});
