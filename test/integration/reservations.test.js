const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({ mailReservationCreated: jest.fn(), mailNewReservationToHost: jest.fn() }));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app   = require('../../server/index');
const TOKEN = jwt.sign({ id: 99, email: 'guest@test.dz' }, process.env.JWT_SECRET);
const AUTH  = { Authorization: `Bearer ${TOKEN}` };

describe('POST /api/reservations — validation dates', () => {
  test('400 si listing_id manquant', async () => {
    const res = await request(app).post('/api/reservations').set(AUTH)
      .send({ check_in: '2027-01-10', check_out: '2027-01-15' });
    expect(res.status).toBe(400);
  });

  test('400 si format date invalide', async () => {
    const res = await request(app).post('/api/reservations').set(AUTH)
      .send({ listing_id: 1, check_in: '10/01/2027', check_out: '15/01/2027' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format/i);
  });

  test('400 si check_out <= check_in', async () => {
    const res = await request(app).post('/api/reservations').set(AUTH)
      .send({ listing_id: 1, check_in: '2027-01-15', check_out: '2027-01-10' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/départ/i);
  });

  test('400 si check_in dans le passé', async () => {
    const res = await request(app).post('/api/reservations').set(AUTH)
      .send({ listing_id: 1, check_in: '2020-01-01', check_out: '2020-01-05' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/passé/i);
  });

  test('400 si guests_count > capacité max du logement', async () => {
    // Le mock retourne un logement avec guests=2
    const res = await request(app).post('/api/reservations').set(AUTH)
      .send({ listing_id: 1, check_in: '2027-06-01', check_out: '2027-06-05', guests_count: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum/i);
  });

  test('401 sans token', async () => {
    const res = await request(app).post('/api/reservations')
      .send({ listing_id: 1, check_in: '2027-01-10', check_out: '2027-01-15' });
    expect(res.status).toBe(401);
  });
});
