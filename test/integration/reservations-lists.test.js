const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const GUEST_AUTH = { Authorization: `Bearer ${jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET)}` };
const HOST_AUTH  = { Authorization: `Bearer ${jwt.sign({ id: 1, email: 'host@test.dz' },  process.env.JWT_SECRET)}` };

// Séjour confirmé et terminé (avis possible) + séjour futur en attente
const PAST_STAY   = { id: 300, listing_id: 1, guest_id: 2, check_in: '2026-06-01', check_out: '2026-06-05', status: 'confirmed', created_at: '2026-05-01' };
const FUTURE_STAY = { id: 301, listing_id: 1, guest_id: 2, check_in: '2027-03-10', check_out: '2027-03-15', status: 'pending',   created_at: '2026-08-01' };

afterEach(() => jest.clearAllMocks());

describe('GET /api/reservations/mine', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/reservations/mine');
    expect(res.status).toBe(401);
  });

  test('200 vide avec pagination par défaut', async () => {
    const res = await request(app).get('/api/reservations/mine').set(GUEST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
    expect(db.reservations.findByGuest).toHaveBeenCalledWith(2);
  });

  test('200 enrichi : titre, politique d\'annulation, can_review après le départ uniquement', async () => {
    db.reservations.findByGuest.mockResolvedValueOnce([PAST_STAY, FUTURE_STAY]);
    const res = await request(app).get('/api/reservations/mine').set(GUEST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    // Tri du plus récent au plus ancien (created_at)
    expect(res.body.data.map(r => r.id)).toEqual([301, 300]);
    const past   = res.body.data.find(r => r.id === 300);
    const future = res.body.data.find(r => r.id === 301);
    expect(past).toMatchObject({ title: 'Villa de test', price_per_night: 5000, cancellation_policy: 'flexible', can_review: true });
    expect(future.can_review).toBe(false);
  });

  test('can_review false si un avis existe déjà pour l\'annonce', async () => {
    db.reservations.findByGuest.mockResolvedValueOnce([PAST_STAY]);
    db.reviews.reviewedListingIds.mockResolvedValueOnce(new Set([1]));
    const res = await request(app).get('/api/reservations/mine').set(GUEST_AUTH);
    expect(res.body.data[0].can_review).toBe(false);
  });

  test('pagination : ?page=2&limit=1 retourne le second élément', async () => {
    db.reservations.findByGuest.mockResolvedValueOnce([PAST_STAY, FUTURE_STAY]);
    const res = await request(app).get('/api/reservations/mine?page=2&limit=1').set(GUEST_AUTH);
    expect(res.body.pagination).toEqual({ page: 2, limit: 1, total: 2, pages: 2 });
    expect(res.body.data.map(r => r.id)).toEqual([300]);
  });

  test('limit plafonné à 200 et page invalide ramenée à 1', async () => {
    const res = await request(app).get('/api/reservations/mine?page=abc&limit=999').set(GUEST_AUTH);
    expect(res.body.pagination.limit).toBe(200);
    expect(res.body.pagination.page).toBe(1);
  });
});

describe('GET /api/reservations/hosting', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/reservations/hosting');
    expect(res.status).toBe(401);
  });

  test('200 vide : cherche les réservations des annonces de l\'hôte', async () => {
    const res = await request(app).get('/api/reservations/hosting').set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(db.listings.findByHost).toHaveBeenCalledWith(1);
    expect(db.reservations.findByListings).toHaveBeenCalledWith([1]);
  });

  test('200 enrichi avec annonce et voyageur (batch, un seul appel users.findByIds)', async () => {
    db.reservations.findByListings.mockResolvedValueOnce([PAST_STAY, FUTURE_STAY]);
    const res = await request(app).get('/api/reservations/hosting').set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ title: 'Villa de test', location: 'Alger', guest_name: 'Guest Test', guest_email: 'guest@test.dz' });
    expect(db.users.findByIds).toHaveBeenCalledTimes(1);
    expect(db.users.findByIds).toHaveBeenCalledWith([2]);
  });
});
