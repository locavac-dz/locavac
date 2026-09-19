const request = require('supertest');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({ mailWelcome: jest.fn(), mailVerifyEmail: jest.fn() }));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');

describe('POST /api/auth/register', () => {
  test('400 si email manquant', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Test', password: 'MotDePasse123!' });
    expect(res.status).toBe(400);
  });

  test('400 si mot de passe < 6 caractères', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Test', email: 'test@test.dz', password: '123' });
    expect(res.status).toBe(400);
  });

  test('400 si nom < 2 caractères', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'X', email: 'test@test.dz', password: 'MotDePasse123!' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  test('400 si email manquant', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ password: 'test' });
    expect(res.status).toBe(400);
  });

  test('401 si mot de passe incorrect', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'wrong@test.dz', password: 'mauvais-mdp' });
    expect(res.status).toBe(401);
  });

  test('403 si compte banni', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'banned@test.dz', password: 'MotDePasse123!' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/auth/me', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('401 avec token invalide', async () => {
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', 'Bearer faux-token');
    expect(res.status).toBe(401);
  });
});
