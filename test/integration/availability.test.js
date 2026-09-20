const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');

// id=1 est l'hôte de LISTING_1
const HOST_TOKEN  = jwt.sign({ id: 1, email: 'host@test.dz', is_host: true  }, process.env.JWT_SECRET);
const GUEST_TOKEN = jwt.sign({ id: 2, email: 'guest@test.dz', is_host: false }, process.env.JWT_SECRET);
const HOST_AUTH   = { Authorization: `Bearer ${HOST_TOKEN}`  };
const GUEST_AUTH  = { Authorization: `Bearer ${GUEST_TOKEN}` };

describe('GET /api/availability/:listing_id', () => {
  test('200 retourne les plages de disponibilité', async () => {
    const res = await request(app).get('/api/availability/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('listing_id', 1);
    expect(Array.isArray(res.body.unavailable)).toBe(true);
  });

  test('404 si annonce inexistante', async () => {
    const res = await request(app).get('/api/availability/9999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/availability/:listing_id/block', () => {
  test('401 sans token', async () => {
    const res = await request(app).post('/api/availability/1/block')
      .send({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.status).toBe(401);
  });

  test('403 si l\'utilisateur n\'est pas l\'hôte', async () => {
    const res = await request(app).post('/api/availability/1/block')
      .set(GUEST_AUTH).send({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.status).toBe(403);
  });

  test('400 si format de date invalide', async () => {
    const res = await request(app).post('/api/availability/1/block')
      .set(HOST_AUTH).send({ start: '01/06/2027', end: '10/06/2027' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format/i);
  });

  test('400 si date calendrier invalide (mois 13)', async () => {
    const res = await request(app).post('/api/availability/1/block')
      .set(HOST_AUTH).send({ start: '2027-13-01', end: '2027-13-10' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('400 si durée de blocage > 365 jours', async () => {
    const res = await request(app).post('/api/availability/1/block')
      .set(HOST_AUTH).send({ start: '2027-01-01', end: '2028-06-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/365/);
  });

  test('400 si start >= end', async () => {
    const res = await request(app).post('/api/availability/1/block')
      .set(HOST_AUTH).send({ start: '2027-06-10', end: '2027-06-01' });
    expect(res.status).toBe(400);
  });

  test('201 avec dates valides', async () => {
    const res = await request(app).post('/api/availability/1/block')
      .set(HOST_AUTH).send({ start: '2027-06-01', end: '2027-06-10', reason: 'Entretien' });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.blocked_ranges)).toBe(true);
  });
});

describe('DELETE /api/availability/:listing_id/block', () => {
  test('401 sans token', async () => {
    const res = await request(app).delete('/api/availability/1/block')
      .send({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.status).toBe(401);
  });

  test('403 si l\'utilisateur n\'est pas l\'hôte', async () => {
    const res = await request(app).delete('/api/availability/1/block')
      .set(GUEST_AUTH).send({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.status).toBe(403);
  });

  test('200 avec données valides (range absente → liste inchangée)', async () => {
    const res = await request(app).delete('/api/availability/1/block')
      .set(HOST_AUTH).send({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.blocked_ranges)).toBe(true);
  });
});
