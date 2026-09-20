'use strict';
const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const HOST_TOKEN  = jwt.sign({ id: 1, email: 'host@test.dz',  is_host: true  }, process.env.JWT_SECRET);
const ADMIN_TOKEN = jwt.sign({ id: 98, email: 'admin@test.dz', is_admin: true }, process.env.JWT_SECRET);
const HOST_AUTH   = { Authorization: `Bearer ${HOST_TOKEN}`  };
const ADMIN_AUTH  = { Authorization: `Bearer ${ADMIN_TOKEN}` };

// ── GET /api/stats/host ────────────────────────────────────────────────────

describe('GET /api/stats/host', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/stats/host');
    expect(res.status).toBe(401);
  });

  test('200 retourne la structure complète du tableau de bord', async () => {
    const res = await request(app).get('/api/stats/host').set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      listings_count: expect.any(Number),
      reservations:   expect.objectContaining({ total: expect.any(Number), confirmed: expect.any(Number) }),
      revenue:        expect.objectContaining({ total: expect.any(Number), monthly: expect.any(Object) }),
      occupancy_rate: expect.any(Number),
      avg_rating:     expect.any(Number),
    });
  });

  test('200 revenu calculé sur réservations confirmées uniquement', async () => {
    db.reservations.findByListings.mockResolvedValueOnce([
      { id: 1, listing_id: 1, status: 'confirmed', total_price: 10000, check_in: '2026-01-01', check_out: '2026-01-03' },
      { id: 2, listing_id: 1, status: 'pending',   total_price: 5000,  check_in: '2027-06-01', check_out: '2027-06-03' },
    ]);
    const res = await request(app).get('/api/stats/host').set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.revenue.total).toBe(10000);
    expect(res.body.reservations.confirmed).toBe(1);
    expect(res.body.reservations.pending).toBe(1);
  });
});

// ── GET /api/stats/host/earnings ───────────────────────────────────────────

describe('GET /api/stats/host/earnings', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/stats/host/earnings');
    expect(res.status).toBe(401);
  });

  test('200 retourne {summary, bank_info, data, pagination}', async () => {
    const res = await request(app).get('/api/stats/host/earnings').set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('bank_info');
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.summary.commission_pct).toBe(10);
  });

  test('200 commission 10% : fee = 10% du brut, net = 90%', async () => {
    db.reservations.findByListings.mockResolvedValueOnce([
      { id: 300, listing_id: 1, status: 'confirmed', total_price: 10000,
        payment_id: null, check_in: '2026-01-01', check_out: '2026-01-05', created_at: '2026-01-01' },
    ]);
    db.payments.findByIds.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/stats/host/earnings').set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.summary.gross).toBe(10000);
    expect(res.body.summary.fee).toBe(1000);
    expect(res.body.summary.net).toBe(9000);
  });

  test('200 pagination ?page=1&limit=1 : 1 item retourné, summary sur tout', async () => {
    db.reservations.findByListings.mockResolvedValueOnce([
      { id: 301, listing_id: 1, status: 'confirmed', total_price: 5000,
        payment_id: null, check_in: '2026-02-01', check_out: '2026-02-03', created_at: '2026-02-01' },
      { id: 302, listing_id: 1, status: 'confirmed', total_price: 8000,
        payment_id: null, check_in: '2026-03-01', check_out: '2026-03-04', created_at: '2026-03-01' },
    ]);
    db.payments.findByIds.mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/stats/host/earnings?page=1&limit=1')
      .set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 1, total: 2, pages: 2 });
    // Summary toujours calculé sur les 2 transactions, quelle que soit la page
    expect(res.body.summary.gross).toBe(13000);
  });
});

// ── PATCH /api/stats/host/bank ─────────────────────────────────────────────

describe('PATCH /api/stats/host/bank', () => {
  afterEach(() => jest.clearAllMocks());

  test('401 sans token', async () => {
    const res = await request(app).patch('/api/stats/host/bank').send({ rib: 'test' });
    expect(res.status).toBe(401);
  });

  test('400 si ni rib ni ccp', async () => {
    const res = await request(app).patch('/api/stats/host/bank').set(HOST_AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rib|ccp/i);
  });

  test('200 si rib fourni — updateById appelé', async () => {
    const res = await request(app)
      .patch('/api/stats/host/bank')
      .set(HOST_AUTH)
      .send({ rib: '002 00012 0000040031 97' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(db.users.updateById).toHaveBeenCalledWith(1, { rib: '002 00012 0000040031 97' });
  });

  test('200 si ccp fourni', async () => {
    const res = await request(app)
      .patch('/api/stats/host/bank')
      .set(HOST_AUTH)
      .send({ ccp: '1234567 Clé 89' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('200 chaîne vide normalisée en null', async () => {
    const res = await request(app)
      .patch('/api/stats/host/bank')
      .set(HOST_AUTH)
      .send({ rib: '   ' });
    expect(res.status).toBe(200);
    expect(db.users.updateById).toHaveBeenCalledWith(1, { rib: null });
  });
});

// ── GET /api/stats/host/payouts ────────────────────────────────────────────

describe('GET /api/stats/host/payouts', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/stats/host/payouts');
    expect(res.status).toBe(401);
  });

  test('200 retourne un tableau', async () => {
    const res = await request(app).get('/api/stats/host/payouts').set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── POST /api/stats/host/payout ────────────────────────────────────────────

describe('POST /api/stats/host/payout', () => {
  test('401 sans token', async () => {
    const res = await request(app).post('/api/stats/host/payout');
    expect(res.status).toBe(401);
  });

  test('400 si aucune annonce (mock pool vide par défaut)', async () => {
    // pool.connect().query('SELECT id FROM listings...') → rows:[] → pas d'annonces
    const res = await request(app).post('/api/stats/host/payout').set(HOST_AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/annonce/i);
  });
});

// ── GET /api/stats/admin/payouts ───────────────────────────────────────────

describe('GET /api/stats/admin/payouts', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/stats/admin/payouts');
    expect(res.status).toBe(401);
  });

  test('403 si non admin', async () => {
    const res = await request(app).get('/api/stats/admin/payouts').set(HOST_AUTH);
    expect(res.status).toBe(403);
  });

  test('200 si admin — retourne tableau enrichi', async () => {
    db.payouts.findAll.mockResolvedValueOnce([
      { id: 700, host_id: 1, amount: 5000, status: 'pending', requested_at: '2026-01-01' },
    ]);
    const res = await request(app).get('/api/stats/admin/payouts').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('host_name');
    expect(res.body[0]).toHaveProperty('host_email');
  });
});

// ── PATCH /api/stats/admin/payouts/:id ────────────────────────────────────

describe('PATCH /api/stats/admin/payouts/:id', () => {
  afterEach(() => jest.clearAllMocks());

  test('401 sans token', async () => {
    const res = await request(app).patch('/api/stats/admin/payouts/700').send({ status: 'paid' });
    expect(res.status).toBe(401);
  });

  test('403 si non admin', async () => {
    const res = await request(app).patch('/api/stats/admin/payouts/700')
      .set(HOST_AUTH).send({ status: 'paid' });
    expect(res.status).toBe(403);
  });

  test('400 si status invalide', async () => {
    const res = await request(app).patch('/api/stats/admin/payouts/700')
      .set(ADMIN_AUTH).send({ status: 'approved' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/paid|rejected/i);
  });

  test('404 si payout introuvable', async () => {
    // findById retourne null par défaut
    const res = await request(app).patch('/api/stats/admin/payouts/9999')
      .set(ADMIN_AUTH).send({ status: 'paid' });
    expect(res.status).toBe(404);
  });

  test('200 approuver un virement', async () => {
    db.payouts.findById.mockResolvedValueOnce(
      { id: 700, host_id: 1, amount: 5000, status: 'pending' }
    );
    const res = await request(app).patch('/api/stats/admin/payouts/700')
      .set(ADMIN_AUTH).send({ status: 'paid', admin_note: 'Virement effectué' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(db.payouts.updateById).toHaveBeenCalledWith(700, expect.objectContaining({
      status: 'paid',
      admin_note: 'Virement effectué',
    }));
  });

  test('200 rejeter un virement', async () => {
    db.payouts.findById.mockResolvedValueOnce(
      { id: 700, host_id: 1, amount: 5000, status: 'pending' }
    );
    const res = await request(app).patch('/api/stats/admin/payouts/700')
      .set(ADMIN_AUTH).send({ status: 'rejected' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
