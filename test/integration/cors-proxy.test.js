const request = require('supertest');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));
// Chargé en mode production, le mailer réel armerait un timer de relance par rechargement du serveur
jest.mock('../../server/mailer', () => ({}));

const KEYS = ['CORS_ORIGINS', 'APP_URL', 'NODE_ENV'];
const SAVED = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));

// Recharge server/index.js avec un environnement donné. Une valeur '' est « définie mais vide » :
// dotenv ne la remplace pas par le contenu d'un éventuel .env local, et le serveur la traite comme absente.
function loadApp(env = {}) {
  for (const k of KEYS) process.env[k] = env[k] ?? (k === 'NODE_ENV' ? 'test' : '');
  let app;
  jest.isolateModules(() => { app = require('../../server/index'); });
  return app;
}
afterEach(() => {
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
});

const ping = (app, origin) => request(app).get('/api/health').set('Origin', origin);

describe('Proxy de confiance', () => {
  test('trust proxy = 1 : l\'IP réelle vient du premier X-Forwarded-For (Nginx), pas de la socket', () => {
    const app = loadApp();
    expect(app.get('trust proxy')).toBe(1);
  });
});

describe('CORS — origines autorisées', () => {
  test('origine listée dans CORS_ORIGINS : acceptée et renvoyée dans Access-Control-Allow-Origin', async () => {
    const app = loadApp({ CORS_ORIGINS: 'https://locavac.dz' });
    const res = await ping(app, 'https://locavac.dz');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://locavac.dz');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('origine inconnue : 403 JSON explicite, pas un 500', async () => {
    const app = loadApp({ CORS_ORIGINS: 'https://locavac.dz' });
    const res = await ping(app, 'https://evil.dz');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CORS/);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('APP_URL est toujours acceptée, slash final toléré des deux côtés', async () => {
    const app = loadApp({ APP_URL: 'https://locavac.dz/' });
    expect((await ping(app, 'https://locavac.dz')).status).toBe(200);
    expect((await ping(app, 'https://locavac.dz/')).status).toBe(200);
  });

  test('liste avec espaces et entrées vides nettoyée', async () => {
    const app = loadApp({ CORS_ORIGINS: ' https://a.dz , ,https://b.dz ' });
    expect((await ping(app, 'https://a.dz')).status).toBe(200);
    expect((await ping(app, 'https://b.dz')).status).toBe(200);
    expect((await ping(app, 'https://c.dz')).status).toBe(403);
  });

  test('requête sans Origin (curl, même serveur) toujours acceptée', async () => {
    const app = loadApp({ CORS_ORIGINS: 'https://locavac.dz' });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  test('hors production, localhost:3000 reste toléré par défaut', async () => {
    const app = loadApp();
    expect((await ping(app, 'http://localhost:3000')).status).toBe(200);
  });
});

describe('CORS — garde de production', () => {
  test('refus de démarrer sans CORS_ORIGINS ni APP_URL', () => {
    expect(() => loadApp({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
  });

  test('refus de démarrer si seules des origines localhost sont configurées', () => {
    expect(() => loadApp({ NODE_ENV: 'production', APP_URL: 'http://localhost:3000', CORS_ORIGINS: 'http://127.0.0.1:3000' })).toThrow(/CORS_ORIGINS/);
  });

  test('démarre avec un domaine public et n\'autorise plus localhost', async () => {
    const app = loadApp({ NODE_ENV: 'production', CORS_ORIGINS: 'https://locavac.dz' });
    expect((await ping(app, 'https://locavac.dz')).status).toBe(200);
    expect((await ping(app, 'http://localhost:3000')).status).toBe(403);
  });
});
