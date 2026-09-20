const request = require('supertest');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({ mailWelcome: jest.fn(), mailVerifyEmail: jest.fn() }));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app    = require('../../server/index');
const db     = require('../mocks/db');
const mailer = require('../../server/mailer');

const register = body => request(app).post('/api/auth/register').send(body);
const VALID = { name: 'Nadia Benali', email: 'nadia@test.dz', password: 'MotDePasse123!', phone: '0555123456' };

afterEach(() => jest.clearAllMocks());

describe('POST /api/auth/register — inscription réussie', () => {
  test('201 : jeton, profil public et indicateur de vérification', async () => {
    const res = await register(VALID);
    expect(res.status).toBe(201);
    expect(res.body.needsVerification).toBe(true);
    expect(res.body.user).toMatchObject({ id: 100, name: 'Nadia Benali', email: 'nadia@test.dz', is_host: false, is_admin: false });
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload).toMatchObject({ id: 100, email: 'nadia@test.dz', is_host: false, is_admin: false });
    expect(payload.exp - payload.iat).toBe(24 * 3600);
  });

  test('le mot de passe est haché (bcrypt) et n\'est ni stocké ni renvoyé en clair', async () => {
    const res = await register(VALID);
    const stored = db.users.create.mock.calls[0][0];
    expect(stored.password).not.toBe(VALID.password);
    expect(bcrypt.compareSync(VALID.password, stored.password)).toBe(true);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(VALID.password);
    expect(body).not.toContain(stored.password);
    expect(res.body.user).not.toHaveProperty('password');
    expect(res.body.user).not.toHaveProperty('verification_token');
  });

  test('compte créé non vérifié, non hôte, avec un jeton de vérification de 64 hexadécimaux', async () => {
    await register(VALID);
    expect(db.users.create.mock.calls[0][0]).toMatchObject({
      name: 'Nadia Benali', email: 'nadia@test.dz', phone: '0555123456', is_host: false, email_verified: false,
    });
    expect(db.users.create.mock.calls[0][0].verification_token).toMatch(/^[a-f0-9]{64}$/);
  });

  test('l\'e-mail de vérification contient le même jeton ; e-mail de bienvenue envoyé', async () => {
    await register(VALID);
    const token = db.users.create.mock.calls[0][0].verification_token;
    expect(mailer.mailVerifyEmail).toHaveBeenCalledWith(expect.objectContaining({
      email: 'nadia@test.dz', verifyUrl: expect.stringMatching(new RegExp(`/api/auth/verify-email\\?token=${token}$`)),
    }));
    expect(mailer.mailWelcome).toHaveBeenCalledWith(expect.objectContaining({ email: 'nadia@test.dz' }));
  });

  test('deux inscriptions successives : jetons de vérification distincts', async () => {
    await register(VALID);
    await register({ ...VALID, email: 'autre@test.dz' });
    const [a, b] = db.users.create.mock.calls.map(c => c[0].verification_token);
    expect(a).not.toBe(b);
  });

  test('téléphone facultatif : enregistré à null', async () => {
    await register({ name: VALID.name, email: VALID.email, password: VALID.password });
    expect(db.users.create.mock.calls[0][0].phone).toBeNull();
  });

  test('rôle et droits du corps ignorés (is_admin, is_host)', async () => {
    const res = await register({ ...VALID, is_admin: true, is_host: true });
    expect(db.users.create.mock.calls[0][0].is_host).toBe(false);
    expect(db.users.create.mock.calls[0][0]).not.toHaveProperty('is_admin');
    expect(res.body.user.is_admin).toBe(false);
  });

  test('mot de passe de 6 caractères accepté, 5 refusés', async () => {
    expect((await register({ ...VALID, password: '123456' })).status).toBe(201);
    expect((await register({ ...VALID, password: '12345' })).status).toBe(400);
  });
});

describe('POST /api/auth/register — refus', () => {
  test('409 si l\'e-mail existe déjà : aucun compte créé, aucun mail', async () => {
    const res = await register({ ...VALID, email: 'host@test.dz' });
    expect(res.status).toBe(409);
    expect(db.users.create).not.toHaveBeenCalled();
    expect(mailer.mailVerifyEmail).not.toHaveBeenCalled();
  });

  test.each(['pasunemail', 'a@b', 'a b@test.dz', '@test.dz', 'nadia@'])('400 pour l\'e-mail "%s"', async email => {
    const res = await register({ ...VALID, email });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('400 si le nom dépasse 100 caractères ou se réduit à 1 caractère après nettoyage', async () => {
    expect((await register({ ...VALID, name: 'x'.repeat(101) })).status).toBe(400);
    expect((await register({ ...VALID, name: '  A  ' })).status).toBe(400);
    expect((await register({ ...VALID, name: 'x'.repeat(100) })).status).toBe(201);
  });
});

describe('POST /api/auth/login — connexion', () => {
  const login = body => request(app).post('/api/auth/login').send(body);

  test('200 : jeton portant les droits de l\'utilisateur, profil sans mot de passe', async () => {
    const res = await login({ email: 'host@test.dz', password: 'MotDePasse123!' });
    expect(res.status).toBe(200);
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ id: 1, email: 'host@test.dz', is_host: true, is_admin: false });
    expect(res.body.user).toMatchObject({ id: 1, name: 'Hôte Test' });
    expect(res.body.user).not.toHaveProperty('password');
  });

  test('un admin obtient un jeton is_admin', async () => {
    const res = await login({ email: 'admin@test.dz', password: 'MotDePasse123!' });
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET).is_admin).toBe(true);
  });

  test('anti-énumération : même réponse 401 pour un e-mail inconnu et pour un mauvais mot de passe', async () => {
    const unknown = await login({ email: 'inconnu@test.dz', password: 'nimporte' });
    const wrong   = await login({ email: 'host@test.dz',    password: 'mauvais' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test('un compte banni ne peut pas se connecter (403) et ne reçoit aucun jeton', async () => {
    const res = await login({ email: 'banned@test.dz', password: 'MotDePasse123!' });
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('token');
  });

  test('le compte banni avec un mauvais mot de passe reçoit 401, pas 403 (n\'expose pas le bannissement)', async () => {
    const res = await login({ email: 'banned@test.dz', password: 'faux' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me et middleware d\'authentification', () => {
  const token = (payload, opts) => jwt.sign(payload, process.env.JWT_SECRET, opts);
  const me = headers => request(app).get('/api/auth/me').set(headers);
  const bearer = t => ({ Authorization: `Bearer ${t}` });

  test('200 : profil sans champ sensible', async () => {
    const res = await me(bearer(token({ id: 1 })));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, email: 'host@test.dz', is_host: true });
    expect(res.body).not.toHaveProperty('password');
  });

  test('404 si le compte a disparu entre-temps', async () => {
    db.users.findById.mockResolvedValueOnce(null);
    const res = await me(bearer(token({ id: 1 })));
    expect(res.status).toBe(404);
  });

  test('401 pour un compte banni même avec un jeton encore valide', async () => {
    const res = await me(bearer(token({ id: 3 })));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/désactivé|introuvable/i);
  });

  test('401 pour un compte supprimé (absent de la base)', async () => {
    const res = await me(bearer(token({ id: 555 })));
    expect(res.status).toBe(401);
  });

  test('401 pour un jeton expiré', async () => {
    const res = await me(bearer(token({ id: 1 }, { expiresIn: -10 })));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expiré|invalide/i);
  });

  test('401 pour un jeton signé avec une autre clé', async () => {
    const res = await me(bearer(jwt.sign({ id: 1 }, 'cle-pirate')));
    expect(res.status).toBe(401);
  });

  test('401 pour un jeton "alg: none" non signé', async () => {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 98, is_admin: true })}.`;
    const res = await me(bearer(forged));
    expect(res.status).toBe(401);
  });

  test('401 pour un jeton HS512 (seul HS256 est accepté)', async () => {
    const res = await me(bearer(jwt.sign({ id: 1 }, process.env.JWT_SECRET, { algorithm: 'HS512' })));
    expect(res.status).toBe(401);
  });

  test.each([['schéma Basic', 'Basic abc'], ['sans schéma', 'abc.def.ghi'], ['Bearer sans jeton', 'Bearer ']])(
    '401 pour un en-tête Authorization %s', async (_label, header) => {
      const res = await me({ Authorization: header });
      expect(res.status).toBe(401);
    });
});
