/* EV Charger PWA - Service Worker v1.1 - Fix auth caching loop */
const CACHE_NAME = 'ev-charger-v7';
const STATIC_ASSETS = [
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Chemins qui ne doivent JAMAIS être mis en cache (auth, API dynamiques)
const NO_CACHE_PATHS = [
  '/auth/',       // tout le flux OAuth (/auth/login, /auth/callback, /auth/check, /auth/logout)
  '/api/',        // données dynamiques
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

  // 1. Ne jamais cacher les requêtes non-GET
  if (e.request.method !== 'GET') {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'Hors ligne' }), {
          headers: { 'Content-Type': 'application/json' }, status: 503
        })
      )
    );
    return;
  }

  // 2. Chemins dynamiques (auth + api) : network-first, jamais de cache
  const isNoCachePath = NO_CACHE_PATHS.some(p => url.pathname.startsWith(p));
  if (isNoCachePath) {
    e.respondWith(
      fetch(e.request).catch(() => {
        // Pour /auth/* hors-ligne : laisser le navigateur gérer (pas de fallback JSON)
        if (url.pathname.startsWith('/auth/')) {
          return new Response('', { status: 503 });
        }
        return new Response(JSON.stringify({ error: 'Hors ligne' }), {
          headers: { 'Content-Type': 'application/json' }, status: 503
        });
      })
    );
    return;
  }

  // 3. Assets statiques : cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Ne cacher que les réponses 200 GET (jamais redirects, erreurs, etc.)
        if (res.ok && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => new Response('', { status: 503 }));
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
    e.waitUntil(fetch('/api/switch/off', { method: 'POST' }));
  }
  e.waitUntil(clients.openWindow('/'));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SET_TOKEN') self.__HA_TOKEN = e.data.token;
});
