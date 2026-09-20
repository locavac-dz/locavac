// Incrémenter à chaque changement de stratégie : l'activation supprime tous les caches d'un autre nom
const CACHE  = 'locavac-v2';
const STATIC = [
  '/',
  '/manifest.json',
  '/icon.svg',
];
// Délai au-delà duquel une page déjà en cache est servie sans attendre le réseau (connexions mobiles lentes)
const NAV_TIMEOUT_MS = 4000;
// Fichiers au nom unique et immuable : le cache fait foi, inutile de les retélécharger
const IMMUTABLE = /^\/(uploads|vendor)\//;

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

// Met une copie en cache sans jamais consommer la réponse rendue à la page
function remember(key, res) {
  if (!res.ok) return res;
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
  return res;
}

// Pages : réseau d'abord, pour qu'un déploiement soit visible dès le premier chargement.
// Le cache ne sert que hors ligne, ou si le réseau ne répond pas dans le délai imparti.
function networkFirstPage(request) {
  return caches.match('/').then(cached => {
    const network = fetch(request).then(res => remember('/', res));
    if (!cached) {
      return network.catch(() => new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    }
    let timer;
    const tooSlow = new Promise(resolve => { timer = setTimeout(() => resolve(cached), NAV_TIMEOUT_MS); });
    return Promise.race([network.catch(() => cached), tooSlow]).then(res => { clearTimeout(timer); return res; });
  });
}

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

  // Seules les lectures sont mises en cache
  if (e.request.method && e.request.method !== 'GET') return;

  // Ressources externes (fonts Google, Unsplash) : network-first, pas de cache
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirstPage(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Photos uploadées et bibliothèques embarquées : cache-first strict
      if (cached && IMMUTABLE.test(url.pathname)) return cached;
      const refresh = fetch(e.request).then(res => remember(e.request, res));
      // Autres fichiers statiques : réponse immédiate depuis le cache, rafraîchie en arrière-plan
      if (cached) { refresh.catch(() => {}); return cached; }
      return refresh.catch(() => new Response('', { status: 503 }));
    })
  );
});

// ── Message depuis la page : forcer la mise à jour ────────
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
