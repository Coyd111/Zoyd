const CACHE_NAME = 'zoyd-v6';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Cache des assets non-API (hashed JS/CSS, polices). Renommé pour purger
// les entrées `/api/` depositées par les versions précédentes : `activate`
// supprime tous les caches dont le nom diffère de CACHE_NAME.
const DYNAMIC_CACHE = 'zoyd-assets-v3';

// Install : cache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate : clean ALL old caches (forces re-fetch of new hashed assets)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
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

  // Skip external requests
  const origin = self.location.origin;
  if (!request.url.startsWith(origin)) return;

  const url = new URL(request.url);

  // API : JAMAIS de cache. Réseau direct, ou 503 explicite si hors ligne.
  //
  // Avant, une liste de denylist essayait de filtrer (`/auth/`, `/wallet`,
  // `/chat`...) et s'appuyait sur l'absence d'en-tête `Authorization`.
  // Ce garde est mort depuis le passage en cookie httpOnly : le navigateur
  // n'envoie plus d'en-tête, donc la condition était toujours vraie et ne
  // filtrait plus rien. Restaient en cache :
  //   - /api/realtime/state/bootstrap -> amis, demandes, blocages,
  //     notifications et matchs de CE joueur
  //   - /api/social/friends, /api/social/pending -> cercle social
  //   - /api/notifications, /api/admin/commissions, /api/admin/2fa/status
  //
  // Conséquences réelles : sur un appareil partagé, le joueur suivant —
  // ou le même joueur hors ligne — voit l'état du précédent ; et comme la
  // clé de cache est l'URL, une réponse 401/200 Pinvalidée peut réapparaître
  // après le changement de compte. Une entrée de menu, pas une information
  // périmée.
  //
  // Le service worker garde ce qui justifie son existence : le shell et les
  // assets hashés, disponibles hors ligne et chargés au cache d'abord.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ ok: false, error: 'Serveur injoignable ou hors ligne', code: 'OFFLINE' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )),
    );
    return;
  }

  // HTML pages: network first (avoid stale index.html with old hashes)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Static assets (hashed JS/CSS): cache first, network fallback
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
      }).catch(() => {
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
    icon: '/logo-icon.png',
    badge: '/logo-icon.png',
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
        icon: '/logo-icon.png',
        badge: '/logo-icon.png',
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
