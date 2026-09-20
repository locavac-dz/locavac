const request = require('supertest');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');

const UPLOAD_DIR   = path.join(__dirname, '..', '..', 'public', 'uploads');
const IDENTITY_DIR = path.join(__dirname, '..', '..', 'private', 'identity');
const auth = (id, extra = {}) => ({ Authorization: `Bearer ${jwt.sign({ id, email: `u${id}@test.dz`, ...extra }, process.env.JWT_SECRET)}` });

// id=1 : propriétaire du document ; id=2 : autre utilisateur ; id=98 : seul admin réel du mock
const OWNER       = auth(1);
const OTHER       = auth(2);
const REAL_ADMIN  = auth(98, { is_admin: true });
const FAKE_ADMIN  = auth(2,  { is_admin: true }); // se prétend admin dans le JWT, ne l'est pas en base

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(16)]);
const HEX16 = 'abcdef0123456789';

let docUrl, docName;
beforeAll(async () => {
  const res = await request(app).post('/api/upload/identity').set(OWNER).attach('document', PNG, { filename: 'cni.png', contentType: 'image/png' });
  if (res.status !== 200) throw new Error('Dépôt de la CNI de test impossible : ' + res.status + ' ' + JSON.stringify(res.body));
  docUrl  = res.body.url;
  docName = path.basename(docUrl);
});
afterAll(() => { try { fs.unlinkSync(path.join(IDENTITY_DIR, docName)); } catch {} });

describe('Stockage des pièces d\'identité', () => {
  test('le fichier est écrit dans private/identity, jamais dans public/uploads', () => {
    expect(fs.existsSync(path.join(IDENTITY_DIR, docName))).toBe(true);
    expect(fs.existsSync(path.join(UPLOAD_DIR, docName))).toBe(false);
  });

  test('l\'URL renvoyée pointe vers la route authentifiée, pas vers /uploads', () => {
    expect(docUrl).toMatch(/^\/api\/upload\/identity\/1_\d+_[a-f0-9]{16}\.png$/);
  });

  test('le même nom sous /uploads ne donne rien (404), avec ou sans jeton', async () => {
    expect((await request(app).get('/uploads/' + docName)).status).toBe(404);
    expect((await request(app).get('/uploads/' + docName).set(OWNER)).status).toBe(404);
  });
});

describe('GET /api/upload/identity/:filename — contrôle d\'accès', () => {
  test('401 sans jeton', async () => {
    const res = await request(app).get(docUrl);
    expect(res.status).toBe(401);
  });

  test('401 avec le jeton en query string (jamais accepté : il finirait dans les journaux)', async () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
    const res = await request(app).get(`${docUrl}?token=${token}`);
    expect(res.status).toBe(401);
  });

  test('403 pour un autre utilisateur', async () => {
    const res = await request(app).get(docUrl).set(OTHER);
    expect(res.status).toBe(403);
  });

  test('403 pour un JWT qui se prétend admin sans l\'être en base (droit relu, pas lu dans le jeton)', async () => {
    const res = await request(app).get(docUrl).set(FAKE_ADMIN);
    expect(res.status).toBe(403);
  });

  test('200 pour le propriétaire : contenu exact, non mis en cache, affiché inline', async () => {
    const res = await request(app).get(docUrl).set(OWNER).buffer(true).parse((r, cb) => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(Buffer.compare(res.body, PNG)).toBe(0);
  });

  test('200 pour un administrateur réel', async () => {
    const res = await request(app).get(docUrl).set(REAL_ADMIN);
    expect(res.status).toBe(200);
  });

  test('404 pour un document inexistant au nom pourtant valide', async () => {
    const res = await request(app).get(`/api/upload/identity/1_1_${HEX16}.pdf`).set(OWNER);
    expect(res.status).toBe(404);
  });

  test.each([
    ['traversée encodée',       `%2E%2E%2F%2E%2E%2F.env`],
    ['hex trop court',          `1_1_abc.png`],
    ['extension interdite',     `1_1_${HEX16}.exe`],
    ['double extension',        `1_1_${HEX16}.png.php`],
    ['sans identifiant',        `_1_${HEX16}.png`],
  ])('400 pour un nom non conforme (%s)', async (_label, filename) => {
    const res = await request(app).get('/api/upload/identity/' + filename).set(OWNER);
    expect(res.status).toBe(400);
  });

  test('le propriétaire n\'accède pas au document d\'un autre même en connaissant son nom', async () => {
    const res = await request(app).get(`/api/upload/identity/2_1_${HEX16}.png`).set(OWNER);
    expect(res.status).toBe(403);
  });
});
