const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

// id=2 est le voyageur avec un séjour confirmé terminé (RESERVATION_1)
const GUEST_TOKEN = jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET);
const AUTH = { Authorization: `Bearer ${GUEST_TOKEN}` };

describe('POST /api/listings/:id/reviews — validation', () => {
  test('400 si note manquante', async () => {
    const res = await request(app).post('/api/listings/1/reviews')
      .set(AUTH).send({ comment: 'Très bien' });
    expect(res.status).toBe(400);
  });

  test('400 si note hors plage [1-5]', async () => {
    const res = await request(app).post('/api/listings/1/reviews')
      .set(AUTH).send({ rating: 6, comment: 'Super' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[1-5]/);
  });

  test('400 si commentaire > 1000 caractères', async () => {
    const res = await request(app).post('/api/listings/1/reviews')
      .set(AUTH).send({ rating: 4, comment: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1000/);
  });

  test('403 sans séjour confirmé terminé', async () => {
    // findValidStay retourne null → accès refusé
    db.reservations.findValidStay.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/listings/1/reviews')
      .set(AUTH).send({ rating: 4 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/séjour/i);
  });

  test('409 si avis déjà déposé', async () => {
    // findOne retourne un avis existant → conflit
    db.reviews.findOne.mockResolvedValueOnce({ id: 50 });
    const res = await request(app).post('/api/listings/1/reviews')
      .set(AUTH).send({ rating: 4 });
    expect(res.status).toBe(409);
  });

  test('201 si avis valide après séjour terminé', async () => {
    const res = await request(app).post('/api/listings/1/reviews')
      .set(AUTH).send({ rating: 5, comment: 'Excellent séjour !' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  test('401 sans token', async () => {
    const res = await request(app).post('/api/listings/1/reviews')
      .send({ rating: 4 });
    expect(res.status).toBe(401);
  });
});
