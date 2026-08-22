const CACHE_NAME = 'zoyd-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

const DYNAMIC_CACHE = 'zoyd-dynamic-v1';

// Install : cache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate : clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key !== DYNAMIC_CACHE).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch : stale-while-revalidate strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip non-HTTP(S) requests
  if (!request.url.startsWith('http')) return;

  // Skip external requests — let browser handle CDN resources natively
  const origin = self.location.origin;
  if (!request.url.startsWith(origin)) return;

  // API calls : network first, cache fallback
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || new Response(JSON.stringify({ error: "Serveur injoignable ou hors ligne" }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    );
    return;
  }

  // Static assets : cache first, network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Revalidate in background
        fetch(request).then((response) => {
          if (response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(request).then((response) => {
        if (response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch((error) => {
        // Fallback response prevents Uncaught TypeError in console during dev server restarts
        return new Response('Offline fallback', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || 'Notification ZOYD',
    icon: '/codm/codm_app_icon.png',
    badge: '/codm/codm_app_icon.png',
    tag: data.tag || 'zoyd-default',
    requireInteraction: data.requireInteraction || false,
    data: data.url ? { url: data.url } : undefined,
  };
  event.waitUntil(self.registration.showNotification(data.title || 'ZOYD', options));
});

self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data?.type) return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'SHOW_NOTIFICATION') {
    const payload = data.payload || {};
    event.waitUntil(
      self.registration.showNotification(payload.title || 'ZOYD', {
        body: payload.body || 'Notification ZOYD',
        icon: '/codm/codm_app_icon.png',
        badge: '/codm/codm_app_icon.png',
        tag: payload.tag || 'zoyd-local',
        requireInteraction: Boolean(payload.requireInteraction),
        data: payload.url ? { url: payload.url } : undefined,
      })
    );
  }
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
