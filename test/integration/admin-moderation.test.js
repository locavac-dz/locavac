const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

// id=98 est le seul admin dans le mock
const ADMIN_AUTH = { Authorization: `Bearer ${jwt.sign({ id: 98, email: 'admin@test.dz', is_admin: true }, process.env.JWT_SECRET)}` };
const USER_AUTH  = { Authorization: `Bearer ${jwt.sign({ id: 2,  email: 'guest@test.dz' }, process.env.JWT_SECRET)}` };

// Le middleware auth consomme un premier pool.query ; la requête SQL de la route vient ensuite
const AUTH_ROW = { rows: [{ id: 98, banned: false }] };

afterEach(() => jest.clearAllMocks());

describe('DELETE /api/admin/users/:id — anonymisation RGPD', () => {
  test('403 pour non-admin', async () => {
    const res = await request(app).delete('/api/admin/users/2').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('400 si l\'admin cible son propre compte', async () => {
    const res = await request(app).delete('/api/admin/users/98').set(ADMIN_AUTH);
    expect(res.status).toBe(400);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('404 si utilisateur introuvable', async () => {
    const res = await request(app).delete('/api/admin/users/9999').set(ADMIN_AUTH);
    expect(res.status).toBe(404);
  });

  test('200 : annonces désactivées, messages supprimés, compte pseudonymisé et banni', async () => {
    const res = await request(app).delete('/api/admin/users/2').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(db.listings.setAvailableByHost).toHaveBeenCalledWith(2, false);
    expect(db.messages.deleteByUser).toHaveBeenCalledWith(2);
    const [uid, changes] = db.users.updateById.mock.calls[0];
    expect(uid).toBe(2);
    expect(changes).toMatchObject({
      name: 'Utilisateur supprimé', email: 'deleted_2@locavac.dz', phone: null, password: '',
      is_host: false, is_admin: false, banned: true,
    });
  });
});

describe('PATCH /api/admin/listings/:id', () => {
  test('403 pour non-admin', async () => {
    const res = await request(app).patch('/api/admin/listings/1').set(USER_AUTH).send({ available: false });
    expect(res.status).toBe(403);
  });

  test('404 si annonce introuvable', async () => {
    const res = await request(app).patch('/api/admin/listings/9999').set(ADMIN_AUTH).send({ available: false });
    expect(res.status).toBe(404);
  });

  test('200 et désactive l\'annonce (coercition booléenne)', async () => {
    const res = await request(app).patch('/api/admin/listings/1').set(ADMIN_AUTH).send({ available: 0 });
    expect(res.status).toBe(200);
    expect(db.listings.updateById).toHaveBeenCalledWith(1, { available: false });
  });

  test('200 sans écriture si available absent', async () => {
    const res = await request(app).patch('/api/admin/listings/1').set(ADMIN_AUTH).send({});
    expect(res.status).toBe(200);
    expect(db.listings.updateById).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/listings/:id', () => {
  test('403 pour non-admin', async () => {
    const res = await request(app).delete('/api/admin/listings/1').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('404 si annonce introuvable', async () => {
    const res = await request(app).delete('/api/admin/listings/9999').set(ADMIN_AUTH);
    expect(res.status).toBe(404);
    expect(db.listings.deleteById).not.toHaveBeenCalled();
  });

  test('200 : annonce, réservations et avis associés supprimés', async () => {
    const res = await request(app).delete('/api/admin/listings/1').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(db.listings.deleteById).toHaveBeenCalledWith(1);
    expect(db.reservations.deleteByListing).toHaveBeenCalledWith(1);
    expect(db.reviews.deleteByListing).toHaveBeenCalledWith(1);
  });
});

describe('GET /api/admin/reservations', () => {
  test('403 pour non-admin', async () => {
    const res = await request(app).get('/api/admin/reservations').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('200 tableau vide par défaut, filtre statut null', async () => {
    const res = await request(app).get('/api/admin/reservations').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(db.pool.query.mock.calls[1][1]).toEqual([null]);
  });

  test('200 avec filtre ?status et lignes jointes', async () => {
    db.pool.query
      .mockResolvedValueOnce(AUTH_ROW)
      .mockResolvedValueOnce({ rows: [{ id: 300, status: 'confirmed', listing_title: 'Villa de test', guest_name: 'Guest Test' }] });
    const res = await request(app).get('/api/admin/reservations?status=confirmed').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].listing_title).toBe('Villa de test');
    expect(db.pool.query.mock.calls[1][1]).toEqual(['confirmed']);
  });
});

describe('GET /api/admin/signalements', () => {
  test('403 pour non-admin', async () => {
    const res = await request(app).get('/api/admin/signalements').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('200 tableau sans filtre', async () => {
    const res = await request(app).get('/api/admin/signalements').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(db.pool.query.mock.calls[1][0]).not.toMatch(/WHERE s\.status/);
  });

  test('200 avec filtre ?status paramétré (pas d\'interpolation)', async () => {
    db.pool.query
      .mockResolvedValueOnce(AUTH_ROW)
      .mockResolvedValueOnce({ rows: [{ id: 800, status: 'pending', listing_title: 'Villa de test' }] });
    const res = await request(app).get('/api/admin/signalements?status=pending').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const [sql, params] = db.pool.query.mock.calls[1];
    expect(sql).toMatch(/WHERE s\.status = \$1/);
    expect(params).toEqual(['pending']);
  });
});

describe('PATCH /api/admin/signalements/:id/resolve', () => {
  test('403 pour non-admin', async () => {
    const res = await request(app).patch('/api/admin/signalements/5/resolve').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('404 si signalement introuvable', async () => {
    const res = await request(app).patch('/api/admin/signalements/5/resolve').set(ADMIN_AUTH);
    expect(res.status).toBe(404);
  });

  test('200 quand la ligne est mise à jour', async () => {
    db.pool.query.mockResolvedValueOnce(AUTH_ROW).mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await request(app).patch('/api/admin/signalements/5/resolve').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const [sql, params] = db.pool.query.mock.calls[1];
    expect(sql).toMatch(/status='resolved'/);
    expect(params).toEqual(['5']);
  });
});

describe('DELETE /api/admin/signalements/:id', () => {
  test('403 pour non-admin', async () => {
    const res = await request(app).delete('/api/admin/signalements/5').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('200 et exécute le DELETE paramétré', async () => {
    const res = await request(app).delete('/api/admin/signalements/5').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    const del = db.pool.query.mock.calls.find(c => /DELETE FROM signalements/.test(c[0]));
    expect(del[1]).toEqual(['5']);
  });
});

describe('POST /api/admin/reservations/:id/rembourser', () => {
  test('403 pour non-admin', async () => {
    const res = await request(app).post('/api/admin/reservations/300/rembourser').set(USER_AUTH);
    expect(res.status).toBe(403);
  });

  test('404 si réservation introuvable', async () => {
    const res = await request(app).post('/api/admin/reservations/9999/rembourser').set(ADMIN_AUTH);
    expect(res.status).toBe(404);
  });

  test('400 si déjà annulée', async () => {
    db.reservations.findById.mockResolvedValueOnce({ id: 300, status: 'cancelled', payment_id: null });
    const res = await request(app).post('/api/admin/reservations/300/rembourser').set(ADMIN_AUTH);
    expect(res.status).toBe(400);
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test('200 : réservation annulée, aucun paiement à rembourser', async () => {
    const res = await request(app).post('/api/admin/reservations/300/rembourser').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(db.reservations.updateById).toHaveBeenCalledWith(300, { status: 'cancelled' });
    expect(db.payments.updateById).not.toHaveBeenCalled();
  });

  test('200 : paiement lié passé en refunded', async () => {
    db.reservations.findById.mockResolvedValueOnce({ id: 300, status: 'confirmed', payment_id: 600 });
    const res = await request(app).post('/api/admin/reservations/300/rembourser').set(ADMIN_AUTH);
    expect(res.status).toBe(200);
    expect(db.payments.updateById).toHaveBeenCalledWith(600, { status: 'refunded' });
  });
});
