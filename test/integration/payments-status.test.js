const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

// PAYMENT_1 (id 600) appartient à l'utilisateur id=2
const GUEST_AUTH = { Authorization: `Bearer ${jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET)}` };
const HOST_AUTH  = { Authorization: `Bearer ${jwt.sign({ id: 1, email: 'host@test.dz' },  process.env.JWT_SECRET)}` };

afterEach(() => jest.clearAllMocks());

describe('GET /api/payments/:id/status', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/payments/600/status');
    expect(res.status).toBe(401);
  });

  test('404 si le paiement appartient à un autre utilisateur', async () => {
    const res = await request(app).get('/api/payments/600/status').set(HOST_AUTH);
    expect(res.status).toBe(404);
  });

  test('404 si paiement introuvable', async () => {
    const res = await request(app).get('/api/payments/601/status').set(GUEST_AUTH);
    expect(res.status).toBe(404);
  });

  test('200 avec les champs publics uniquement (montant en DZD)', async () => {
    const res = await request(app).get('/api/payments/600/status').set(GUEST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 600, reference: 'DZ-TEST-001', status: 'pending', amount: 25000, method: 'cib' });
    expect(res.body).not.toHaveProperty('user_id');
    expect(res.body).not.toHaveProperty('reservation_id');
  });
});

describe('GET /api/payments/reservation/:resa_id', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/payments/reservation/301');
    expect(res.status).toBe(401);
  });

  test('200 tableau vide et requête scopée à l\'utilisateur', async () => {
    const res = await request(app).get('/api/payments/reservation/301').set(GUEST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(db.payments.findByResaAndUser).toHaveBeenCalledWith(301, 2);
  });

  test('200 trié du plus récent au plus ancien (id décroissant)', async () => {
    db.payments.findByResaAndUser.mockResolvedValueOnce([{ id: 1 }, { id: 3 }, { id: 2 }]);
    const res = await request(app).get('/api/payments/reservation/301').set(GUEST_AUTH);
    expect(res.body.map(p => p.id)).toEqual([3, 2, 1]);
  });
});
