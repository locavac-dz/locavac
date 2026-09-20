const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SW_PATH = path.join(__dirname, '..', '..', 'public', 'sw.js');
const SW_CODE = fs.readFileSync(SW_PATH, 'utf8');
const ORIGIN  = 'https://locavac.dz';
const CACHE   = 'locavac-v2';

// Charge sw.js dans un bac à sable avec un faux environnement ServiceWorker.
// setTimeout est remplacé par une file manuelle : les tests déclenchent eux-mêmes le délai de navigation.
function loadSW({ fetchImpl, cachedByUrl = {}, cacheKeys = [] } = {}) {
  const handlers = {};
  const timers = [];
  const store = { put: jest.fn().mockResolvedValue(), addAll: jest.fn().mockResolvedValue() };
  const caches = {
    open:   jest.fn().mockResolvedValue(store),
    keys:   jest.fn().mockResolvedValue(cacheKeys),
    delete: jest.fn().mockResolvedValue(true),
    match:  jest.fn(req => Promise.resolve(cachedByUrl[typeof req === 'string' ? req : req.url])),
  };
  const self = {
    location:      { origin: ORIGIN },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting:   jest.fn().mockResolvedValue(),
    clients:       { claim: jest.fn().mockResolvedValue() },
  };
  const fetchMock = jest.fn(fetchImpl || (() => Promise.resolve(new Response('ok', { status: 200 }))));
  vm.runInNewContext(SW_CODE, {
    self, caches, fetch: fetchMock, URL, Response, Promise, JSON, RegExp,
    setTimeout:   (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
  });
  return { handlers, caches, store, self, fetch: fetchMock, timers };
}

// Déclenche un événement ; retourne la promesse passée à waitUntil/respondWith (undefined si non interceptée)
function fire(handlers, type, event) {
  let promise;
  const e = { ...event, waitUntil: p => { promise = p; }, respondWith: p => { promise = p; } };
  handlers[type](e);
  return promise;
}
const flush = () => new Promise(r => setImmediate(r));

const nav   = { url: ORIGIN + '/', mode: 'navigate', method: 'GET' };
const ok    = body => () => Promise.resolve(new Response(body, { status: 200 }));
const down  = () => Promise.reject(new Error('offline'));
const never = () => new Promise(() => {});

describe('Service Worker — cycle de vie', () => {
  test('install : met en cache les ressources statiques puis skipWaiting', async () => {
    const sw = loadSW();
    await fire(sw.handlers, 'install', {});
    expect(sw.caches.open).toHaveBeenCalledWith(CACHE);
    expect(sw.store.addAll).toHaveBeenCalledWith(['/', '/manifest.json', '/icon.svg']);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  test('les ressources pré-cachées existent réellement dans public/', () => {
    const publicDir = path.join(__dirname, '..', '..', 'public');
    for (const url of ['/manifest.json', '/icon.svg']) {
      expect(fs.existsSync(path.join(publicDir, url))).toBe(true);
    }
  });

  test('activate : supprime l\'ancien cache v1 (pages périmées) et tout cache étranger, garde le courant', async () => {
    const sw = loadSW({ cacheKeys: ['locavac-v1', CACHE, 'autre-app'] });
    await fire(sw.handlers, 'activate', {});
    expect(sw.caches.delete).toHaveBeenCalledWith('locavac-v1');
    expect(sw.caches.delete).toHaveBeenCalledWith('autre-app');
    expect(sw.caches.delete).not.toHaveBeenCalledWith(CACHE);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  test('message "skipWaiting" force la mise à jour, tout autre message est ignoré', () => {
    const sw = loadSW();
    sw.handlers.message({ data: 'autre' });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.handlers.message({ data: 'skipWaiting' });
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('Service Worker — requêtes API (network-first)', () => {
  test('réponse réseau transmise telle quelle, toutes méthodes', async () => {
    const sw = loadSW({ fetchImpl: ok('{"a":1}') });
    const res = await fire(sw.handlers, 'fetch', { request: { url: ORIGIN + '/api/listings', mode: 'cors', method: 'POST' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"a":1}');
  });

  test('hors ligne : 503 JSON avec message explicite, jamais de cache', async () => {
    const sw = loadSW({ fetchImpl: down });
    const res = await fire(sw.handlers, 'fetch', { request: { url: ORIGIN + '/api/reservations/mine', mode: 'cors', method: 'GET' } });
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect((await res.json()).error).toMatch(/hors ligne/i);
    expect(sw.caches.match).not.toHaveBeenCalled();
  });
});

describe('Service Worker — requêtes non interceptées', () => {
  test('une écriture hors API (POST) n\'est ni interceptée ni mise en cache', () => {
    const sw = loadSW();
    const p = fire(sw.handlers, 'fetch', { request: { url: ORIGIN + '/formulaire', mode: 'cors', method: 'POST' } });
    expect(p).toBeUndefined();
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  test('origine externe : réseau uniquement, 503 vide hors ligne, aucun cache', async () => {
    const sw = loadSW({ fetchImpl: down });
    const res = await fire(sw.handlers, 'fetch', { request: { url: 'https://fonts.googleapis.com/css2', mode: 'cors', method: 'GET' } });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
    expect(sw.caches.open).not.toHaveBeenCalled();
  });
});

describe('Service Worker — navigation HTML (réseau d\'abord)', () => {
  test('en ligne : la page du RÉSEAU est servie même si une ancienne version est en cache (déploiement visible au 1er chargement)', async () => {
    const stale = new Response('<html>ancienne version</html>');
    const sw = loadSW({ cachedByUrl: { '/': stale }, fetchImpl: ok('<html>nouvelle version</html>') });
    const res = await fire(sw.handlers, 'fetch', { request: nav });
    expect(await res.text()).toBe('<html>nouvelle version</html>');
    expect(res).not.toBe(stale);
  });

  test('la page fraîche remplace "/" dans le cache pour le prochain usage hors ligne', async () => {
    const sw = loadSW({ cachedByUrl: { '/': new Response('vieux') }, fetchImpl: ok('<html>frais</html>') });
    const res = await fire(sw.handlers, 'fetch', { request: nav });
    await flush();
    expect(sw.store.put).toHaveBeenCalledWith('/', expect.anything());
    // La copie mise en cache ne consomme pas la réponse rendue à la page
    expect(await res.text()).toBe('<html>frais</html>');
  });

  test('le délai de repli est annulé dès que le réseau a répondu', async () => {
    const sw = loadSW({ cachedByUrl: { '/': new Response('vieux') }, fetchImpl: ok('frais') });
    await fire(sw.handlers, 'fetch', { request: nav });
    expect(sw.timers).toHaveLength(1);
    expect(sw.timers[0]).toMatchObject({ ms: 4000, cleared: true });
  });

  test('hors ligne avec cache : la page en cache est servie', async () => {
    const cached = new Response('<html>en cache</html>');
    const sw = loadSW({ cachedByUrl: { '/': cached }, fetchImpl: down });
    const res = await fire(sw.handlers, 'fetch', { request: nav });
    expect(res).toBe(cached);
  });

  test('hors ligne sans cache : 503 "Hors ligne"', async () => {
    const sw = loadSW({ fetchImpl: down });
    const res = await fire(sw.handlers, 'fetch', { request: nav });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('Hors ligne');
  });

  test('réseau trop lent (> 4 s) avec cache : la page en cache est servie sans attendre', async () => {
    const cached = new Response('<html>en cache</html>');
    const sw = loadSW({ cachedByUrl: { '/': cached }, fetchImpl: never });
    const pending = fire(sw.handlers, 'fetch', { request: nav });
    await flush();
    expect(sw.timers).toHaveLength(1);
    sw.timers[0].fn(); // les 4 secondes sont écoulées
    expect(await pending).toBe(cached);
  });

  test('réseau lent SANS cache : aucun délai de repli, on attend le réseau', async () => {
    let resolveNet;
    const sw = loadSW({ fetchImpl: () => new Promise(r => { resolveNet = r; }) });
    const pending = fire(sw.handlers, 'fetch', { request: nav });
    await flush();
    expect(sw.timers).toHaveLength(0);
    resolveNet(new Response('enfin', { status: 200 }));
    expect(await (await pending).text()).toBe('enfin');
  });

  test('réponse réseau en erreur (500) : transmise mais jamais mise en cache', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.resolve(new Response('boom', { status: 500 })) });
    const res = await fire(sw.handlers, 'fetch', { request: nav });
    await flush();
    expect(res.status).toBe(500);
    expect(sw.store.put).not.toHaveBeenCalled();
  });

  test('toute URL de navigation (/?action=search, /reservations) partage l\'entrée de cache "/"', async () => {
    const cached = new Response('<html>spa</html>');
    const sw = loadSW({ cachedByUrl: { '/': cached }, fetchImpl: down });
    const res = await fire(sw.handlers, 'fetch', { request: { url: ORIGIN + '/?action=search', mode: 'navigate', method: 'GET' } });
    expect(res).toBe(cached);
  });
});

describe('Service Worker — fichiers immuables (/uploads, /vendor) : cache-first strict', () => {
  test.each(['/uploads/2_1700000000000_abcdef0123456789.jpg', '/vendor/leaflet/leaflet.js'])('%s en cache : aucun appel réseau', async p => {
    const req = { url: ORIGIN + p, mode: 'no-cors', method: 'GET' };
    const cached = new Response('contenu');
    const sw = loadSW({ cachedByUrl: { [req.url]: cached } });
    const res = await fire(sw.handlers, 'fetch', { request: req });
    expect(res).toBe(cached);
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  test('absent du cache : réseau puis mise en cache', async () => {
    const req = { url: ORIGIN + '/vendor/leaflet/leaflet.css', mode: 'no-cors', method: 'GET' };
    const sw = loadSW({ fetchImpl: ok('css') });
    const res = await fire(sw.handlers, 'fetch', { request: req });
    await flush();
    expect(res.status).toBe(200);
    expect(sw.store.put).toHaveBeenCalledWith(req, expect.anything());
  });
});

describe('Service Worker — autres fichiers statiques : cache immédiat, rafraîchi en arrière-plan', () => {
  const asset = { url: ORIGIN + '/manifest.json', mode: 'no-cors', method: 'GET' };

  test('en cache : réponse immédiate ET revalidation réseau qui met le cache à jour', async () => {
    const cached = new Response('{"v":1}');
    const sw = loadSW({ cachedByUrl: { [asset.url]: cached }, fetchImpl: ok('{"v":2}') });
    const res = await fire(sw.handlers, 'fetch', { request: asset });
    expect(res).toBe(cached);
    await flush();
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    expect(sw.store.put).toHaveBeenCalledWith(asset, expect.anything());
  });

  test('en cache et hors ligne : la revalidation échoue en silence', async () => {
    const cached = new Response('{"v":1}');
    const sw = loadSW({ cachedByUrl: { [asset.url]: cached }, fetchImpl: down });
    const res = await fire(sw.handlers, 'fetch', { request: asset });
    await flush();
    expect(res).toBe(cached);
  });

  test('absent du cache et hors ligne : 503 vide', async () => {
    const sw = loadSW({ fetchImpl: down });
    const res = await fire(sw.handlers, 'fetch', { request: asset });
    expect(res.status).toBe(503);
  });
});
