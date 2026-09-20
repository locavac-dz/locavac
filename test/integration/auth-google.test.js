const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));
// Mock du module https natif pour simuler les réponses de l'API Google
jest.mock('https', () => ({ request: jest.fn() }));

const https = require('https');
const app = require('../../server/index');
const db  = require('../mocks/db');

// ── Helpers ────────────────────────────────────────────────────────────────

// Construit une fausse réponse IncomingMessage qui émet data puis end
function fakeRes(data) {
  let dataHandler;
  return {
    on(event, handler) {
      if (event === 'data') { dataHandler = handler; }
      if (event === 'end') {
        // Déclenche les handlers dans le bon ordre (synchrone)
        if (dataHandler) dataHandler(JSON.stringify(data));
        handler();
      }
    },
  };
}

// Prépare https.request pour répondre avec plusieurs réponses successives
function mockGoogle(...responses) {
  let call = 0;
  https.request.mockImplementation((_opts, callback) => {
    callback(fakeRes(responses[call++] || {}));
    return { write: jest.fn(), end: jest.fn(), on: jest.fn() };
  });
}

// Génère un state CSRF valide pour les tests du callback
const makeState = () =>
  jwt.sign({ nonce: 'test-nonce' }, process.env.JWT_SECRET, { expiresIn: '10m' });

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/auth/google', () => {
  afterEach(() => { delete process.env.GOOGLE_CLIENT_ID; });

  test('302 → not_configured si GOOGLE_CLIENT_ID absent', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await request(app).get('/api/auth/google').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_not_configured/);
  });

  test('302 → Google si GOOGLE_CLIENT_ID présent', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    const res = await request(app).get('/api/auth/google').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com/);
    expect(res.headers.location).toMatch(/client_id=test-client-id/);
    expect(res.headers.location).toMatch(/scope=.*email/);
    // Le state CSRF est un JWT — présent dans l'URL
    expect(res.headers.location).toMatch(/state=/);
  });
});

describe('GET /api/auth/google/callback — erreurs sans appel Google', () => {
  test('302 → google_denied si error=access_denied', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback?error=access_denied')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_denied/);
  });

  test('302 → google_invalid si code absent', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback?state=quelque-chose')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_invalid/);
  });

  test('302 → google_invalid si state absent', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback?code=abc')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_invalid/);
  });

  test('302 → google_csrf si state invalide (mauvaise signature)', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback?code=abc&state=mauvais.jwt.state')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_csrf/);
  });
});

describe('GET /api/auth/google/callback — flux avec appels Google simulés', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID     = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  });
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    jest.clearAllMocks();
  });

  test('302 → google_token si Google ne renvoie pas access_token', async () => {
    mockGoogle({ error: 'invalid_grant' }); // pas d'access_token
    const state = makeState();
    const res = await request(app)
      .get(`/api/auth/google/callback?code=bad&state=${encodeURIComponent(state)}`)
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_token/);
  });

  test('302 → google_no_email si le profil ne contient pas d\'email', async () => {
    mockGoogle(
      { access_token: 'fake-token' },
      { sub: '12345', name: 'Sans email' }, // pas d'email
    );
    const state = makeState();
    const res = await request(app)
      .get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_no_email/);
  });

  test('302 → google_auth=1 + cookie _gat si nouvel utilisateur (création)', async () => {
    mockGoogle(
      { access_token: 'fake-token' },
      { sub: 'new-sub-999', email: 'nouveau@gmail.com', email_verified: true, name: 'Nouveau User', picture: null },
    );
    db.users.findByGoogleId.mockResolvedValueOnce(null);
    db.users.findByEmail.mockResolvedValueOnce(null);
    db.users.create.mockResolvedValueOnce({
      id: 999, name: 'Nouveau User', email: 'nouveau@gmail.com',
      is_host: false, is_admin: false, banned: false,
    });

    const state = makeState();
    const res = await request(app)
      .get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\?google_auth=1/);
    // Le JWT doit être dans un cookie httpOnly, PAS dans l'URL
    expect(res.headers.location).not.toMatch(/google_token=/);
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('_gat='))).toBe(true);
    expect(cookies.some(c => /HttpOnly/i.test(c))).toBe(true);
    expect(db.users.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'nouveau@gmail.com',
      google_id: 'new-sub-999',
      verified: true,
      email_verified: true,
      password: null,
    }));
  });

  test('302 → google_auth=1 + cookie _gat si utilisateur existant par google_id', async () => {
    const user = { id: 2, name: 'Guest Test', email: 'guest@test.dz', is_host: false, is_admin: false, banned: false };
    mockGoogle(
      { access_token: 'fake-token' },
      { sub: 'existing-sub-2', email: 'guest@test.dz', email_verified: true, name: 'Guest Test' },
    );
    db.users.findByGoogleId.mockResolvedValueOnce(user);

    const state = makeState();
    const res = await request(app)
      .get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\?google_auth=1/);
    expect(res.headers.location).not.toMatch(/google_token=/);
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('_gat='))).toBe(true);
    // Pas de création — l'utilisateur existait déjà
    expect(db.users.create).not.toHaveBeenCalled();
  });

  test('302 → google_banned si l\'utilisateur est banni', async () => {
    mockGoogle(
      { access_token: 'fake-token' },
      { sub: 'banned-sub', email: 'banned@gmail.com', email_verified: true, name: 'Banni' },
    );
    db.users.findByGoogleId.mockResolvedValueOnce({
      id: 3, name: 'Banni', email: 'banned@gmail.com', is_host: false, is_admin: false, banned: true,
    });

    const state = makeState();
    const res = await request(app)
      .get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_banned/);
  });

  test('liaison de compte — email existant, confirmé localement, sans google_id', async () => {
    const existing = { id: 1, name: 'Hôte Test', email: 'host@test.dz', email_verified: true, is_host: true, is_admin: false, banned: false };
    mockGoogle(
      { access_token: 'fake-token' },
      { sub: 'new-sub-for-host', email: 'host@test.dz', email_verified: true, name: 'Hôte Test' },
    );
    db.users.findByGoogleId.mockResolvedValueOnce(null);
    db.users.findByEmail.mockResolvedValueOnce(existing);
    db.users.updateById.mockResolvedValueOnce();
    db.users.findById.mockResolvedValueOnce(existing);

    const state = makeState();
    const res = await request(app)
      .get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\?google_auth=1/);
    expect(res.headers.location).not.toMatch(/google_token=/);
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('_gat='))).toBe(true);
    expect(db.users.updateById).toHaveBeenCalledWith(1, { google_id: 'new-sub-for-host' });
    expect(db.users.create).not.toHaveBeenCalled();
  });

  // Pré-détournement de compte : un attaquant inscrit l'adresse de sa victime sans la confirmer ; la victime
  // se connecte plus tard via Google → sans ce contrôle, elle serait rattachée au compte de l'attaquant.
  test('liaison REFUSÉE si le compte local n\'a jamais confirmé son adresse (google_link_unverified)', async () => {
    const unverified = { id: 1, name: 'Hôte Test', email: 'host@test.dz', email_verified: false, is_host: true, banned: false };
    mockGoogle(
      { access_token: 'fake-token' },
      { sub: 'attacker-victim-sub', email: 'host@test.dz', email_verified: true, name: 'Hôte Test' },
    );
    db.users.findByGoogleId.mockResolvedValueOnce(null);
    db.users.findByEmail.mockResolvedValueOnce(unverified);

    const res = await request(app)
      .get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(makeState())}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth_error=google_link_unverified/);
    expect(res.headers['set-cookie'] || []).toEqual([]);
    expect(db.users.updateById).not.toHaveBeenCalled();
    expect(db.users.create).not.toHaveBeenCalled();
  });

  test('liaison refusée aussi quand email_verified est absent du compte local (comptes antérieurs à la migration)', async () => {
    mockGoogle(
      { access_token: 'fake-token' },
      { sub: 'sub-x', email: 'host@test.dz', email_verified: true, name: 'Hôte Test' },
    );
    db.users.findByGoogleId.mockResolvedValueOnce(null);
    db.users.findByEmail.mockResolvedValueOnce({ id: 1, email: 'host@test.dz', banned: false });
    const res = await request(app)
      .get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(makeState())}`)
      .redirects(0);
    expect(res.headers.location).toMatch(/auth_error=google_link_unverified/);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('adresse non certifiée par Google (email_verified absent ou faux) : refus avant toute recherche de compte', async () => {
    for (const profile of [{ sub: 's1', email: 'x@test.dz', name: 'X' }, { sub: 's2', email: 'x@test.dz', email_verified: false, name: 'X' }]) {
      jest.clearAllMocks();
      mockGoogle({ access_token: 'fake-token' }, profile);
      const res = await request(app)
        .get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(makeState())}`)
        .redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/auth_error=google_email_unverified/);
      expect(db.users.findByGoogleId).not.toHaveBeenCalled();
      expect(db.users.findByEmail).not.toHaveBeenCalled();
      expect(db.users.create).not.toHaveBeenCalled();
    }
  });
});

// ── Échange du cookie contre le JWT ───────────────────────────────────────

describe('GET /api/auth/google/token', () => {
  const validJwt = jwt.sign({ id: 1, email: 'test@test.dz' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const expiredJwt = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '-1s' });

  test('400 si aucun cookie _gat', async () => {
    const res = await request(app).get('/api/auth/google/token');
    expect(res.status).toBe(400);
  });

  test('200 + token si cookie valide, cookie effacé dans la réponse', async () => {
    const res = await request(app)
      .get('/api/auth/google/token')
      .set('Cookie', `_gat=${encodeURIComponent(validJwt)}`);
    expect(res.status).toBe(200);
    expect(res.body.token).toBe(validJwt);
    // Le serveur doit effacer le cookie
    const clearCookies = res.headers['set-cookie'] || [];
    expect(clearCookies.some(c => c.startsWith('_gat=;') || c.includes('_gat=; '))).toBe(true);
  });

  test('401 si cookie _gat contient un JWT expiré', async () => {
    const res = await request(app)
      .get('/api/auth/google/token')
      .set('Cookie', `_gat=${encodeURIComponent(expiredJwt)}`);
    expect(res.status).toBe(401);
  });

  test('401 si cookie _gat contient une valeur invalide', async () => {
    const res = await request(app)
      .get('/api/auth/google/token')
      .set('Cookie', '_gat=pas.un.jwt');
    expect(res.status).toBe(401);
  });
});
