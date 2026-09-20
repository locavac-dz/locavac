const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({
  mailPaymentConfirmedToGuest: jest.fn(),
  mailNewReservationToHost:    jest.fn(),
  mailVirementToHost:          jest.fn(),
}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

// id=2 est le voyageur propriétaire des réservations 300/301
const TOKEN = jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET);
const AUTH  = { Authorization: `Bearer ${TOKEN}` };

describe('POST /api/payments/init', () => {
  test('400 si reservation_id manquant', async () => {
    const res = await request(app).post('/api/payments/init')
      .set(AUTH).send({ method: 'cib' });
    expect(res.status).toBe(400);
  });

  test('400 si méthode invalide', async () => {
    const res = await request(app).post('/api/payments/init')
      .set(AUTH).send({ reservation_id: 301, method: 'bitcoin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('404 si réservation appartient à un autre utilisateur', async () => {
    // id=1 est l'hôte — la réservation appartient au guest (id=2)
    const tokenHost = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
    const res = await request(app).post('/api/payments/init')
      .set({ Authorization: `Bearer ${tokenHost}` })
      .send({ reservation_id: 301, method: 'cib' });
    expect(res.status).toBe(404);
  });

  test('409 si réservation déjà confirmée', async () => {
    // RESERVATION_1 (id=300) a status='confirmed'
    const res = await request(app).post('/api/payments/init')
      .set(AUTH).send({ reservation_id: 300, method: 'cib' });
    expect(res.status).toBe(409);
  });

  test('201 si données valides', async () => {
    const res = await request(app).post('/api/payments/init')
      .set(AUTH).send({ reservation_id: 301, method: 'especes' });
    expect(res.status).toBe(201);
    expect(res.body.payment_id).toBeDefined();
    expect(res.body.reference).toMatch(/^DZ/);
  });

  test('401 sans token', async () => {
    const res = await request(app).post('/api/payments/init')
      .send({ reservation_id: 301, method: 'cib' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/payments/:id/process — validation carte', () => {
  test('400 si format expiry invalide (non MM/AA)', async () => {
    const res = await request(app).post('/api/payments/600/process')
      .set(AUTH).send({ card_number: '5555555555554444', expiry: '1234', cvv: '123', card_holder: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MM\/AA/i);
  });

  test('400 si CVV non numérique', async () => {
    const res = await request(app).post('/api/payments/600/process')
      .set(AUTH).send({ card_number: '5555555555554444', expiry: '12/30', cvv: 'abc', card_holder: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cvv/i);
  });

  test('400 si numéro de carte > 19 chiffres', async () => {
    const res = await request(app).post('/api/payments/600/process')
      .set(AUTH).send({ card_number: '12345678901234567890', expiry: '12/30', cvv: '123', card_holder: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('400 si carte expirée (MM/AA)', async () => {
    const res = await request(app).post('/api/payments/600/process')
      .set(AUTH).send({ card_number: '5555555555554444', expiry: '01/20', cvv: '123', card_holder: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expir/i);
  });

  test('404 si paiement appartient à un autre utilisateur', async () => {
    const tokenOther = jwt.sign({ id: 99 }, process.env.JWT_SECRET);
    const res = await request(app).post('/api/payments/600/process')
      .set({ Authorization: `Bearer ${tokenOther}` })
      .send({ card_number: '5555555555554444', expiry: '12/30', cvv: '123', card_holder: 'Test' });
    expect(res.status).toBe(404);
  });

  test('401 sans token', async () => {
    const res = await request(app).post('/api/payments/600/process')
      .send({ card_number: '5555555555554444', expiry: '12/30', cvv: '123', card_holder: 'Test' });
    expect(res.status).toBe(401);
  });
});
