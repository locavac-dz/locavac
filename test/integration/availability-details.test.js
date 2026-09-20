const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const HOST = { Authorization: `Bearer ${jwt.sign({ id: 1, email: 'host@test.dz' }, process.env.JWT_SECRET)}` };
const BASE_LISTING = { id: 1, host_id: 1, blocked_ranges: [] };

afterEach(() => jest.clearAllMocks());

describe('GET /api/availability/:listing_id — contenu', () => {
  test('réservations actives et plages bloquées fusionnées, réservations annulées exclues', async () => {
    db.reservations.findByListing.mockResolvedValueOnce([
      { check_in: '2027-06-01', check_out: '2027-06-05', status: 'confirmed' },
      { check_in: '2027-07-01', check_out: '2027-07-03', status: 'pending' },
      { check_in: '2027-08-01', check_out: '2027-08-09', status: 'cancelled' },
    ]);
    db.listings.findById.mockResolvedValueOnce({ ...BASE_LISTING, blocked_ranges: [{ start: '2027-09-01', end: '2027-09-10', reason: 'Travaux' }, { start: '2027-10-01', end: '2027-10-02' }] });
    const res = await request(app).get('/api/availability/1');
    expect(res.status).toBe(200);
    expect(res.body.unavailable).toEqual([
      { start: '2027-06-01', end: '2027-06-05', type: 'reserved', status: 'confirmed' },
      { start: '2027-07-01', end: '2027-07-03', type: 'reserved', status: 'pending' },
      { start: '2027-09-01', end: '2027-09-10', type: 'blocked', reason: 'Travaux' },
      { start: '2027-10-01', end: '2027-10-02', type: 'blocked', reason: '' },
    ]);
  });

  test('annonce sans plage bloquée (blocked_ranges absent) : pas de crash', async () => {
    db.listings.findById.mockResolvedValueOnce({ id: 1, host_id: 1 });
    const res = await request(app).get('/api/availability/1');
    expect(res.status).toBe(200);
    expect(res.body.unavailable).toEqual([]);
  });

  test('route publique : aucun token requis', async () => {
    const res = await request(app).get('/api/availability/1');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/availability/:listing_id/block — ajout', () => {
  const block = body => request(app).post('/api/availability/1/block').set(HOST).send(body);

  test('la nouvelle plage s\'ajoute aux plages existantes (sérialisée en JSON)', async () => {
    const existing = { start: '2027-01-01', end: '2027-01-05', reason: 'Vacances' };
    db.listings.findById.mockResolvedValueOnce({ ...BASE_LISTING, blocked_ranges: [existing] });
    const res = await block({ start: '2027-06-01', end: '2027-06-10', reason: 'Entretien' });
    expect(res.status).toBe(201);
    const expected = [existing, { start: '2027-06-01', end: '2027-06-10', reason: 'Entretien' }];
    expect(res.body.blocked_ranges).toEqual(expected);
    expect(db.listings.updateById).toHaveBeenCalledWith(1, { blocked_ranges: JSON.stringify(expected) });
  });

  test('raison facultative : enregistrée comme chaîne vide', async () => {
    const res = await block({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.body.blocked_ranges[0].reason).toBe('');
  });

  test('400 si la raison dépasse 200 caractères, 200 accepté', async () => {
    const tooLong = await block({ start: '2027-06-01', end: '2027-06-10', reason: 'x'.repeat(201) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/200/);
    expect(db.listings.updateById).not.toHaveBeenCalled();
    const ok = await block({ start: '2027-06-01', end: '2027-06-10', reason: 'x'.repeat(200) });
    expect(ok.status).toBe(201);
  });

  test('blocage d\'exactement 365 jours accepté', async () => {
    const res = await block({ start: '2027-01-01', end: '2028-01-01' });
    expect(res.status).toBe(201);
  });

  test('404 si l\'annonce n\'existe pas', async () => {
    const res = await request(app).post('/api/availability/9999/block').set(HOST).send({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/availability/:listing_id/block — retrait', () => {
  const unblock = body => request(app).delete('/api/availability/1/block').set(HOST).send(body);

  test('retire uniquement la plage dont début ET fin correspondent', async () => {
    const a = { start: '2027-01-01', end: '2027-01-05', reason: '' };
    const b = { start: '2027-06-01', end: '2027-06-10', reason: '' };
    const c = { start: '2027-06-01', end: '2027-06-20', reason: '' };
    db.listings.findById.mockResolvedValueOnce({ ...BASE_LISTING, blocked_ranges: [a, b, c] });
    const res = await unblock({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.status).toBe(200);
    expect(res.body.blocked_ranges).toEqual([a, c]);
    expect(db.listings.updateById).toHaveBeenCalledWith(1, { blocked_ranges: JSON.stringify([a, c]) });
  });

  test('404 si l\'annonce n\'existe pas', async () => {
    const res = await request(app).delete('/api/availability/9999/block').set(HOST).send({ start: '2027-06-01', end: '2027-06-10' });
    expect(res.status).toBe(404);
  });
});
