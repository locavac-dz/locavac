const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

// id=98 est le seul admin du mock
const ADMIN = { Authorization: `Bearer ${jwt.sign({ id: 98, email: 'admin@test.dz', is_admin: true }, process.env.JWT_SECRET)}` };

// Le middleware auth consomme le premier pool.query ; les requêtes de la route suivent
const AUTH_ROW = { rows: [{ id: 98, banned: false }] };
const queueRows = (...results) => {
  db.pool.query.mockResolvedValueOnce(AUTH_ROW);
  results.forEach(rows => db.pool.query.mockResolvedValueOnce({ rows }));
};
// Dernière requête SQL de la route (après l'appel d'authentification)
const routeQuery = () => db.pool.query.mock.calls[1];

afterEach(() => jest.clearAllMocks());

describe('GET /api/admin/stats — agrégats', () => {
  test('convertit les agrégats SQL (chaînes) en nombres et calcule les annonces inactives', async () => {
    queueRows(
      [{ total: '10', hosts: '3', admins: '1', new_this_month: '2' }],
      [{ total: '8', active: '6' }],
      [{ total: '20', confirmed: '12', pending: '5', cancelled: '3' }],
      [{ transactions: '12', total_revenue: '450000.50' }],
      [{ total: '77' }],
    );
    const res = await request(app).get('/api/admin/stats').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      users:        { total: 10, new_this_month: 2, hosts: 3, admins: 1 },
      listings:     { total: 8, active: 6, inactive: 2 },
      reservations: { total: 20, confirmed: 12, pending: 5, cancelled: 3 },
      revenue:      { total: 450000.5, transactions: 12 },
      messages:     { total: 77 },
    });
  });

  test('le chiffre d\'affaires ne compte que les paiements réussis', async () => {
    queueRows(
      [{ total: '1', hosts: '0', admins: '0', new_this_month: '0' }], [{ total: '0', active: '0' }],
      [{ total: '0', confirmed: '0', pending: '0', cancelled: '0' }], [{ transactions: '0', total_revenue: '0' }], [{ total: '0' }],
    );
    await request(app).get('/api/admin/stats').set(ADMIN);
    const revenueSql = db.pool.query.mock.calls.map(c => c[0]).find(s => /FROM payments/.test(s));
    expect(revenueSql).toMatch(/status='success'/);
  });
});

describe('PATCH /api/admin/users/:id — modération', () => {
  const patch = (id, body) => request(app).patch(`/api/admin/users/${id}`).set(ADMIN).send(body);

  test('400 : l\'admin ne peut pas modifier son propre compte', async () => {
    const res = await patch(98, { banned: true });
    expect(res.status).toBe(400);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('404 si l\'utilisateur n\'existe pas', async () => {
    const res = await patch(9999, { banned: true });
    expect(res.status).toBe(404);
  });

  test('400 si aucun champ modifiable n\'est fourni', async () => {
    const res = await patch(2, {});
    expect(res.status).toBe(400);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('bannissement : 200 et changement renvoyé', async () => {
    const res = await patch(2, { banned: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, banned: true });
    expect(db.users.updateById).toHaveBeenCalledWith(2, { banned: true });
  });

  test('valeurs converties en booléens (verified "oui" → true, id_verified 0 → false)', async () => {
    const res = await patch(2, { verified: 'oui', id_verified: 0, is_admin: 1 });
    expect(db.users.updateById).toHaveBeenCalledWith(2, { verified: true, id_verified: false, is_admin: true });
    expect(res.body).toMatchObject({ verified: true, id_verified: false, is_admin: true });
  });

  test('protection contre l\'affectation de masse : password, email, is_host ignorés', async () => {
    const res = await patch(2, { password: 'hack', email: 'evil@x.dz', is_host: true, id: 1 });
    expect(res.status).toBe(400);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('champs autorisés seuls persistés, champs interdits filtrés', async () => {
    await patch(2, { banned: false, password: 'hack', email: 'evil@x.dz' });
    expect(db.users.updateById).toHaveBeenCalledWith(2, { banned: false });
  });
});

describe('GET /api/admin/users — filtres et pagination SQL', () => {
  const USER_ROW = {
    id: 5, name: 'Ali', email: 'ali@test.dz', password: 'HASH-SECRET', phone: '0555123456',
    is_host: true, is_admin: null, verified: null, banned: null, id_document: null, id_verified: null,
    created_at: '2026-01-01', listings_count: '2', reservations_count: '7',
  };

  test('ne renvoie jamais le mot de passe ; compteurs convertis ; booléens nuls ramenés à false', async () => {
    queueRows([USER_ROW]);
    const res = await request(app).get('/api/admin/users').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({
      id: 5, name: 'Ali', email: 'ali@test.dz', phone: '0555123456', is_host: true, is_admin: false,
      verified: false, banned: false, id_document: null, id_verified: false, created_at: '2026-01-01',
      listings_count: 2, reservations_count: 7,
    });
    expect(JSON.stringify(res.body)).not.toContain('HASH-SECRET');
  });

  test('sans filtre : pas de clause WHERE, LIMIT 100 OFFSET 0', async () => {
    queueRows([]);
    await request(app).get('/api/admin/users').set(ADMIN);
    const [sql, params] = routeQuery();
    expect(sql).not.toMatch(/FROM users u\s+WHERE/);
    expect(sql).toMatch(/LIMIT 100 OFFSET 0/);
    expect(params).toEqual([]);
  });

  test('?q= : recherche insensible à la casse sur nom et e-mail, valeur paramétrée', async () => {
    queueRows([]);
    await request(app).get('/api/admin/users?q=ALI').set(ADMIN);
    const [sql, params] = routeQuery();
    expect(sql).toMatch(/lower\(u\.name\) LIKE \$1 OR lower\(u\.email\) LIKE \$1/);
    expect(params).toEqual(['%ali%']);
  });

  test('?q= avec tentative d\'injection SQL : la valeur reste un paramètre, jamais dans le SQL', async () => {
    queueRows([]);
    const payload = "x' OR '1'='1";
    await request(app).get('/api/admin/users').query({ q: payload }).set(ADMIN);
    const [sql, params] = routeQuery();
    expect(sql).not.toContain("OR '1'='1");
    expect(params).toEqual([`%${payload.toLowerCase()}%`]);
  });

  test.each([
    ['host',   /u\.is_host = true/],
    ['admin',  /u\.is_admin = true/],
    ['banned', /u\.banned = true/],
  ])('?role=%s ajoute le filtre correspondant', async (role, re) => {
    queueRows([]);
    await request(app).get(`/api/admin/users?role=${role}`).set(ADMIN);
    expect(routeQuery()[0]).toMatch(re);
  });

  test('?role= inconnu ignoré (aucun filtre)', async () => {
    queueRows([]);
    await request(app).get('/api/admin/users?role=root').set(ADMIN);
    expect(routeQuery()[0]).not.toMatch(/FROM users u\s+WHERE/);
  });

  test('filtres combinés reliés par AND', async () => {
    queueRows([]);
    await request(app).get('/api/admin/users?q=ali&role=host').set(ADMIN);
    expect(routeQuery()[0]).toMatch(/FROM users u\s+WHERE .* AND u\.is_host = true/);
  });

  test('?page=3 → OFFSET 200 ; page négative ramenée à 1', async () => {
    queueRows([]);
    await request(app).get('/api/admin/users?page=3').set(ADMIN);
    expect(routeQuery()[0]).toMatch(/OFFSET 200/);
    jest.clearAllMocks();
    queueRows([]);
    await request(app).get('/api/admin/users?page=-3').set(ADMIN);
    expect(routeQuery()[0]).toMatch(/OFFSET 0/);
  });
});

describe('GET /api/admin/listings — filtres et projection', () => {
  const ROW = {
    id: 10, title: 'Villa', location: 'Oran', wilaya: 'Oran', category: 'villa', price: 8000, available: true,
    rating: 4.5, reviews: 3, created_at: '2026-02-02', photos: ['/uploads/a.jpg'], image: '/uploads/old.jpg',
    host_name: null, host_email: null, reservations_count: '4',
  };

  test('photo principale = 1re photo, sinon image ; hôte inconnu = "Inconnu" ; compteur converti', async () => {
    queueRows([ROW, { ...ROW, id: 11, photos: null }, { ...ROW, id: 12, photos: null, image: null }]);
    const res = await request(app).get('/api/admin/listings').set(ADMIN);
    expect(res.body.map(l => l.image)).toEqual(['/uploads/a.jpg', '/uploads/old.jpg', '']);
    expect(res.body[0]).toMatchObject({ host_name: 'Inconnu', reservations_count: 4 });
  });

  test.each([
    ['active',   /l\.available = true/],
    ['inactive', /l\.available = false/],
  ])('?status=%s', async (status, re) => {
    queueRows([]);
    await request(app).get(`/api/admin/listings?status=${status}`).set(ADMIN);
    expect(routeQuery()[0]).toMatch(re);
  });

  test('?q= paramétré sur titre et lieu', async () => {
    queueRows([]);
    await request(app).get('/api/admin/listings?q=Villa').set(ADMIN);
    const [sql, params] = routeQuery();
    expect(sql).toMatch(/lower\(l\.title\) LIKE \$1 OR lower\(l\.location\) LIKE \$1/);
    expect(params).toEqual(['%villa%']);
  });
});
