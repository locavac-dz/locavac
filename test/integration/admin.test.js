const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');

// id=98 est le seul admin dans le mock
const ADMIN_TOKEN = jwt.sign({ id: 98, email: 'admin@test.dz', is_admin: true }, process.env.JWT_SECRET);
const USER_TOKEN  = jwt.sign({ id: 2,  email: 'guest@test.dz', is_admin: false }, process.env.JWT_SECRET);

const ADMIN_AUTH = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const USER_AUTH  = { Authorization: `Bearer ${USER_TOKEN}` };

describe('Routes admin — contrôle d\'accès', () => {
  test('GET /api/admin/stats — 403 pour non-admin', async () => {
    const res = await request(app).get('/api/admin/stats').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('GET /api/admin/stats — 401 sans token', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/users — 403 pour non-admin', async () => {
    const res = await request(app).get('/api/admin/users').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('GET /api/admin/listings — 403 pour non-admin', async () => {
    const res = await request(app).get('/api/admin/listings').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('GET /api/admin/users — 200 pour admin (retourne tableau)', async () => {
    const res = await request(app).get('/api/admin/users').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/admin/listings — 200 pour admin (retourne tableau)', async () => {
    const res = await request(app).get('/api/admin/listings').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/admin/users — paramètre page ignoré si invalide (pas de crash)', async () => {
    const res = await request(app).get('/api/admin/users?page=abc').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
  });

  test('PATCH /api/admin/users/:id — 403 pour non-admin', async () => {
    const res = await request(app).patch('/api/admin/users/2').set(USER_AUTH).send({ banned: true });
    expect(res.status).toBe(403);
  });
});
