const request = require('supertest');

// Mock DB et mailer avant le require de l'app
jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app  = require('../../server/index');
const jwt  = require('jsonwebtoken');

const TOKEN = jwt.sign({ id: 1, email: 'host@test.dz' }, process.env.JWT_SECRET);
const AUTH  = { Authorization: `Bearer ${TOKEN}` };

describe('POST /api/listings — validation', () => {
  test('400 si titre manquant', async () => {
    const res = await request(app).post('/api/listings').set(AUTH)
      .send({ location: 'Alger', wilaya: 'Alger', category: 'villa', price: 5000 });
    expect(res.status).toBe(400);
  });

  test('400 si titre trop court (< 5 chars)', async () => {
    const res = await request(app).post('/api/listings').set(AUTH)
      .send({ title: 'Ab', location: 'Alger', wilaya: 'Alger', category: 'villa', price: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/titre/i);
  });

  test('400 si prix nul ou négatif', async () => {
    const res = await request(app).post('/api/listings').set(AUTH)
      .send({ title: 'Belle villa', location: 'Alger', wilaya: 'Alger', category: 'villa', price: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prix/i);
  });

  test('400 si prix > 1 000 000 DZD', async () => {
    const res = await request(app).post('/api/listings').set(AUTH)
      .send({ title: 'Belle villa', location: 'Alger', wilaya: 'Alger', category: 'villa', price: 2_000_000 });
    expect(res.status).toBe(400);
  });

  test('400 si guests > 50', async () => {
    const res = await request(app).post('/api/listings').set(AUTH)
      .send({ title: 'Belle villa', location: 'Alger', wilaya: 'Alger', category: 'villa', price: 5000, guests: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/voyageurs/i);
  });

  test('400 si latitude hors [-90, 90]', async () => {
    const res = await request(app).post('/api/listings').set(AUTH)
      .send({ title: 'Belle villa', location: 'Alger', wilaya: 'Alger', category: 'villa', price: 5000, lat: 200 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/latitude/i);
  });

  test('401 sans token', async () => {
    const res = await request(app).post('/api/listings')
      .send({ title: 'Belle villa', location: 'Alger', wilaya: 'Alger', category: 'villa', price: 5000 });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/listings', () => {
  test('200 et tableau de résultats', async () => {
    const res = await request(app).get('/api/listings');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
