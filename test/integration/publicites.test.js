'use strict';
const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const ADMIN_TOKEN = jwt.sign({ id: 98, email: 'admin@test.dz', is_admin: true }, process.env.JWT_SECRET);
const HOST_TOKEN  = jwt.sign({ id: 1,  email: 'host@test.dz'  }, process.env.JWT_SECRET);
const ADMIN_AUTH  = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const HOST_AUTH   = { Authorization: `Bearer ${HOST_TOKEN}`  };

// Publicité fictive pour les tests de lecture
const PUB_1 = {
  id: 1, nom: 'Hôtel Atlas', type: 'hotel', wilaya: 'Alger', ville: 'Alger-Centre',
  forfait: 'premium', actif: true, images: '[]',
};

// ── GET /api/publicites — liste publique ───────────────────────────────────

describe('GET /api/publicites', () => {
  test('200 retourne un tableau (vide par défaut)', async () => {
    const res = await request(app).get('/api/publicites');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── GET /api/publicites/:id ────────────────────────────────────────────────

describe('GET /api/publicites/:id', () => {
  test('400 si id non entier', async () => {
    const res = await request(app).get('/api/publicites/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('404 si introuvable (pool vide par défaut)', async () => {
    const res = await request(app).get('/api/publicites/9999');
    expect(res.status).toBe(404);
  });

  test('200 si publicité trouvée', async () => {
    // L'auth n'intervient pas ici (route publique)
    // Séquence pool.query : une seule requête SELECT → on mock directement
    db.pool.query.mockResolvedValueOnce({ rows: [PUB_1] });
    const res = await request(app).get('/api/publicites/1');
    expect(res.status).toBe(200);
    expect(res.body.nom).toBe('Hôtel Atlas');
  });
});

// ── GET /api/publicites/admin/all ─────────────────────────────────────────

describe('GET /api/publicites/admin/all', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/publicites/admin/all');
    expect(res.status).toBe(401);
  });

  test('403 si non admin (token hôte)', async () => {
    const res = await request(app).get('/api/publicites/admin/all').set(HOST_AUTH);
    expect(res.status).toBe(403);
  });

  test('200 si admin — retourne un tableau', async () => {
    // Auth (call 1) : pool.query géré par défaut (USERS[98] → non banni)
    // SELECT * FROM publicites (call 2) : on injecte une ligne fictive
    db.pool.query
      .mockResolvedValueOnce({ rows: [{ id: 98, banned: false }] }) // auth
      .mockResolvedValueOnce({ rows: [PUB_1] });                    // SELECT publicites
    const res = await request(app).get('/api/publicites/admin/all').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── POST /api/publicites ───────────────────────────────────────────────────

describe('POST /api/publicites', () => {
  afterEach(() => jest.clearAllMocks());

  test('401 sans token', async () => {
    const res = await request(app).post('/api/publicites')
      .send({ nom: 'Test', type: 'hotel', wilaya: 'Alger' });
    expect(res.status).toBe(401);
  });

  test('403 si non admin', async () => {
    const res = await request(app).post('/api/publicites')
      .set(HOST_AUTH).send({ nom: 'Test', type: 'hotel', wilaya: 'Alger' });
    expect(res.status).toBe(403);
  });

  test('400 si nom absent', async () => {
    const res = await request(app).post('/api/publicites')
      .set(ADMIN_AUTH).send({ type: 'hotel', wilaya: 'Alger' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nom/i);
  });

  test('400 si type invalide', async () => {
    const res = await request(app).post('/api/publicites')
      .set(ADMIN_AUTH).send({ nom: 'Test', type: 'auberge', wilaya: 'Alger' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type invalide/i);
  });

  test('400 si wilaya absente', async () => {
    const res = await request(app).post('/api/publicites')
      .set(ADMIN_AUTH).send({ nom: 'Test', type: 'hotel' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wilaya/i);
  });

  test('400 si forfait invalide', async () => {
    const res = await request(app).post('/api/publicites')
      .set(ADMIN_AUTH).send({ nom: 'Test', type: 'hotel', wilaya: 'Alger', forfait: 'gold' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/forfait invalide/i);
  });

  test('201 admin crée une publicite valide', async () => {
    const created = { id: 900, nom: 'Camping Zeralda', type: 'camping', wilaya: 'Alger', forfait: 'basic', actif: true };
    db.pool.query
      .mockResolvedValueOnce({ rows: [{ id: 98, banned: false }] }) // auth
      .mockResolvedValueOnce({ rows: [created] });                  // INSERT RETURNING
    const res = await request(app).post('/api/publicites')
      .set(ADMIN_AUTH)
      .send({ nom: 'Camping Zeralda', type: 'camping', wilaya: 'Alger' });
    expect(res.status).toBe(201);
    expect(res.body.nom).toBe('Camping Zeralda');
    expect(res.body.id).toBe(900);
  });
});

// ── PUT /api/publicites/:id ────────────────────────────────────────────────

describe('PUT /api/publicites/:id', () => {
  afterEach(() => jest.clearAllMocks());

  test('401 sans token', async () => {
    const res = await request(app).put('/api/publicites/1')
      .send({ nom: 'Modif', type: 'hotel', wilaya: 'Alger' });
    expect(res.status).toBe(401);
  });

  test('400 si id invalide', async () => {
    const res = await request(app).put('/api/publicites/abc').set(ADMIN_AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('400 si type invalide', async () => {
    const res = await request(app).put('/api/publicites/1')
      .set(ADMIN_AUTH).send({ nom: 'Test', type: 'ferme', wilaya: 'Alger' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type invalide/i);
  });

  test('400 si forfait invalide', async () => {
    const res = await request(app).put('/api/publicites/1')
      .set(ADMIN_AUTH).send({ nom: 'Test', type: 'hotel', wilaya: 'Alger', forfait: 'platine' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/forfait invalide/i);
  });

  test('404 si publicite introuvable', async () => {
    // Auth (call 1) géré normalement, UPDATE (call 2) retourne rows:[]
    db.pool.query.mockResolvedValueOnce({ rows: [{ id: 98, banned: false }] }); // auth
    // call 2 : UPDATE → rows:[] → 404
    const res = await request(app).put('/api/publicites/9999')
      .set(ADMIN_AUTH)
      .send({ nom: 'Test', type: 'hotel', wilaya: 'Alger' });
    expect(res.status).toBe(404);
  });

  test('200 mise à jour réussie', async () => {
    const updated = { ...PUB_1, nom: 'Hôtel Atlas Rénové' };
    db.pool.query
      .mockResolvedValueOnce({ rows: [{ id: 98, banned: false }] }) // auth
      .mockResolvedValueOnce({ rows: [updated] });                  // UPDATE RETURNING
    const res = await request(app).put('/api/publicites/1')
      .set(ADMIN_AUTH)
      .send({ nom: 'Hôtel Atlas Rénové', type: 'hotel', wilaya: 'Alger' });
    expect(res.status).toBe(200);
    expect(res.body.nom).toBe('Hôtel Atlas Rénové');
  });
});

// ── DELETE /api/publicites/:id ─────────────────────────────────────────────

describe('DELETE /api/publicites/:id', () => {
  afterEach(() => jest.clearAllMocks());

  test('401 sans token', async () => {
    const res = await request(app).delete('/api/publicites/1');
    expect(res.status).toBe(401);
  });

  test('403 si non admin', async () => {
    const res = await request(app).delete('/api/publicites/1').set(HOST_AUTH);
    expect(res.status).toBe(403);
  });

  test('400 si id invalide', async () => {
    const res = await request(app).delete('/api/publicites/xyz').set(ADMIN_AUTH);
    expect(res.status).toBe(400);
  });

  test('200 suppression réussie', async () => {
    db.pool.query
      .mockResolvedValueOnce({ rows: [{ id: 98, banned: false }] }) // auth
      .mockResolvedValueOnce({ rows: [] });                         // DELETE
    const res = await request(app).delete('/api/publicites/1').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
