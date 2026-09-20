const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const HOST = { Authorization: `Bearer ${jwt.sign({ id: 1, email: 'host@test.dz' }, process.env.JWT_SECRET)}` };

const L = (id, over = {}) => ({ id, host_id: 1, title: `Annonce ${id}`, price: 5000, rating: 0, available: true, blocked_ranges: [], amenities: [], ...over });

afterEach(() => jest.clearAllMocks());

describe('GET /api/listings — recherche et filtres', () => {
  test('transmet les critères au DAO (prix, chambres, voyageurs, texte…)', async () => {
    await request(app).get('/api/listings?wilaya=Alger&category=villa&guests=2&min_price=1000&max_price=9000&q=mer&min_beds=2');
    expect(db.listings.search).toHaveBeenCalledWith({
      wilaya: 'Alger', category: 'villa', guests: '2', minPrice: '1000', maxPrice: '9000', minBeds: '2', q: 'mer', unavailableIds: [],
    });
  });

  test('dates valides : exclut les annonces déjà réservées (findConflictingListingIds)', async () => {
    db.reservations.findConflictingListingIds.mockResolvedValueOnce([3, 4]);
    await request(app).get('/api/listings?check_in=2027-06-01&check_out=2027-06-10');
    expect(db.reservations.findConflictingListingIds).toHaveBeenCalledWith('2027-06-01', '2027-06-10');
    expect(db.listings.search).toHaveBeenCalledWith(expect.objectContaining({ unavailableIds: [3, 4] }));
  });

  test('dates incohérentes (arrivée ≥ départ) : aucun contrôle de conflit', async () => {
    await request(app).get('/api/listings?check_in=2027-06-10&check_out=2027-06-01');
    expect(db.reservations.findConflictingListingIds).not.toHaveBeenCalled();
  });

  test('exclut les annonces dont une plage bloquée chevauche le séjour (objet ou chaîne JSON)', async () => {
    db.listings.search.mockResolvedValueOnce([
      L(1, { blocked_ranges: [{ start: '2027-06-03', end: '2027-06-05' }] }),
      L(2, { blocked_ranges: JSON.stringify([{ start: '2027-06-08', end: '2027-06-20' }]) }),
      L(3),
    ]);
    const res = await request(app).get('/api/listings?check_in=2027-06-01&check_out=2027-06-10');
    expect(res.body.map(l => l.id)).toEqual([3]);
  });

  test('plage bloquée qui commence le jour du départ : annonce conservée (bornes exclusives)', async () => {
    db.listings.search.mockResolvedValueOnce([L(1, { blocked_ranges: [{ start: '2027-06-10', end: '2027-06-12' }] })]);
    const res = await request(app).get('/api/listings?check_in=2027-06-01&check_out=2027-06-10');
    expect(res.body.map(l => l.id)).toEqual([1]);
  });

  test('?amenities= exige TOUTES les commodités (espaces et éléments vides ignorés)', async () => {
    db.listings.search.mockResolvedValueOnce([
      L(1, { amenities: ['wifi', 'piscine', 'clim'] }),
      L(2, { amenities: ['wifi'] }),
      L(3, { amenities: JSON.stringify(['piscine', 'wifi']) }),
      L(4, { amenities: null }),
    ]);
    const res = await request(app).get('/api/listings').query({ amenities: 'wifi, ,piscine' });
    expect(res.body.map(l => l.id).sort()).toEqual([1, 3]);
  });

  test('tri par note décroissante', async () => {
    db.listings.search.mockResolvedValueOnce([L(1, { rating: 3.5 }), L(2, { rating: 4.9 }), L(3, { rating: 4.1 })]);
    const res = await request(app).get('/api/listings');
    expect(res.body.map(l => l.id)).toEqual([2, 3, 1]);
  });

  test('cache public de 30 secondes', async () => {
    const res = await request(app).get('/api/listings');
    expect(res.headers['cache-control']).toBe('public, max-age=30, stale-while-revalidate=60');
  });

  test('chaque annonce est enrichie avec son hôte ; hôte inconnu = "Inconnu"', async () => {
    db.listings.search.mockResolvedValueOnce([L(1), L(2, { host_id: 555 })]);
    const res = await request(app).get('/api/listings');
    expect(res.body.find(l => l.id === 1)).toMatchObject({ host_name: 'Hôte Test', host_phone: null, host_languages: [] });
    expect(res.body.find(l => l.id === 2)).toMatchObject({ host_name: 'Inconnu' });
  });

  test('hôtes chargés en une seule requête pour toutes les annonces (anti N+1)', async () => {
    db.listings.search.mockResolvedValueOnce([L(1), L(2), L(3, { host_id: 2 })]);
    await request(app).get('/api/listings');
    expect(db.users.findByIds).toHaveBeenCalledTimes(1);
    expect(db.users.findByIds.mock.calls[0][0].sort()).toEqual([1, 2]);
  });

  test('aucun résultat : tableau vide, aucun chargement d\'hôtes', async () => {
    db.listings.search.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/listings');
    expect(res.body).toEqual([]);
    expect(db.users.findByIds).not.toHaveBeenCalled();
  });
});

describe('POST /api/listings — création réussie', () => {
  const BASE = { title: 'Belle villa vue mer', location: 'Tipaza', wilaya: 'Tipaza', category: 'villa', price: 12000 };
  const create = body => request(app).post('/api/listings').set(HOST).send({ ...BASE, ...body });
  const created = () => db.listings.create.mock.calls[0][0];

  test('201 avec l\'id ; l\'utilisateur devient hôte', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 200 });
    expect(db.users.updateById).toHaveBeenCalledWith(1, { is_host: true });
  });

  test('valeurs par défaut : 1 voyageur/chambre/salle de bain, note 0, disponible, politique flexible', async () => {
    await create({});
    expect(created()).toMatchObject({
      host_id: 1, price: 12000, guests: 1, beds: 1, baths: 1, rating: 0, reviews: 0,
      available: true, cancellation_policy: 'flexible', lat: null, lng: null,
      photos: '[]', amenities: '[]', description: '',
    });
  });

  test('l\'hôte propriétaire vient du token : host_id, rating et reviews du corps ignorés', async () => {
    await create({ host_id: 99, rating: 5, reviews: 500, available: false });
    expect(created()).toMatchObject({ host_id: 1, rating: 0, reviews: 0, available: true });
  });

  test('nombres fournis en chaînes convertis (prix "7500", 4 voyageurs)', async () => {
    await create({ price: '7500', guests: '4', beds: '2', baths: '1' });
    expect(created()).toMatchObject({ price: 7500, guests: 4, beds: 2, baths: 1 });
  });

  test('photos : l\'image principale est la première photo ; liste sérialisée en JSON', async () => {
    await create({ photos: ['/uploads/a.jpg', '/uploads/b.jpg'] });
    expect(created().image).toBe('/uploads/a.jpg');
    expect(created().photos).toBe(JSON.stringify(['/uploads/a.jpg', '/uploads/b.jpg']));
  });

  test('image seule : devient l\'unique photo', async () => {
    await create({ image: '/uploads/main.jpg' });
    expect(created().photos).toBe(JSON.stringify(['/uploads/main.jpg']));
  });

  test('commodités : tableau conservé, valeur non tableau ignorée', async () => {
    await create({ amenities: ['wifi', 'clim'] });
    expect(created().amenities).toBe(JSON.stringify(['wifi', 'clim']));
    jest.clearAllMocks();
    await create({ amenities: 'wifi' });
    expect(created().amenities).toBe('[]');
  });

  test.each([['flexible', 'flexible'], ['moderee', 'moderee'], ['stricte', 'stricte'], ['gratuite', 'flexible'], [undefined, 'flexible']])(
    'politique d\'annulation %p → %s', async (given, stored) => {
      await create({ cancellation_policy: given });
      expect(created().cancellation_policy).toBe(stored);
    });

  test('coordonnées GPS valides converties en nombres', async () => {
    await create({ lat: '36.7538', lng: 3.0588 });
    expect(created()).toMatchObject({ lat: 36.7538, lng: 3.0588 });
  });

  test.each([
    ['lng hors limites (181)',      { lng: 181 },               /longitude/i],
    ['0 chambre',                   { beds: 0 },                /chambres/i],
    ['31 chambres',                 { beds: 31 },               /chambres/i],
    ['21 salles de bain',           { baths: 21 },              /salles de bain/i],
    ['voyageurs non entier (2.5)',  { guests: 2.5 },            /voyageurs/i],
    ['description > 3000',          { description: 'x'.repeat(3001) }, /description/i],
    ['titre > 120 caractères',      { title: 'x'.repeat(121) }, /titre/i],
    ['titre d\'espaces',            { title: '       ' },        /obligatoires|titre/i],
    ['titre non textuel',           { title: 12345678 },        /titre/i],
    ['prix non numérique',          { price: 'gratuit' },       /prix/i],
    ['prix vide',                   { price: '' },              /obligatoires/i],
  ])('400 : %s', async (_label, body, msg) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
    expect(db.listings.create).not.toHaveBeenCalled();
  });

  test('bornes acceptées : prix 1 000 000, 50 voyageurs, titre de 120 caractères', async () => {
    const res = await create({ price: 1_000_000, guests: 50, title: 'x'.repeat(120) });
    expect(res.status).toBe(201);
  });
});
