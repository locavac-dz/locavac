const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({
  mailReservationCreated:   jest.fn(),
  mailNewReservationToHost: jest.fn(),
  mailReservationConfirmed: jest.fn(),
  mailReservationCancelled: jest.fn(),
}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app    = require('../../server/index');
const db     = require('../mocks/db');
const mailer = require('../../server/mailer');
const ws     = require('../../server/ws');

// LISTING_1 : hôte id=1, 5 000 DZD/nuit, 2 voyageurs max. Voyageur : id=99 ; RESERVATION_2 (301) appartient à id=2.
const auth = (id, extra = {}) => ({ Authorization: `Bearer ${jwt.sign({ id, email: `u${id}@test.dz`, ...extra }, process.env.JWT_SECRET)}` });
const GUEST = auth(99);
const HOST  = auth(1, { is_host: true });

// Date AAAA-MM-JJ décalée de n jours par rapport à aujourd'hui (UTC, comme le serveur)
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Client de transaction simulé, consommé par pool.connect() au prochain appel
function mockClient({ conflict = false, failOn = null } = {}) {
  const client = {
    query: jest.fn((sql, params) => {
      if (failOn && failOn.test(sql)) return Promise.reject(new Error('boom'));
      if (/INSERT INTO reservations/.test(sql))
        return Promise.resolve({ rows: [{ id: 321, listing_id: params[0], guest_id: params[1], check_in: params[2], check_out: params[3], total_price: params[5], status: 'pending' }] });
      if (/SELECT id FROM reservations/.test(sql))
        return Promise.resolve({ rows: conflict ? [{ id: 5 }] : [] });
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  db.pool.connect.mockResolvedValueOnce(client);
  return client;
}
const sqls = client => client.query.mock.calls.map(c => c[0]);
const book = (body, headers = GUEST) => request(app).post('/api/reservations').set(headers).send(body);
const STAY = () => ({ listing_id: 1, check_in: day(30), check_out: day(34) });

afterEach(() => jest.clearAllMocks());

describe('POST /api/reservations — création', () => {
  test('201 : total = prix × nuits en DZD, statut pending', async () => {
    mockClient();
    const res = await book(STAY());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 321, total_price: 20000, nights: 4, status: 'pending' });
  });

  test('le total est calculé côté serveur, le prix envoyé par le client est ignoré', async () => {
    const client = mockClient();
    await book({ ...STAY(), total_price: 1, price: 1 });
    const insert = client.query.mock.calls.find(c => /INSERT INTO reservations/.test(c[0]));
    expect(insert[1][5]).toBe(20000);
  });

  test('transaction : BEGIN → verrou consultatif du logement → contrôle de conflit → INSERT → COMMIT', async () => {
    const client = mockClient();
    const s = STAY();
    await book(s);
    const q = sqls(client);
    expect(q[0]).toBe('BEGIN');
    expect(q[1]).toMatch(/pg_advisory_xact_lock/);
    expect(client.query.mock.calls[1][1]).toEqual([1]);
    expect(q[2]).toMatch(/SELECT id FROM reservations/);
    expect(client.query.mock.calls[2][1]).toEqual([1, s.check_out, s.check_in]);
    expect(q[3]).toMatch(/INSERT INTO reservations/);
    expect(client.query.mock.calls[3][1]).toEqual([1, 99, s.check_in, s.check_out, 1, 20000]);
    expect(q[4]).toBe('COMMIT');
    expect(q).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('le contrôle de conflit ignore les réservations annulées', async () => {
    const client = mockClient();
    await book(STAY());
    expect(client.query.mock.calls[2][0]).toMatch(/status != 'cancelled'/);
  });

  test('e-mails voyageur et hôte + notification WebSocket temps réel à l\'hôte', async () => {
    mockClient();
    const s = STAY();
    await book(s);
    expect(mailer.mailReservationCreated).toHaveBeenCalledWith(expect.objectContaining({
      guestEmail: 'guest@test.dz', listingTitle: 'Villa de test', total: 20000, nights: 4,
    }));
    expect(mailer.mailNewReservationToHost).toHaveBeenCalledWith(expect.objectContaining({
      hostEmail: 'host@test.dz', guestName: 'Guest Test', total: 20000, nights: 4,
    }));
    expect(ws.send).toHaveBeenCalledWith(1, expect.objectContaining({
      type: 'new_reservation', guest_name: 'Guest Test', listing_title: 'Villa de test', check_in: s.check_in, nights: 4,
    }));
  });

  test('guests_count fourni en chaîne, dans la capacité, transmis à l\'INSERT', async () => {
    const client = mockClient();
    await book({ ...STAY(), guests_count: '2' });
    const insert = client.query.mock.calls.find(c => /INSERT INTO reservations/.test(c[0]));
    expect(insert[1][4]).toBe(2);
  });

  test('arrivée aujourd\'hui autorisée', async () => {
    mockClient();
    const res = await book({ listing_id: 1, check_in: day(0), check_out: day(2) });
    expect(res.status).toBe(201);
  });

  test('séjour de 1 nuit (départ = arrivée + 1 jour)', async () => {
    mockClient();
    const res = await book({ listing_id: 1, check_in: day(10), check_out: day(11) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nights: 1, total_price: 5000 });
  });
});

describe('POST /api/reservations — refus', () => {
  test('400 si l\'arrivée est hier', async () => {
    const res = await book({ listing_id: 1, check_in: day(-1), check_out: day(3) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/passé/i);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('400 si l\'hôte réserve son propre logement', async () => {
    const res = await book(STAY(), HOST);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/propre logement/i);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('404 si le logement n\'existe pas', async () => {
    const res = await book({ ...STAY(), listing_id: 9999 });
    expect(res.status).toBe(404);
  });

  test('404 si le logement est indisponible', async () => {
    db.listings.findById.mockResolvedValueOnce({ id: 1, host_id: 1, price: 5000, guests: 2, available: false });
    const res = await book(STAY());
    expect(res.status).toBe(404);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test.each([1.5, -2, 'abc'])('400 pour guests_count = %p', async guests_count => {
    const res = await book({ ...STAY(), guests_count });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/voyageur/i);
  });

  test('409 si les dates chevauchent une plage bloquée par l\'hôte (aucune transaction ouverte)', async () => {
    db.listings.findById.mockResolvedValueOnce({
      id: 1, host_id: 1, price: 5000, guests: 2, available: true,
      blocked_ranges: [{ start: day(31), end: day(33) }],
    });
    const res = await book(STAY());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/bloqué/i);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('plages bloquées stockées en JSON (chaîne) correctement interprétées', async () => {
    db.listings.findById.mockResolvedValueOnce({
      id: 1, host_id: 1, price: 5000, guests: 2, available: true,
      blocked_ranges: JSON.stringify([{ start: day(31), end: day(33) }]),
    });
    const res = await book(STAY());
    expect(res.status).toBe(409);
  });

  test('plage bloquée qui se termine le jour d\'arrivée : pas de conflit (bornes exclusives)', async () => {
    mockClient();
    db.listings.findById.mockResolvedValueOnce({
      id: 1, host_id: 1, price: 5000, guests: 2, available: true,
      blocked_ranges: [{ start: day(26), end: day(30) }],
    });
    const res = await book(STAY());
    expect(res.status).toBe(201);
  });

  test('409 si une réservation existante chevauche : ROLLBACK, aucun INSERT, aucun e-mail', async () => {
    const client = mockClient({ conflict: true });
    const res = await book(STAY());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/pas disponible/i);
    const q = sqls(client);
    expect(q).toContain('ROLLBACK');
    expect(q).not.toContain('COMMIT');
    expect(q.some(s => /INSERT INTO reservations/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(mailer.mailReservationCreated).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  test('500 si l\'INSERT échoue : ROLLBACK, connexion libérée, aucun e-mail', async () => {
    const client = mockClient({ failOn: /INSERT INTO reservations/ });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await book(STAY());
    spy.mockRestore();
    expect(res.status).toBe(500);
    const q = sqls(client);
    expect(q).toContain('ROLLBACK');
    expect(q).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(mailer.mailReservationCreated).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/reservations/:id/status — confirmation et notifications', () => {
  const patch = (id, status, headers) => request(app).patch(`/api/reservations/${id}/status`).set(headers).send({ status });

  test('l\'hôte confirme une réservation payée : 200, e-mail au voyageur, WebSocket au voyageur', async () => {
    db.payments.findSuccessByReservation.mockResolvedValueOnce({ id: 600 });
    const res = await patch(301, 'confirmed', HOST);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'confirmed', refund: null });
    expect(db.reservations.updateById).toHaveBeenCalledWith(301, { status: 'confirmed' });
    expect(mailer.mailReservationConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      guestEmail: 'guest@test.dz', hostName: 'Hôte Test', listingTitle: 'Villa de test',
    }));
    expect(ws.send).toHaveBeenCalledWith(2, expect.objectContaining({ type: 'reservation_status_changed', status: 'confirmed', reservation_id: 301 }));
  });

  test('402 sans paiement valide : aucune écriture', async () => {
    const res = await patch(301, 'confirmed', HOST);
    expect(res.status).toBe(402);
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test('403 pour un tiers (ni voyageur ni hôte)', async () => {
    const res = await patch(301, 'cancelled', GUEST);
    expect(res.status).toBe(403);
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test('le voyageur annule : e-mails au voyageur ET à l\'hôte, pas de WebSocket vers lui-même', async () => {
    const res = await patch(301, 'cancelled', auth(2));
    expect(res.status).toBe(200);
    expect(mailer.mailReservationCancelled).toHaveBeenCalledTimes(2);
    const recipients = mailer.mailReservationCancelled.mock.calls.map(c => c[0].to).sort();
    expect(recipients).toEqual(['guest@test.dz', 'host@test.dz']);
    expect(ws.send).not.toHaveBeenCalled();
  });

  test('l\'hôte annule : e-mail au voyageur seul, WebSocket au voyageur', async () => {
    const res = await patch(301, 'cancelled', HOST);
    expect(res.status).toBe(200);
    expect(mailer.mailReservationCancelled).toHaveBeenCalledTimes(1);
    expect(mailer.mailReservationCancelled.mock.calls[0][0].to).toBe('guest@test.dz');
    expect(ws.send).toHaveBeenCalledWith(2, expect.objectContaining({ status: 'cancelled' }));
  });

  test('réservation déjà annulée : 409, ni remboursement recalculé, ni écriture, ni e-mail en double', async () => {
    db.reservations.findById.mockResolvedValueOnce({
      id: 301, listing_id: 1, guest_id: 2, check_in: day(20), check_out: day(25),
      total_price: 25000, status: 'cancelled', payment_id: 600,
    });
    const res = await patch(301, 'cancelled', auth(2));
    expect(res.status).toBe(409);
    expect(db.reservations.updateById).not.toHaveBeenCalled();
    expect(db.payments.updateById).not.toHaveBeenCalled();
    expect(mailer.mailReservationCancelled).not.toHaveBeenCalled();
  });

  test('confirmer une réservation annulée est refusé même avec un ancien paiement réussi (dates peut-être relouées)', async () => {
    db.reservations.findById.mockResolvedValueOnce({ id: 301, listing_id: 1, guest_id: 2, check_in: day(20), check_out: day(25), total_price: 25000, status: 'cancelled' });
    db.payments.findSuccessByReservation.mockResolvedValueOnce({ id: 600 });
    const res = await patch(301, 'confirmed', HOST);
    expect(res.status).toBe(409);
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test('un séjour terminé ne peut plus être annulé, ni par le voyageur ni par l\'hôte', async () => {
    const finished = { id: 301, listing_id: 1, guest_id: 2, check_in: day(-10), check_out: day(-5), total_price: 25000, status: 'confirmed', payment_id: 600 };
    for (const who of [auth(2), HOST]) {
      db.reservations.findById.mockResolvedValueOnce(finished);
      const res = await patch(301, 'cancelled', who);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/terminé/i);
    }
    expect(db.reservations.updateById).not.toHaveBeenCalled();
    expect(db.payments.updateById).not.toHaveBeenCalled();
  });

  test('un séjour qui se termine aujourd\'hui reste annulable', async () => {
    db.reservations.findById.mockResolvedValueOnce({ id: 301, listing_id: 1, guest_id: 2, check_in: day(-3), check_out: day(0), total_price: 25000, status: 'confirmed' });
    const res = await patch(301, 'cancelled', auth(2));
    expect(res.status).toBe(200);
  });
});

describe('Annulation par l\'hôte — le voyageur est remboursé intégralement', () => {
  const hostCancels = async (policy, checkInInDays) => {
    db.reservations.findById.mockResolvedValueOnce({
      id: 301, listing_id: 1, guest_id: 2, check_in: day(checkInInDays), check_out: day(checkInInDays + 4),
      total_price: 20000, status: 'confirmed', payment_id: 600,
    });
    db.listings.findById.mockResolvedValueOnce({ id: 1, host_id: 1, title: 'Villa de test', cancellation_policy: policy });
    return request(app).patch('/api/reservations/301/status').set(HOST).send({ status: 'cancelled' });
  };

  test.each([['stricte', 2], ['stricte', 30], ['moderee', 1], ['flexible', 0]])(
    'politique %s à J-%i : 100 %% remboursés quand c\'est l\'hôte qui annule', async (policy, days) => {
      const res = await hostCancels(policy, days);
      expect(res.status).toBe(200);
      expect(res.body.refund).toMatchObject({ pct: 100, amount: 20000, cancelled_by: 'host' });
      expect(db.payments.updateById).toHaveBeenCalledWith(600, { status: 'refunded', refund_amount: 20000, refund_pct: 100 });
    });

  test('la même annulation par le voyageur (stricte, J-2) ne rembourse rien', async () => {
    db.reservations.findById.mockResolvedValueOnce({ id: 301, listing_id: 1, guest_id: 2, check_in: day(2), check_out: day(6), total_price: 20000, status: 'confirmed', payment_id: 600 });
    db.listings.findById.mockResolvedValueOnce({ id: 1, host_id: 1, title: 'Villa de test', cancellation_policy: 'stricte' });
    const res = await request(app).patch('/api/reservations/301/status').set(auth(2)).send({ status: 'cancelled' });
    expect(res.body.refund).toMatchObject({ pct: 0, amount: 0, cancelled_by: 'guest' });
    expect(db.payments.updateById).not.toHaveBeenCalled();
  });
});

describe('POST /api/reservations — bornes anti-blocage de calendrier', () => {
  test('séjour de 90 nuits accepté, 91 nuits refusé', async () => {
    mockClient();
    expect((await book({ listing_id: 1, check_in: day(10), check_out: day(100) })).status).toBe(201);
    const res = await book({ listing_id: 1, check_in: day(10), check_out: day(101) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/90 nuits/);
  });

  test('réservation à plus de 730 jours refusée, aucune transaction ouverte', async () => {
    const res = await book({ listing_id: 1, check_in: day(731), check_out: day(735) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/730 jours/);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('réservation à exactement 730 jours acceptée', async () => {
    mockClient();
    expect((await book({ listing_id: 1, check_in: day(730), check_out: day(733) })).status).toBe(201);
  });
});

describe('Annulation — politiques de remboursement (intégration)', () => {
  const cancelWith = async (policy, checkInInDays, total = 20000) => {
    db.reservations.findById.mockResolvedValueOnce({
      id: 301, listing_id: 1, guest_id: 2, check_in: day(checkInInDays), check_out: day(checkInInDays + 4),
      total_price: total, status: 'confirmed', payment_id: 600,
    });
    db.listings.findById.mockResolvedValueOnce({ id: 1, host_id: 1, title: 'Villa de test', cancellation_policy: policy });
    return request(app).patch('/api/reservations/301/status').set(auth(2)).send({ status: 'cancelled' });
  };

  test('modérée à 3 jours : 50 % remboursés, paiement en partial_refund', async () => {
    const res = await cancelWith('moderee', 3);
    expect(res.status).toBe(200);
    expect(res.body.refund).toMatchObject({ pct: 50, amount: 10000 });
    expect(db.payments.updateById).toHaveBeenCalledWith(600, { status: 'partial_refund', refund_amount: 10000, refund_pct: 50 });
  });

  test('modérée à 10 jours : 100 % remboursés (refunded)', async () => {
    const res = await cancelWith('moderee', 10);
    expect(res.body.refund).toMatchObject({ pct: 100, amount: 20000 });
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({ status: 'refunded' }));
  });

  test('stricte à 10 jours : 50 % remboursés', async () => {
    const res = await cancelWith('stricte', 10);
    expect(res.body.refund).toMatchObject({ pct: 50, amount: 10000 });
  });

  test('stricte à 4 jours : aucun remboursement, le paiement n\'est pas modifié', async () => {
    const res = await cancelWith('stricte', 4);
    expect(res.status).toBe(200);
    expect(res.body.refund).toMatchObject({ pct: 0, amount: 0 });
    expect(db.payments.updateById).not.toHaveBeenCalled();
  });

  test('montant remboursé arrondi au dinar', async () => {
    const res = await cancelWith('moderee', 3, 12345);
    expect(res.body.refund.amount).toBe(6173);
  });

  test('annonce sans politique explicite : flexible par défaut', async () => {
    const res = await cancelWith(undefined, 5);
    expect(res.body.refund.pct).toBe(100);
  });
});
