const VERSION = 'v1.0.0';
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/main.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === VERSION ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      const cache = await caches.open(VERSION);
      if (res.ok && (new URL(req.url).origin === location.origin)) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // Fallback to index for navigation
      if (req.mode === 'navigate') {
        return caches.match('/');
      }
      throw err;
    }
  })());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data.json(); } catch {}
  const title = data.title || 'Reminder';
  const body = data.body || 'It is time';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window' });
    for (const c of all) {
      if ('focus' in c) return c.focus();
    }
    return clients.openWindow('/');
  })());
});