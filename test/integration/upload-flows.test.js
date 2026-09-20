const request = require('supertest');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const UPLOAD_DIR   = path.join(__dirname, '..', '..', 'public', 'uploads');
const IDENTITY_DIR = path.join(__dirname, '..', '..', 'private', 'identity');
const auth = (id, extra = {}) => ({ Authorization: `Bearer ${jwt.sign({ id, email: `u${id}@test.dz`, ...extra }, process.env.JWT_SECRET)}` });
// Les suites Jest tournent en parallèle et partagent les dossiers d'upload : cette suite est la seule à écrire
// avec l'id 99, ce qui rend le contrôle de résidus (préfixe "99_") insensible aux autres suites.
const UPLOADER = 99;
const USER  = auth(UPLOADER);
const ADMIN = auth(98, { is_admin: true });

// Contenus minimaux reconnus par les contrôles de magic bytes du serveur
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(8)]);
const PDF  = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');

// Suivi des fichiers créés (chemins absolus) pour ne rien laisser sur le disque
const created = new Set();
const track = p => { if (p) created.add(p); return p; };
const list  = dir => new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
let before;
beforeEach(() => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(IDENTITY_DIR, { recursive: true });
  before = { [UPLOAD_DIR]: list(UPLOAD_DIR), [IDENTITY_DIR]: list(IDENTITY_DIR) };
});
afterEach(() => {
  jest.clearAllMocks();
  for (const p of created) { try { fs.unlinkSync(p); } catch {} }
  created.clear();
});
const leftovers = (dir = UPLOAD_DIR) => [...list(dir)].filter(f => !before[dir].has(f) && f.startsWith(`${UPLOADER}_`));

// Dépose un faux fichier possédé par ownerId dans public/uploads
function plant(ownerId, ext = 'jpg') {
  const name = `${ownerId}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), JPEG);
  track(path.join(UPLOAD_DIR, name));
  return name;
}

describe('POST /api/upload — photo unique', () => {
  test.each([['JPEG', JPEG, 'image/jpeg', 'jpg'], ['PNG', PNG, 'image/png', 'png'], ['WebP', WEBP, 'image/webp', 'webp']])(
    '200 pour une image %s valide : nom {userId}_{horodatage}_{hex}.{ext}', async (_n, buf, mime, ext) => {
      const res = await request(app).post('/api/upload').set(USER).attach('photo', buf, { filename: `x.${ext}`, contentType: mime });
      track(res.body.filename && path.join(UPLOAD_DIR, res.body.filename));
      expect(res.status).toBe(200);
      expect(res.body.filename).toMatch(new RegExp(`^${UPLOADER}_\\d+_[a-f0-9]{16}\\.${ext}$`));
      expect(res.body.url).toBe('/uploads/' + res.body.filename);
      expect(res.body.size).toBe(buf.length);
      expect(fs.existsSync(path.join(UPLOAD_DIR, res.body.filename))).toBe(true);
    });

  test('le nom du fichier envoyé (../../evil.php) n\'influence jamais le nom stocké', async () => {
    const res = await request(app).post('/api/upload').set(USER).attach('photo', PNG, { filename: '../../evil.php', contentType: 'image/png' });
    track(res.body.filename && path.join(UPLOAD_DIR, res.body.filename));
    expect(res.status).toBe(200);
    expect(res.body.filename).not.toMatch(/evil|php|\.\./);
    expect(res.body.filename).toMatch(/\.png$/);
  });

  test('l\'extension suit le type MIME validé, pas le nom fourni', async () => {
    const res = await request(app).post('/api/upload').set(USER).attach('photo', PNG, { filename: 'photo.exe', contentType: 'image/png' });
    track(res.body.filename && path.join(UPLOAD_DIR, res.body.filename));
    expect(res.body.filename).toMatch(/\.png$/);
  });

  test('400 : contenu non image déguisé en JPEG — fichier supprimé du disque', async () => {
    const res = await request(app).post('/api/upload').set(USER)
      .attach('photo', Buffer.from('<?php echo 1; ?>'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non reconnu/i);
    expect(leftovers()).toEqual([]);
  });

  test('400 : un PDF n\'est pas accepté pour une photo', async () => {
    const res = await request(app).post('/api/upload').set(USER).attach('photo', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(leftovers()).toEqual([]);
  });

  test('400 : fichier de plus de 5 Mo', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await request(app).post('/api/upload').set(USER).attach('photo', big, { filename: 'gros.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/large|volumineux|taille/i);
    expect(leftovers()).toEqual([]);
  });

  test('400 : mauvais nom de champ (file au lieu de photo)', async () => {
    const res = await request(app).post('/api/upload').set(USER).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(leftovers()).toEqual([]);
  });
});

describe('POST /api/upload/multiple — jusqu\'à 10 photos', () => {
  test('400 si un seul fichier est invalide : tout le lot est supprimé', async () => {
    const res = await request(app).post('/api/upload/multiple').set(USER)
      .attach('photos', PNG, { filename: 'ok.png', contentType: 'image/png' })
      .attach('photos', Buffer.from('pas une image'), { filename: 'faux.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non reconnu/i);
    expect(leftovers()).toEqual([]);
  });

  test('200 avec 10 photos (limite haute)', async () => {
    let req = request(app).post('/api/upload/multiple').set(USER);
    for (let i = 0; i < 10; i++) req = req.attach('photos', PNG, { filename: `p${i}.png`, contentType: 'image/png' });
    const res = await req;
    (res.body.urls || []).forEach(u => track(path.join(UPLOAD_DIR, u.filename)));
    expect(res.status).toBe(200);
    expect(res.body.urls).toHaveLength(10);
    expect(new Set(res.body.urls.map(u => u.filename)).size).toBe(10);
  });

  test('400 avec 11 photos : rien n\'est conservé sur le disque', async () => {
    let req = request(app).post('/api/upload/multiple').set(USER);
    for (let i = 0; i < 11; i++) req = req.attach('photos', PNG, { filename: `p${i}.png`, contentType: 'image/png' });
    const res = await req;
    expect(res.status).toBe(400);
    expect(leftovers()).toEqual([]);
  });
});

describe('POST /api/upload/identity — CNI algérienne', () => {
  const send = (buf, filename, contentType) => request(app).post('/api/upload/identity').set(USER).attach('document', buf, { filename, contentType });

  test.each([['PNG', PNG, 'image/png', 'png'], ['JPEG', JPEG, 'image/jpeg', 'jpg'], ['PDF', PDF, 'application/pdf', 'pdf']])(
    '200 pour une CNI en %s : stockée hors de public/, soumise à revue, identité NON vérifiée automatiquement', async (_n, buf, mime, ext) => {
      const res = await send(buf, `cni.${ext}`, mime);
      const base = path.basename(res.body.url || '');
      track(path.join(IDENTITY_DIR, base));
      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(new RegExp(`^/api/upload/identity/${UPLOADER}_\\d+_[a-f0-9]{16}\\.${ext}$`));
      expect(res.body.message).toMatch(/24.48h/);
      expect(fs.existsSync(path.join(IDENTITY_DIR, base))).toBe(true);
      expect(fs.existsSync(path.join(UPLOAD_DIR, base))).toBe(false);
      expect(db.users.updateById).toHaveBeenCalledWith(UPLOADER, { id_document: res.body.url, id_verified: false });
    });

  test('400 : faux PDF (texte) — supprimé et profil inchangé', async () => {
    const res = await send(Buffer.from('ceci est du texte'), 'cni.pdf', 'application/pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non reconnu/i);
    expect(db.users.updateById).not.toHaveBeenCalled();
    expect(leftovers(IDENTITY_DIR)).toEqual([]);
  });

  test('400 : type MIME non autorisé (texte)', async () => {
    const res = await send(Buffer.from('bonjour'), 'cni.txt', 'text/plain');
    expect(res.status).toBe(400);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('400 : plus de 8 Mo', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(8 * 1024 * 1024)]);
    const res = await send(big, 'cni.pdf', 'application/pdf');
    expect(res.status).toBe(400);
    expect(db.users.updateById).not.toHaveBeenCalled();
    expect(leftovers(IDENTITY_DIR)).toEqual([]);
  });

  test('un nouveau dépôt remet id_verified à false (revue de nouveau requise)', async () => {
    const res = await send(PNG, 'cni2.png', 'image/png');
    track(path.join(IDENTITY_DIR, path.basename(res.body.url)));
    expect(db.users.updateById.mock.calls[0][1].id_verified).toBe(false);
  });
});

describe('DELETE /api/upload — suppression', () => {
  const del = (filename, headers = USER) => request(app).delete('/api/upload').set(headers).send({ filename });

  test('200 : le propriétaire supprime son fichier, il disparaît du disque', async () => {
    const name = plant(UPLOADER);
    const res = await del(name);
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(UPLOAD_DIR, name))).toBe(false);
  });

  test('403 : le fichier d\'un autre utilisateur reste intact', async () => {
    const name = plant(2);
    const res = await del(name);
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(UPLOAD_DIR, name))).toBe(true);
  });

  test('200 : un admin peut supprimer le fichier d\'un autre', async () => {
    const name = plant(2);
    const res = await del(name, ADMIN);
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(UPLOAD_DIR, name))).toBe(false);
  });

  test('404 : fichier propre inexistant', async () => {
    const res = await del(`${UPLOADER}_${Date.now()}_${'a'.repeat(16)}.jpg`);
    expect(res.status).toBe(404);
  });

  test.each(['../server/index.js', '2_1_abcdef0123456789.jpg/../../x', '2_1_abcdef0123456789.jpg.php', '2_1_abc.jpg'])(
    '400 pour le nom non conforme "%s"', async filename => {
      const res = await del(filename);
      expect(res.status).toBe(400);
    });

  test('le fichier n\'est pas supprimé quand l\'id du propriétaire n\'est qu\'un préfixe de celui de l\'appelant (9 vs 99)', async () => {
    const name = plant(9);
    const res = await del(name);
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(UPLOAD_DIR, name))).toBe(true);
  });

  test('401 sans token', async () => {
    const res = await request(app).delete('/api/upload').send({ filename: '2_1_abcdef0123456789.jpg' });
    expect(res.status).toBe(401);
  });
});
