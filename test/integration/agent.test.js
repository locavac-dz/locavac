'use strict';
const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

// Mock de l'agent pour éviter la lecture de locavac.json et les accès disque
jest.mock('../../server/agent', () => ({
  state: {
    startedAt:  '2026-01-01T00:00:00.000Z',
    lastBackup: null,
    lastReport: null,
    lastCheck:  null,
    checks:     5,
    alerts: [
      { id: 1, type: 'info', message: 'Test alerte active', dismissed: false },
      { id: 2, type: 'warn', message: 'Test alerte déjà dismissée', dismissed: true },
    ],
  },
  doBackup: jest.fn(),
}));

const app   = require('../../server/index');
const agent = require('../../server/agent');

const ADMIN_TOKEN = jwt.sign({ id: 98, email: 'admin@test.dz', is_admin: true }, process.env.JWT_SECRET);
const HOST_TOKEN  = jwt.sign({ id: 1,  email: 'host@test.dz'  }, process.env.JWT_SECRET);
const ADMIN_AUTH  = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const HOST_AUTH   = { Authorization: `Bearer ${HOST_TOKEN}`  };

// ── GET /api/agent/status ──────────────────────────────────────────────────

describe('GET /api/agent/status', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/agent/status');
    expect(res.status).toBe(401);
  });

  test('403 si non admin', async () => {
    const res = await request(app).get('/api/agent/status').set(HOST_AUTH);
    expect(res.status).toBe(403);
  });

  test('200 si admin — retourne tous les champs de state', async () => {
    const res = await request(app).get('/api/agent/status').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      startedAt:  '2026-01-01T00:00:00.000Z',
      checks:     5,
      alerts:     expect.any(Array),
    });
    expect(res.body).toHaveProperty('lastBackup');
    expect(res.body).toHaveProperty('lastReport');
    expect(res.body).toHaveProperty('lastCheck');
  });
});

// ── POST /api/agent/backup ─────────────────────────────────────────────────

describe('POST /api/agent/backup', () => {
  afterEach(() => jest.clearAllMocks());

  test('401 sans token', async () => {
    const res = await request(app).post('/api/agent/backup');
    expect(res.status).toBe(401);
  });

  test('403 si non admin', async () => {
    const res = await request(app).post('/api/agent/backup').set(HOST_AUTH);
    expect(res.status).toBe(403);
  });

  test('200 si admin — doBackup() appelé', async () => {
    const res = await request(app).post('/api/agent/backup').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(agent.doBackup).toHaveBeenCalledTimes(1);
  });
});

// ── DELETE /api/agent/alerts/:id ───────────────────────────────────────────

describe('DELETE /api/agent/alerts/:id', () => {
  test('401 sans token', async () => {
    const res = await request(app).delete('/api/agent/alerts/1');
    expect(res.status).toBe(401);
  });

  test('403 si non admin', async () => {
    const res = await request(app).delete('/api/agent/alerts/1').set(HOST_AUTH);
    expect(res.status).toBe(403);
  });

  test('404 si alerte introuvable', async () => {
    const res = await request(app).delete('/api/agent/alerts/9999').set(ADMIN_AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('200 si admin — alerte marquée dismissed', async () => {
    const res = await request(app).delete('/api/agent/alerts/1').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // L'alerte id=1 du mock doit être dismissée in-place
    const alerte = agent.state.alerts.find(a => a.id === 1);
    expect(alerte.dismissed).toBe(true);
  });
});
