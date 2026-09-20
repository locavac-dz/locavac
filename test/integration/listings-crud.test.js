const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

// id=1 est l'hôte propriétaire de LISTING_1 ; id=2 est un simple voyageur
const HOST_AUTH  = { Authorization: `Bearer ${jwt.sign({ id: 1, email: 'host@test.dz' },  process.env.JWT_SECRET)}` };
const GUEST_AUTH = { Authorization: `Bearer ${jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET)}` };

afterEach(() => jest.clearAllMocks());

describe('GET /api/listings/:id', () => {
  test('404 si annonce introuvable', async () => {
    const res = await request(app).get('/api/listings/9999');
    expect(res.status).toBe(404);
  });

  test('200 avec données hôte et avis', async () => {
    const res = await request(app).get('/api/listings/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.host_name).toBe('Hôte Test');
    expect(Array.isArray(res.body.reviews)).toBe(true);
    expect(res.headers['cache-control']).toMatch(/max-age=60/);
  });

  test('incrémente le compteur de vues', async () => {
    await request(app).get('/api/listings/1');
    expect(db.listings.incrementViews).toHaveBeenCalledWith(1);
  });
});

describe('PUT /api/listings/:id', () => {
  test('401 sans token', async () => {
    const res = await request(app).put('/api/listings/1').send({ price: 6000 });
    expect(res.status).toBe(401);
  });

  test('404 si annonce introuvable', async () => {
    const res = await request(app).put('/api/listings/9999').set(HOST_AUTH).send({ price: 6000 });
    expect(res.status).toBe(404);
  });

  test('403 si l\'utilisateur n\'est pas le propriétaire', async () => {
    const res = await request(app).put('/api/listings/1').set(GUEST_AUTH).send({ price: 6000 });
    expect(res.status).toBe(403);
    expect(db.listings.updateById).not.toHaveBeenCalled();
  });

  test('400 si titre trop court', async () => {
    const res = await request(app).put('/api/listings/1').set(HOST_AUTH).send({ title: 'Ab' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/titre/i);
  });

  test('400 si prix hors bornes', async () => {
    const res = await request(app).put('/api/listings/1').set(HOST_AUTH).send({ price: 5_000_000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prix/i);
  });

  test('200 et ne persiste que les champs valides (politique inconnue ignorée)', async () => {
    const res = await request(app).put('/api/listings/1').set(HOST_AUTH)
      .send({ price: 6000, cancellation_policy: 'gratuite' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(db.listings.updateById).toHaveBeenCalledWith(1, { price: 6000 });
  });

  test('200 avec politique d\'annulation valide', async () => {
    const res = await request(app).put('/api/listings/1').set(HOST_AUTH)
      .send({ cancellation_policy: 'stricte', title: '  Villa rénovée  ' });
    expect(res.status).toBe(200);
    expect(db.listings.updateById).toHaveBeenCalledWith(1, { cancellation_policy: 'stricte', title: 'Villa rénovée' });
  });
});

describe('DELETE /api/listings/:id', () => {
  test('401 sans token', async () => {
    const res = await request(app).delete('/api/listings/1');
    expect(res.status).toBe(401);
  });

  test('404 si annonce introuvable', async () => {
    const res = await request(app).delete('/api/listings/9999').set(HOST_AUTH);
    expect(res.status).toBe(404);
  });

  test('403 si l\'utilisateur n\'est pas le propriétaire', async () => {
    const res = await request(app).delete('/api/listings/1').set(GUEST_AUTH);
    expect(res.status).toBe(403);
    expect(db.listings.deleteById).not.toHaveBeenCalled();
  });

  test('200 pour le propriétaire', async () => {
    const res = await request(app).delete('/api/listings/1').set(HOST_AUTH);
    expect(res.status).toBe(200);
    expect(db.listings.deleteById).toHaveBeenCalledWith(1);
  });
});

describe('POST /api/listings/:id/signaler', () => {
  test('400 si motif manquant', async () => {
    const res = await request(app).post('/api/listings/1/signaler').send({ message: 'Sans motif' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/motif/i);
  });

  test('200 en anonyme — user_id null', async () => {
    const res = await request(app).post('/api/listings/1/signaler').send({ motif: 'contenu_inapproprie' });
    expect(res.status).toBe(200);
    const insert = db.pool.query.mock.calls.find(c => /INSERT INTO signalements/.test(c[0]));
    expect(insert).toBeDefined();
    expect(insert[1]).toEqual(['1', null, 'contenu_inapproprie', null]);
  });
});

describe('POST /api/listings/:id/photos', () => {
  test('401 sans token', async () => {
    const res = await request(app).post('/api/listings/1/photos').send({ url: '/uploads/a.jpg' });
    expect(res.status).toBe(401);
  });

  test('403 si l\'utilisateur n\'est pas le propriétaire', async () => {
    const res = await request(app).post('/api/listings/1/photos').set(GUEST_AUTH).send({ url: '/uploads/a.jpg' });
    expect(res.status).toBe(403);
  });

  test('400 si url manquante', async () => {
    const res = await request(app).post('/api/listings/1/photos').set(HOST_AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('200 et ajoute la photo à la liste', async () => {
    const res = await request(app).post('/api/listings/1/photos').set(HOST_AUTH).send({ url: '/uploads/a.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual(['/uploads/a.jpg']);
    expect(db.listings.updateById).toHaveBeenCalledWith(1, { photos: JSON.stringify(['/uploads/a.jpg']) });
  });
});

describe('DELETE /api/listings/:id/photos', () => {
  test('403 si l\'utilisateur n\'est pas le propriétaire', async () => {
    const res = await request(app).delete('/api/listings/1/photos').set(GUEST_AUTH).send({ url: '/uploads/a.jpg' });
    expect(res.status).toBe(403);
  });

  test('200 et retire la photo demandée', async () => {
    db.listings.findById.mockResolvedValueOnce({ id: 1, host_id: 1, photos: ['/uploads/a.jpg', '/uploads/b.jpg'] });
    const res = await request(app).delete('/api/listings/1/photos').set(HOST_AUTH).send({ url: '/uploads/a.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual(['/uploads/b.jpg']);
    expect(db.listings.updateById).toHaveBeenCalledWith(1, { photos: JSON.stringify(['/uploads/b.jpg']) });
  });
});
