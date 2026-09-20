const request = require('supertest');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const HTML       = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const sign = payload => jwt.sign(payload, process.env.JWT_SECRET);

describe('Fichiers statiques servis par Express', () => {
  test('GET / — 200, HTML français, sans données serveur', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/<html lang="fr"/);
    expect(res.text).toMatch(/<title>Locavac/);
  });

  test('GET /manifest.json — JSON valide, icônes existantes, start_url "/"', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    const manifest = JSON.parse(res.text);
    expect(manifest.start_url).toBe('/');
    expect(manifest.lang).toBe('fr');
    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.join(PUBLIC_DIR, icon.src))).toBe(true);
    }
  });

  test('GET /icon.svg — 200 image/svg+xml', async () => {
    const res = await request(app).get('/icon.svg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
  });

  test('GET /robots.txt — interdit /api/ et /uploads/ et référence le sitemap', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Disallow: \/api\//);
    expect(res.text).toMatch(/Disallow: \/uploads\//);
    expect(res.text).toMatch(/Sitemap: https:\/\/locavac\.dz\/sitemap\.xml/);
  });

  test('GET /sitemap.xml — 200 XML avec alternates fr et ar', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toMatch(/hreflang="fr"/);
    expect(res.text).toMatch(/hreflang="ar"/);
  });
});

describe('Service Worker — GET /sw.js', () => {
  test('200 JavaScript, jamais mis en cache (détection des mises à jour)', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  test('en-tête Service-Worker-Allowed: / pour couvrir toute l\'origine', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.headers['service-worker-allowed']).toBe('/');
  });
});

describe('Pages HTML — /404 et repli SPA', () => {
  test('GET /404 — page d\'erreur dédiée', async () => {
    const res = await request(app).get('/404');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/Page introuvable/);
  });

  test('chemin inconnu — repli sur index.html (SPA)', async () => {
    const res = await request(app).get('/reservations/mes-sejours');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<title>Locavac/);
  });

  test('paramètres de raccourci PWA (?action=search) servent bien le SPA', async () => {
    const res = await request(app).get('/?action=search');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<html lang="fr"/);
  });
});

describe('Routes /api inconnues — 404 JSON (pas de repli SPA)', () => {
  test.each(['get', 'post', 'put', 'patch', 'delete'])('%s /api/route-inexistante → 404 JSON', async method => {
    const res = await request(app)[method]('/api/route-inexistante');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('sous-chemin inconnu d\'un routeur existant → 404 JSON', async () => {
    const res = await request(app).get('/api/stats/inconnu/encore');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('les routes API existantes ne sont pas affectées (/api/health)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('les pages hors /api gardent le repli SPA', async () => {
    const res = await request(app).get('/apropos');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<title>Locavac/);
  });
});

describe('En-têtes de sécurité (helmet)', () => {
  test('CSP restreinte à l\'origine + fonts Google, X-Content-Type-Options nosniff', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/font-src 'self' https:\/\/fonts\.gstatic\.com/);
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('X-Powered-By masqué', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// Les pièces d'identité vivent hors de public/ ; aucun PDF ne doit jamais sortir de /uploads,
// quel que soit l'encodage du chemin ou le jeton présenté.
describe('/uploads — aucun PDF servi, quel que soit l\'encodage', () => {
  const name     = `2_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.pdf`;
  const filePath = path.join(UPLOAD_DIR, name);
  const TOKEN    = sign({ id: 2, email: 'guest@test.dz' });

  beforeAll(() => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); fs.writeFileSync(filePath, '%PDF-1.4\n%test\n'); });
  afterAll(() => { try { fs.unlinkSync(filePath); } catch {} });

  test.each([
    ['.pdf',           n => n],
    ['%2Epdf',         n => n.replace('.pdf', '%2Epdf')],
    ['.PDF',           n => n.replace('.pdf', '.PDF')],
    ['%2E%50%44%46',   n => n.replace('.pdf', '%2E%50%44%46')],
  ])('404 JSON pour %s, même avec un jeton valide du propriétaire', async (_label, encode) => {
    const res = await request(app).get('/uploads/' + encode(name)).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  test('un jeton en query string n\'ouvre rien non plus', async () => {
    const res = await request(app).get(`/uploads/${name}?token=${TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('400 sur un encodage de chemin invalide', async () => {
    const res = await request(app).get('/uploads/%E0%A4%A');
    expect(res.status).toBe(400);
  });

  test('les images restent servies sans jeton (404 si absente, jamais 401/403)', async () => {
    const res = await request(app).get('/uploads/inexistante.jpg');
    expect([200, 404]).toContain(res.status);
  });
});

describe('Leaflet auto-hébergé — compatible avec script-src \'self\'', () => {
  test('index.html ne charge plus aucun script ou style depuis un CDN', () => {
    expect(HTML).not.toMatch(/unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/);
  });

  test('chaque ressource /vendor/ référencée existe dans public/', () => {
    const refs = [...HTML.matchAll(/(?:src|href)="(\/vendor\/[^"]+)"/g)].map(m => m[1]);
    expect(refs.length).toBeGreaterThanOrEqual(5);
    for (const ref of refs) expect(fs.existsSync(path.join(PUBLIC_DIR, ref))).toBe(true);
  });

  test('GET /vendor/leaflet/leaflet.js — 200 JavaScript, version 1.9.4', async () => {
    const res = await request(app).get('/vendor/leaflet/leaflet.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('1.9.4');
  });

  test('GET /vendor/leaflet.markercluster/leaflet.markercluster.js — 200', async () => {
    const res = await request(app).get('/vendor/leaflet.markercluster/leaflet.markercluster.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });

  test('feuille de style et images des marqueurs servies depuis l\'origine', async () => {
    const css = await request(app).get('/vendor/leaflet/leaflet.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
    const icon = await request(app).get('/vendor/leaflet/images/marker-icon.png');
    expect(icon.status).toBe(200);
    expect(icon.headers['content-type']).toMatch(/image\/png/);
  });

  test('la CSP servie n\'autorise aucun script externe', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/script-src 'self' 'unsafe-inline'(;|$)/);
    expect(csp).not.toMatch(/unpkg/);
  });
});
