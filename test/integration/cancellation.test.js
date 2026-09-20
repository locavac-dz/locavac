const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({
  mailReservationConfirmed: jest.fn(),
  mailReservationCancelled: jest.fn(),
}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

// id=2 est le voyageur de RESERVATION_1
const GUEST_TOKEN = jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET);
// id=1 est l'hôte de LISTING_1
const HOST_TOKEN  = jwt.sign({ id: 1, email: 'host@test.dz',  is_host: true }, process.env.JWT_SECRET);

const GUEST_AUTH = { Authorization: `Bearer ${GUEST_TOKEN}` };
const HOST_AUTH  = { Authorization: `Bearer ${HOST_TOKEN}`  };

describe('PATCH /api/reservations/:id/status — annulation & remboursement', () => {
  test('404 si réservation inconnue', async () => {
    const res = await request(app).patch('/api/reservations/9999/status')
      .set(GUEST_AUTH).send({ status: 'cancelled' });
    expect(res.status).toBe(404);
  });

  test('400 si statut invalide', async () => {
    const res = await request(app).patch('/api/reservations/300/status')
      .set(GUEST_AUTH).send({ status: 'refunded' });
    expect(res.status).toBe(400);
  });

  test('403 si voyageur tente de confirmer', async () => {
    const res = await request(app).patch('/api/reservations/300/status')
      .set(GUEST_AUTH).send({ status: 'confirmed' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/hôte/i);
  });

  test('402 si hôte confirme sans paiement', async () => {
    const res = await request(app).patch('/api/reservations/300/status')
      .set(HOST_AUTH).send({ status: 'confirmed' });
    // payment_id=null donc findSuccessByReservation retourne null → 402
    expect(res.status).toBe(402);
  });

  test('200 + refund calculé si voyageur annule (politique flexible)', async () => {
    const res = await request(app).patch('/api/reservations/300/status')
      .set(GUEST_AUTH).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('cancelled');
    // Politique flexible, check_in dans le futur → 100% de remboursement
    expect(res.body.refund).toBeTruthy();
    expect(typeof res.body.refund.pct).toBe('number');
    expect(res.body.refund.amount).toBeDefined();
  });

  test('401 sans token', async () => {
    const res = await request(app).patch('/api/reservations/300/status')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(401);
  });

  test('payments.updateById appelé avec refund_amount et refund_pct (colonnes migration 016)', async () => {
    // Réservation fictive avec payment_id défini et check_in dans le futur
    // (flexible + daysLeft >= 1 → pct=100)
    const resaWithPayment = {
      id: 300, listing_id: 1, guest_id: 2,
      check_in: '2027-06-01', check_out: '2027-06-05',
      guests_count: 1, total_price: 20000, status: 'confirmed', payment_id: 600,
    };
    db.reservations.findById.mockResolvedValueOnce(resaWithPayment);
    db.payments.updateById.mockClear();

    const res = await request(app).patch('/api/reservations/300/status')
      .set(GUEST_AUTH).send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.refund.pct).toBe(100);
    expect(res.body.refund.amount).toBe(20000);
    // Les colonnes refund_amount et refund_pct doivent être présentes dans l'update
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({
      status:        'refunded',
      refund_amount: 20000,
      refund_pct:    100,
    }));
  });
});
