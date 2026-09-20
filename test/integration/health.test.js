'use strict';
const request = require('supertest');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

describe('GET /api/health', () => {
  afterEach(() => jest.clearAllMocks());

  test('200 quand PostgreSQL répond', async () => {
    // pool.query('SELECT 1') → mock retourne { rows: [{ id: null }] } par défaut (rows: [])
    // Il suffit que la promesse se résolve sans lever d'erreur
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe('up');
    expect(typeof res.body.db_latency_ms).toBe('number');
    expect(typeof res.body.uptime_s).toBe('number');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).not.toHaveProperty('db_error');
  });

  test('503 quand PostgreSQL est indisponible', async () => {
    db.pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.db).toBe('down');
    expect(res.body.db_error).toBe('connection refused');
    expect(res.body).not.toHaveProperty('db_latency_ms');
  });

  test('503 quand PostgreSQL dépasse le timeout', async () => {
    jest.useFakeTimers();
    // Promesse qui ne se résout jamais (simule un serveur qui ne répond pas)
    db.pool.query.mockImplementationOnce(() => new Promise(() => {}));

    const resPromise = request(app).get('/api/health');
    // Déclenche le setTimeout de 3 s défini dans le handler
    jest.advanceTimersByTime(3001);
    jest.useRealTimers();

    const res = await resPromise;
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.db).toBe('down');
    expect(res.body.db_error).toBe('timeout');
  });
});
