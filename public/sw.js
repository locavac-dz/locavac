const CACHE  = 'locavac-v1';
const STATIC = [
  '/',
  '/manifest.json',
  '/icon.svg',
];

// ── Install : mise en cache des ressources statiques ──────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// ── Activate : suppression des anciens caches ─────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : stratégie hybride ─────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API : network-first, erreur silencieuse en offline
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'Hors ligne — fonctionnalité indisponible.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Ressources externes (fonts Google, Leaflet CDN, Unsplash) : network-first, pas de cache
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Navigation (HTML) : cache-first avec fallback réseau, puis '/' en offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('/').then(cached => {
        const network = fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put('/', res.clone()));
          return res;
        }).catch(() => cached || new Response('Hors ligne', { status: 503 }));
        return cached || network;
      })
    );
    return;
  }

  // Autres ressources statiques : cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => new Response('', { status: 503 }));
    })
  );
});

// ── Message depuis la page : forcer la mise à jour ────────
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
