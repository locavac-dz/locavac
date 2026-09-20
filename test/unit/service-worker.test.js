const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SW_PATH = path.join(__dirname, '..', '..', 'public', 'sw.js');
const SW_CODE = fs.readFileSync(SW_PATH, 'utf8');
const ORIGIN  = 'https://locavac.dz';

// Charge sw.js dans un bac à sable avec un faux environnement ServiceWorker
function loadSW({ fetchImpl, cachedByUrl = {}, cacheKeys = [] } = {}) {
  const handlers = {};
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
  vm.runInNewContext(SW_CODE, { self, caches, fetch: fetchMock, URL, Response, Promise, JSON });
  return { handlers, caches, store, self, fetch: fetchMock };
}

// Déclenche un événement et retourne ce qui a été passé à waitUntil / respondWith
async function fire(handlers, type, event) {
  let promise;
  const e = { ...event, waitUntil: p => { promise = p; }, respondWith: p => { promise = p; } };
  handlers[type](e);
  return promise === undefined ? undefined : await promise;
}

const navRequest = { url: ORIGIN + '/', mode: 'navigate' };

describe('Service Worker — cycle de vie', () => {
  test('install : met en cache les ressources statiques puis skipWaiting', async () => {
    const sw = loadSW();
    await fire(sw.handlers, 'install', {});
    expect(sw.caches.open).toHaveBeenCalledWith('locavac-v1');
    expect(sw.store.addAll).toHaveBeenCalledWith(['/', '/manifest.json', '/icon.svg']);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  test('les ressources pré-cachées existent réellement dans public/', () => {
    const publicDir = path.join(__dirname, '..', '..', 'public');
    for (const url of ['/manifest.json', '/icon.svg']) {
      expect(fs.existsSync(path.join(publicDir, url))).toBe(true);
    }
  });

  test('activate : supprime uniquement les anciens caches, garde le courant, prend le contrôle', async () => {
    const sw = loadSW({ cacheKeys: ['locavac-v0', 'locavac-v1', 'autre-app'] });
    await fire(sw.handlers, 'activate', {});
    expect(sw.caches.delete).toHaveBeenCalledWith('locavac-v0');
    expect(sw.caches.delete).toHaveBeenCalledWith('autre-app');
    expect(sw.caches.delete).not.toHaveBeenCalledWith('locavac-v1');
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
  test('réponse réseau transmise telle quelle', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.resolve(new Response('{"a":1}', { status: 200 })) });
    const res = await fire(sw.handlers, 'fetch', { request: { url: ORIGIN + '/api/listings', mode: 'cors' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"a":1}');
  });

  test('hors ligne : 503 JSON avec message explicite, jamais de cache', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.reject(new Error('offline')) });
    const res = await fire(sw.handlers, 'fetch', { request: { url: ORIGIN + '/api/reservations/mine', mode: 'cors' } });
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect((await res.json()).error).toMatch(/hors ligne/i);
    expect(sw.caches.match).not.toHaveBeenCalled();
  });
});

describe('Service Worker — ressources externes', () => {
  test('origine externe : réseau uniquement, 503 vide hors ligne, aucun cache', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.reject(new Error('offline')) });
    const res = await fire(sw.handlers, 'fetch', { request: { url: 'https://fonts.googleapis.com/css2', mode: 'cors' } });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
    expect(sw.caches.open).not.toHaveBeenCalled();
  });
});

describe('Service Worker — navigation HTML', () => {
  test('cache-first : retourne la page en cache sans attendre le réseau', async () => {
    const cached = new Response('<html>en cache</html>');
    const sw = loadSW({ cachedByUrl: { '/': cached }, fetchImpl: () => new Promise(() => {}) });
    const res = await fire(sw.handlers, 'fetch', { request: navRequest });
    expect(res).toBe(cached);
  });

  test('sans cache : réseau, puis mise en cache de "/" si réponse ok', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.resolve(new Response('<html>frais</html>', { status: 200 })) });
    const res = await fire(sw.handlers, 'fetch', { request: navRequest });
    expect(await res.text()).toBe('<html>frais</html>');
    expect(sw.store.put).toHaveBeenCalledWith('/', expect.anything());
  });

  test('sans cache et hors ligne : 503 "Hors ligne"', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.reject(new Error('offline')) });
    const res = await fire(sw.handlers, 'fetch', { request: navRequest });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('Hors ligne');
  });

  test('réponse réseau en erreur (500) non mise en cache', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.resolve(new Response('boom', { status: 500 })) });
    await fire(sw.handlers, 'fetch', { request: navRequest });
    expect(sw.store.put).not.toHaveBeenCalled();
  });
});

describe('Service Worker — autres ressources statiques (cache-first)', () => {
  const asset = { url: ORIGIN + '/icon.svg', mode: 'no-cors' };

  test('en cache : retourné sans appel réseau', async () => {
    const cached = new Response('<svg/>');
    const sw = loadSW({ cachedByUrl: { [asset.url]: cached } });
    const res = await fire(sw.handlers, 'fetch', { request: asset });
    expect(res).toBe(cached);
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  test('absent du cache : réseau puis mise en cache', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.resolve(new Response('<svg/>', { status: 200 })) });
    const res = await fire(sw.handlers, 'fetch', { request: asset });
    expect(res.status).toBe(200);
    expect(sw.store.put).toHaveBeenCalledWith(asset, expect.anything());
  });

  test('absent du cache et hors ligne : 503 vide', async () => {
    const sw = loadSW({ fetchImpl: () => Promise.reject(new Error('offline')) });
    const res = await fire(sw.handlers, 'fetch', { request: asset });
    expect(res.status).toBe(503);
  });
});
