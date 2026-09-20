'use strict';
const request = require('supertest');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

// ── POST /api/newsletter ───────────────────────────────────────────────────

describe('POST /api/newsletter', () => {
  afterEach(() => jest.clearAllMocks());

  test('400 si email absent', async () => {
    const res = await request(app).post('/api/newsletter').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('400 si email vide', async () => {
    const res = await request(app).post('/api/newsletter').send({ email: '' });
    expect(res.status).toBe(400);
  });

  test('400 si email mal formé', async () => {
    const res = await request(app).post('/api/newsletter').send({ email: 'pas-un-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('400 si email sans domaine', async () => {
    const res = await request(app).post('/api/newsletter').send({ email: 'user@' });
    expect(res.status).toBe(400);
  });

  test('200 si email valide — pool.query appelé', async () => {
    const res = await request(app).post('/api/newsletter').send({ email: 'utilisateur@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Vérifie que l'email est normalisé en minuscules avant insertion
    expect(db.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('newsletter_subscribers'),
      ['utilisateur@example.com']
    );
  });

  test('200 email normalisé en minuscules', async () => {
    const res = await request(app).post('/api/newsletter').send({ email: 'USER@EXAMPLE.COM' });
    expect(res.status).toBe(200);
    expect(db.pool.query).toHaveBeenCalledWith(
      expect.anything(),
      ['user@example.com']
    );
  });

  test('200 si email déjà inscrit (ON CONFLICT DO NOTHING — idempotent)', async () => {
    // Le mock pool.query retourne { rows: [] } même pour un conflit — pas d'erreur
    const res = await request(app).post('/api/newsletter').send({ email: 'deja@inscrit.dz' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
