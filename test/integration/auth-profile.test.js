const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({
  mailWelcome: jest.fn(), mailVerifyEmail: jest.fn(), mailPasswordReset: jest.fn(),
}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app    = require('../../server/index');
const db     = require('../mocks/db');
const mailer = require('../../server/mailer');

const AUTH = { Authorization: `Bearer ${jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET)}` };

afterEach(() => jest.clearAllMocks());

describe('PUT /api/auth/profile', () => {
  test('401 sans token', async () => {
    const res = await request(app).put('/api/auth/profile').send({ name: 'Nouveau' });
    expect(res.status).toBe(401);
  });

  test('400 si nom trop court', async () => {
    const res = await request(app).put('/api/auth/profile').set(AUTH).send({ name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nom/i);
  });

  test('400 si téléphone invalide', async () => {
    const res = await request(app).put('/api/auth/profile').set(AUTH).send({ phone: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/téléphone/i);
  });

  test('400 si biographie > 500 caractères', async () => {
    const res = await request(app).put('/api/auth/profile').set(AUTH).send({ bio: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  test('400 si aucun champ à modifier', async () => {
    const res = await request(app).put('/api/auth/profile').set(AUTH).send({ email: 'ignore@test.dz' });
    expect(res.status).toBe(400);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('200 et persiste les champs nettoyés', async () => {
    const res = await request(app).put('/api/auth/profile').set(AUTH)
      .send({ name: '  Nouveau Nom  ', phone: '+213 555 12 34 56', bio: ' Hôte à Oran ' });
    expect(res.status).toBe(200);
    expect(db.users.updateById).toHaveBeenCalledWith(2, { name: 'Nouveau Nom', phone: '+213 555 12 34 56', bio: 'Hôte à Oran' });
    // La réponse ne doit pas exposer le mot de passe
    expect(res.body).not.toHaveProperty('password');
  });

  test('langues limitées à 10 entrées', async () => {
    const langs = Array.from({ length: 15 }, (_, i) => `l${i}`);
    const res = await request(app).put('/api/auth/profile').set(AUTH).send({ languages: langs });
    expect(res.status).toBe(200);
    expect(db.users.updateById.mock.calls[0][1].languages).toHaveLength(10);
  });
});

describe('POST /api/auth/forgot-password', () => {
  test('400 si email manquant', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });

  test('200 même si l\'email est inconnu (anti-énumération), sans envoi de mail', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'inconnu@test.dz' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mailer.mailPasswordReset).not.toHaveBeenCalled();
  });

  test('200 pour un email connu : anciens tokens invalidés, nouveau token inséré, mail envoyé', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: '  GUEST@test.dz ' });
    expect(res.status).toBe(200);
    const sqls = db.pool.query.mock.calls.map(c => c[0]);
    expect(sqls.some(s => /UPDATE password_reset_tokens SET used = true WHERE user_id/.test(s))).toBe(true);
    expect(sqls.some(s => /INSERT INTO password_reset_tokens/.test(s))).toBe(true);
    expect(mailer.mailPasswordReset).toHaveBeenCalledTimes(1);
    expect(mailer.mailPasswordReset.mock.calls[0][0].resetUrl).toMatch(/reset_token=[a-f0-9]{64}$/);
  });
});

describe('POST /api/auth/reset-password', () => {
  test('400 si token ou mot de passe manquant', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'abc' });
    expect(res.status).toBe(400);
  });

  test('400 si mot de passe < 6 caractères', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'abc', password: '123' });
    expect(res.status).toBe(400);
  });

  test('400 si token invalide ou expiré', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'inconnu', password: 'NouveauMdp1!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide ou expiré/i);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('200 avec token valide : mot de passe hashé et token marqué utilisé', async () => {
    db.pool.query.mockResolvedValueOnce({ rows: [{ id: 42, user_id: 2 }] });
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'valide', password: 'NouveauMdp1!' });
    expect(res.status).toBe(200);
    const [uid, changes] = db.users.updateById.mock.calls[0];
    expect(uid).toBe(2);
    expect(changes.password).toMatch(/^\$2[aby]\$/);   // hash bcrypt, jamais le clair
    expect(changes.password).not.toBe('NouveauMdp1!');
    const used = db.pool.query.mock.calls.find(c => /SET used = true WHERE id/.test(c[0]));
    expect(used[1]).toEqual([42]);
  });
});

describe('GET /api/auth/verify-email', () => {
  test('redirige vers ?verify=invalid sans token', async () => {
    const res = await request(app).get('/api/auth/verify-email');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?verify=invalid');
  });

  test('redirige vers ?verify=invalid si token inconnu', async () => {
    const res = await request(app).get('/api/auth/verify-email?token=inconnu');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?verify=invalid');
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('redirige vers ?verify=ok et marque l\'email vérifié', async () => {
    db.users.findByVerificationToken.mockResolvedValueOnce({ id: 2 });
    const res = await request(app).get('/api/auth/verify-email?token=valide');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?verify=ok');
    expect(db.users.updateById).toHaveBeenCalledWith(2, { email_verified: true, verification_token: null });
  });
});

describe('DELETE /api/auth/me — suppression RGPD', () => {
  test('401 sans token', async () => {
    const res = await request(app).delete('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('200 : messages et avis supprimés, compte anonymisé et banni, annonces désactivées', async () => {
    const res = await request(app).delete('/api/auth/me').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(db.messages.deleteByUser).toHaveBeenCalledWith(2);
    expect(db.listings.setAvailableByHost).toHaveBeenCalledWith(2, false);
    const calls = db.pool.query.mock.calls;
    expect(calls.some(c => /DELETE FROM reviews/.test(c[0]) && c[1][0] === 2)).toBe(true);
    const [uid, changes] = db.users.updateById.mock.calls[0];
    expect(uid).toBe(2);
    expect(changes).toMatchObject({ name: 'Utilisateur supprimé', password: '', phone: null, banned: true });
    expect(changes.email).toMatch(/^deleted_2_\d+@deleted\.invalid$/);
  });

  test('la suppression par l\'utilisateur efface les mêmes données que la suppression par un admin', async () => {
    await request(app).delete('/api/auth/me').set(AUTH);
    expect(db.users.updateById.mock.calls[0][1]).toMatchObject({
      rib: null, ccp: null, id_document: null, id_verified: false, google_id: null, verification_token: null, is_admin: false,
    });
  });
});

describe('GET /api/auth/users/:id — profil public', () => {
  test('404 si utilisateur introuvable', async () => {
    const res = await request(app).get('/api/auth/users/9999');
    expect(res.status).toBe(404);
  });

  test('200 sans données sensibles, avec le nombre d\'annonces actives', async () => {
    const res = await request(app).get('/api/auth/users/1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: 'Hôte Test', is_host: true, listing_count: 1 });
    expect(res.body).not.toHaveProperty('email');
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('phone');
  });

  test('les annonces indisponibles ne sont pas comptées', async () => {
    db.listings.findByHost.mockResolvedValueOnce([{ id: 1, available: false }, { id: 2, available: true }]);
    const res = await request(app).get('/api/auth/users/1');
    expect(res.body.listing_count).toBe(1);
  });
});
