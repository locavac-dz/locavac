const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const HOST = { Authorization: `Bearer ${jwt.sign({ id: 1, email: 'host@test.dz', is_host: true }, process.env.JWT_SECRET)}` };

// Client de transaction simulé : répond selon le SQL reçu, consommé par le prochain pool.connect()
function payoutClient({ listings = [{ id: 1 }], confirmed = [], payouts = [], user = { rib: '00799999000123456789', ccp: null }, failOn = null } = {}) {
  const client = {
    query: jest.fn((sql, params) => {
      if (failOn && failOn.test(sql))                   return Promise.reject(new Error('boom'));
      if (/SELECT id FROM listings/.test(sql))          return Promise.resolve({ rows: listings });
      if (/SELECT total_price FROM reservations/.test(sql)) return Promise.resolve({ rows: confirmed.map(total_price => ({ total_price })) });
      if (/FROM payouts/.test(sql))                     return Promise.resolve({ rows: payouts.map(amount => ({ amount })) });
      if (/SELECT rib, ccp FROM users/.test(sql))       return Promise.resolve({ rows: user ? [user] : [] });
      if (/INSERT INTO payouts/.test(sql))              return Promise.resolve({ rows: [{ id: 701, host_id: params[0], amount: params[1], status: 'pending' }] });
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  db.pool.connect.mockResolvedValueOnce(client);
  return client;
}
const sqls = c => c.query.mock.calls.map(x => x[0]);
const requestPayout = () => request(app).post('/api/stats/host/payout').set(HOST);

afterEach(() => jest.clearAllMocks());

describe('POST /api/stats/host/payout — demande de virement', () => {
  test('401 sans token', async () => {
    const res = await request(app).post('/api/stats/host/payout');
    expect(res.status).toBe(401);
  });

  test('400 si l\'hôte n\'a aucune annonce : ROLLBACK, connexion libérée', async () => {
    const client = payoutClient({ listings: [] });
    const res = await requestPayout();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aucune annonce/i);
    expect(sqls(client)).toContain('ROLLBACK');
    expect(sqls(client)).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('400 solde < 1 000 DZD (1110 brut → 999 net) : ROLLBACK, aucun INSERT', async () => {
    const client = payoutClient({ confirmed: [1110] });
    const res = await requestPayout();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1 000 DZD/);
    expect(sqls(client)).toContain('ROLLBACK');
    expect(sqls(client).some(s => /INSERT INTO payouts/.test(s))).toBe(false);
  });

  test('exactement 1 000 DZD net (900 + 100) : accepté', async () => {
    payoutClient({ confirmed: [1000, 111] });
    const res = await requestPayout();
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(1000);
  });

  test('400 sans coordonnées bancaires (ni RIB ni CCP)', async () => {
    const client = payoutClient({ confirmed: [50000], user: { rib: null, ccp: null } });
    const res = await requestPayout();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/coordonnées bancaires/i);
    expect(sqls(client)).toContain('ROLLBACK');
  });

  test('400 si l\'utilisateur est introuvable', async () => {
    payoutClient({ confirmed: [50000], user: null });
    const res = await requestPayout();
    expect(res.status).toBe(400);
  });

  test('un CCP seul suffit', async () => {
    payoutClient({ confirmed: [50000], user: { rib: null, ccp: '12345678 90' } });
    const res = await requestPayout();
    expect(res.status).toBe(201);
  });

  test('201 : commission 10 % déduite, virements déjà demandés retranchés (13 500 − 3 500 = 10 000 DZD)', async () => {
    const client = payoutClient({ confirmed: [10000, 5000], payouts: [3500] });
    const res = await requestPayout();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ host_id: 1, amount: 10000, status: 'pending' });
    const insert = client.query.mock.calls.find(c => /INSERT INTO payouts/.test(c[0]));
    expect(insert[1]).toEqual([1, 10000]);
  });

  test('arrondi par réservation : 3 × 3 333 DZD → 3 × 3 000 = 9 000 (et non 8 999)', async () => {
    payoutClient({ confirmed: [3333, 3333, 3333] });
    const res = await requestPayout();
    expect(res.body.amount).toBe(9000);
  });

  test('seuls les virements payés ou en attente réduisent le solde (les refusés sont exclus)', async () => {
    const client = payoutClient({ confirmed: [10000] });
    await requestPayout();
    const q = client.query.mock.calls.find(c => /FROM payouts/.test(c[0]))[0];
    expect(q).toMatch(/status IN \('paid', 'pending'\)/);
    expect(q).not.toMatch(/rejected/);
  });

  test('seules les réservations confirmées des annonces de l\'hôte comptent', async () => {
    const client = payoutClient({ listings: [{ id: 1 }, { id: 4 }], confirmed: [10000] });
    await requestPayout();
    const q = client.query.mock.calls.find(c => /SELECT total_price FROM reservations/.test(c[0]));
    expect(q[0]).toMatch(/status = 'confirmed'/);
    expect(q[1]).toEqual([[1, 4]]);
  });

  test('transaction : BEGIN → verrou consultatif par utilisateur → … → COMMIT → release', async () => {
    const client = payoutClient({ confirmed: [10000] });
    await requestPayout();
    const q = sqls(client);
    expect(q[0]).toBe('BEGIN');
    expect(q[1]).toMatch(/pg_advisory_xact_lock/);
    expect(client.query.mock.calls[1][1]).toEqual([1]);
    expect(q[q.length - 1]).toBe('COMMIT');
    expect(q).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('500 si l\'INSERT échoue : ROLLBACK et connexion libérée', async () => {
    const client = payoutClient({ confirmed: [10000], failOn: /INSERT INTO payouts/ });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await requestPayout();
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(sqls(client)).toContain('ROLLBACK');
    expect(sqls(client)).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/stats/host — calculs du tableau de bord', () => {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const THIS_MONTH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const dash = () => request(app).get('/api/stats/host').set(HOST);

  test('revenu, nuits, taux d\'occupation et annonce la plus réservée', async () => {
    db.reservations.findByListings.mockResolvedValueOnce([
      { id: 1, listing_id: 1, status: 'confirmed', total_price: 20000, check_in: `${THIS_MONTH}-05`, check_out: `${THIS_MONTH}-09` },
      { id: 2, listing_id: 1, status: 'confirmed', total_price: 30000, check_in: `${THIS_MONTH}-15`, check_out: `${THIS_MONTH}-21` },
      { id: 3, listing_id: 1, status: 'cancelled', total_price: 99999, check_in: `${THIS_MONTH}-25`, check_out: `${THIS_MONTH}-27` },
      { id: 4, listing_id: 1, status: 'pending',   total_price: 7000,  check_in: `${THIS_MONTH}-28`, check_out: `${THIS_MONTH}-29` },
    ]);
    const res = await dash();
    expect(res.status).toBe(200);
    expect(res.body.reservations).toEqual({ total: 4, confirmed: 2, pending: 1, cancelled: 1 });
    expect(res.body.revenue.total).toBe(50000);
    expect(res.body.booked_nights).toBe(10);
    expect(res.body.occupancy_rate).toBe(3);
    expect(res.body.top_listing).toEqual({ id: 1, title: 'Villa de test', bookings: 2 });
  });

  test('revenu mensuel : 12 mois glissants, le mois courant en dernier', async () => {
    db.reservations.findByListings.mockResolvedValueOnce([
      { id: 1, listing_id: 1, status: 'confirmed', total_price: 20000, check_in: `${THIS_MONTH}-05`, check_out: `${THIS_MONTH}-09` },
      { id: 2, listing_id: 1, status: 'confirmed', total_price: 5000,  check_in: '2000-01-10', check_out: '2000-01-12' },
    ]);
    const res = await dash();
    const months = Object.keys(res.body.revenue.monthly);
    expect(months).toHaveLength(12);
    expect(months[11]).toBe(THIS_MONTH);
    expect(res.body.revenue.monthly[THIS_MONTH]).toBe(20000);
    // Une réservation hors fenêtre compte dans le total mais pas dans le détail mensuel
    expect(res.body.revenue.total).toBe(25000);
    expect(months).not.toContain('2000-01');
  });

  test('note moyenne arrondie à une décimale', async () => {
    db.reviews.findByListings.mockResolvedValueOnce([{ rating: 5 }, { rating: 4 }, { rating: 4 }]);
    const res = await dash();
    expect(res.body.avg_rating).toBe(4.3);
    expect(res.body.reviews_count).toBe(3);
  });

  test('hôte sans annonce : zéros et aucune annonce en tête', async () => {
    db.listings.findByHost.mockResolvedValueOnce([]);
    const res = await dash();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ listings_count: 0, occupancy_rate: 0, booked_nights: 0, avg_rating: 0, top_listing: null });
    expect(db.reservations.findByListings).toHaveBeenCalledWith([]);
  });
});
