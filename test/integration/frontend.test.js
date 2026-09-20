const request = require('supertest');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');

const PUBLIC_DIR  = path.join(__dirname, '..', '..', 'public');
const UPLOAD_DIR  = path.join(PUBLIC_DIR, 'uploads');
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

// Documents d'identité (CNI) : accès réservé au propriétaire et aux admins
describe('Protection des PDF — /uploads/*.pdf', () => {
  const OWNER_ID = 2;
  const filename = `${OWNER_ID}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.pdf`;
  const filePath = path.join(UPLOAD_DIR, filename);

  const OWNER_TOKEN = sign({ id: OWNER_ID, email: 'guest@test.dz' });
  const OTHER_TOKEN = sign({ id: 1,        email: 'host@test.dz' });
  const ADMIN_TOKEN = sign({ id: 98,       email: 'admin@test.dz', is_admin: true });

  beforeAll(() => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(filePath, '%PDF-1.4\n%test\n');
  });
  afterAll(() => { try { fs.unlinkSync(filePath); } catch {} });

  test('401 sans token', async () => {
    const res = await request(app).get('/uploads/' + filename);
    expect(res.status).toBe(401);
  });

  test('401 avec un token invalide', async () => {
    const res = await request(app).get('/uploads/' + filename).set('Authorization', 'Bearer pas.un.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('401 avec un token signé par une autre clé', async () => {
    const forged = jwt.sign({ id: OWNER_ID }, 'autre-secret');
    const res = await request(app).get('/uploads/' + filename).set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  test('403 pour un utilisateur qui n\'est pas le propriétaire', async () => {
    const res = await request(app).get('/uploads/' + filename).set('Authorization', `Bearer ${OTHER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('200 pour le propriétaire (en-tête Authorization)', async () => {
    const res = await request(app).get('/uploads/' + filename).set('Authorization', `Bearer ${OWNER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('200 pour le propriétaire (?token= dans l\'URL, pour l\'ouverture dans un onglet)', async () => {
    const res = await request(app).get(`/uploads/${filename}?token=${OWNER_TOKEN}`);
    expect(res.status).toBe(200);
  });

  test('200 pour un admin', async () => {
    const res = await request(app).get('/uploads/' + filename).set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
  });

  test('extension en majuscules (.PDF) protégée aussi', async () => {
    const res = await request(app).get('/uploads/' + filename.replace('.pdf', '.PDF'));
    expect(res.status).toBe(401);
  });

  test('les images ne sont pas soumises à la vérification de token', async () => {
    const res = await request(app).get('/uploads/inexistante.jpg');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
