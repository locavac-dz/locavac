const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({ mailNewMessage: jest.fn() }));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const TOKEN_1 = jwt.sign({ id: 1, email: 'host@test.dz'  }, process.env.JWT_SECRET);
const TOKEN_2 = jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET);
const AUTH_1  = { Authorization: `Bearer ${TOKEN_1}` };
const AUTH_2  = { Authorization: `Bearer ${TOKEN_2}` };

describe('GET /api/messages — liste des conversations', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/messages');
    expect(res.status).toBe(401);
  });

  test('200 retourne données paginées (vide par défaut)', async () => {
    const res = await request(app).get('/api/messages').set(AUTH_2);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, total: 0, pages: 0 });
  });
});

describe('GET /api/messages/:listing_id/:other_id', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/messages/1/2');
    expect(res.status).toBe(401);
  });

  test('400 si listing_id n\'est pas un entier', async () => {
    const res = await request(app).get('/api/messages/abc/2').set(AUTH_2);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('400 si other_id n\'est pas un entier', async () => {
    const res = await request(app).get('/api/messages/1/xyz').set(AUTH_2);
    expect(res.status).toBe(400);
  });

  test('200 avec identifiants valides', async () => {
    const res = await request(app).get('/api/messages/1/1').set(AUTH_2);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('thread');
  });
});

describe('POST /api/messages', () => {
  test('400 si body manquant', async () => {
    const res = await request(app).post('/api/messages')
      .set(AUTH_2).send({ to_id: 1, listing_id: 1 });
    expect(res.status).toBe(400);
  });

  test('400 si message > 2000 caractères', async () => {
    const res = await request(app).post('/api/messages')
      .set(AUTH_2).send({ to_id: 1, listing_id: 1, body: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2000/);
  });

  test('400 si envoi à soi-même', async () => {
    const res = await request(app).post('/api/messages')
      .set(AUTH_2).send({ to_id: 2, listing_id: 1, body: 'Bonjour' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  test('404 si destinataire inexistant', async () => {
    // id 9999 est inconnu dans le mock
    const res = await request(app).post('/api/messages')
      .set(AUTH_2).send({ to_id: 9999, listing_id: 1, body: 'Bonjour' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/destinataire/i);
  });

  test('201 avec données valides', async () => {
    const res = await request(app).post('/api/messages')
      .set(AUTH_2).send({ to_id: 1, listing_id: 1, body: 'Bonjour, le logement est disponible ?' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test('401 sans token', async () => {
    const res = await request(app).post('/api/messages')
      .send({ to_id: 1, listing_id: 1, body: 'Test' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/messages/unread-count', () => {
  test('200 retourne un compteur numérique', async () => {
    const res = await request(app).get('/api/messages/unread-count').set(AUTH_2);
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
  });

  test('401 sans token', async () => {
    const res = await request(app).get('/api/messages/unread-count');
    expect(res.status).toBe(401);
  });
});
