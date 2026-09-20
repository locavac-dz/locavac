const fs   = require('fs');
const path = require('path');

jest.mock('../../server/db', () => require('../mocks/db'));

const db = require('../mocks/db');
const { anonymizeUser, removeIdentityFile } = require('../../server/anonymize');
const { tableColumns } = require('../helpers/schema');

const IDENTITY_DIR = path.join(__dirname, '..', '..', 'private', 'identity');
const UPLOAD_DIR   = path.join(__dirname, '..', '..', 'public', 'uploads');
const HEX = 'abcdef0123456789';
// Identifiants réservés à cette suite pour ne pas croiser les fichiers des autres suites (exécution parallèle)
const UID = 7701, OTHER = 7702;

const created = [];
function plant(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, 'piece-identite');
  created.push(fp);
  return fp;
}
const withUser = user => db.users.findById.mockResolvedValueOnce(user);

afterEach(() => {
  jest.clearAllMocks();
  while (created.length) { try { fs.unlinkSync(created.pop()); } catch {} }
});

describe('anonymizeUser — effacement RGPD / loi 18-07', () => {
  test('utilisateur introuvable : false, aucune écriture', async () => {
    withUser(null);
    expect(await anonymizeUser(UID)).toBe(false);
    expect(db.users.updateById).not.toHaveBeenCalled();
  });

  test('toutes les données personnelles sont effacées, le compte est banni et perd ses rôles', async () => {
    withUser({ id: UID, name: 'Nadia', email: 'Nadia@Test.dz', phone: '0555', rib: 'RIB', ccp: 'CCP', google_id: 'g-1', is_admin: true, is_host: true });
    expect(await anonymizeUser(UID)).toBe(true);
    const [uid, changes] = db.users.updateById.mock.calls[0];
    expect(uid).toBe(UID);
    expect(changes).toEqual({
      name: 'Utilisateur supprimé', email: expect.stringMatching(new RegExp(`^deleted_${UID}_\\d+@deleted\\.invalid$`)),
      password: '', phone: null, bio: null, avatar: null, languages: [], rib: null, ccp: null,
      id_document: null, id_verified: false, google_id: null, verification_token: null,
      email_verified: false, verified: false, is_host: false, is_admin: false, banned: true,
    });
  });

  test('chaque colonne écrite existe réellement dans la table users (schema.sql + migrations)', async () => {
    withUser({ id: UID, email: 'a@b.dz' });
    await anonymizeUser(UID);
    const columns = tableColumns('users');
    const unknown = Object.keys(db.users.updateById.mock.calls[0][1]).filter(c => !columns.has(c));
    expect(unknown).toEqual([]);
  });

  test('annonces désactivées, messages, avis, jetons de réinitialisation et abonnement newsletter supprimés', async () => {
    withUser({ id: UID, email: 'Nadia@Test.dz' });
    await anonymizeUser(UID);
    expect(db.listings.setAvailableByHost).toHaveBeenCalledWith(UID, false);
    expect(db.messages.deleteByUser).toHaveBeenCalledWith(UID);
    const calls = db.pool.query.mock.calls;
    expect(calls.find(c => /DELETE FROM reviews/.test(c[0]))[1]).toEqual([UID]);
    expect(calls.find(c => /DELETE FROM password_reset_tokens/.test(c[0]))[1]).toEqual([UID]);
    expect(calls.find(c => /DELETE FROM newsletter_subscribers/.test(c[0]))[1]).toEqual(['nadia@test.dz']);
  });

  test('la note des annonces dont un avis a été supprimé est recalculée (une fois par annonce)', async () => {
    withUser({ id: UID, email: 'a@b.dz' });
    db.pool.query.mockResolvedValueOnce({ rows: [{ listing_id: 4 }, { listing_id: 4 }, { listing_id: 9 }] });
    await anonymizeUser(UID);
    expect(db.listings.updateRating.mock.calls.map(c => c[0]).sort()).toEqual([4, 9]);
  });

  test('l\'historique financier est conservé : ni réservations ni paiements supprimés', async () => {
    withUser({ id: UID, email: 'a@b.dz' });
    await anonymizeUser(UID);
    const sqls = db.pool.query.mock.calls.map(c => c[0]).join('\n');
    expect(sqls).not.toMatch(/DELETE FROM (reservations|payments|payouts|users)\b/i);
  });
});

describe('Pièce d\'identité — suppression du fichier', () => {
  test('le fichier de private/identity est supprimé du disque', async () => {
    const name = `${UID}_1700000000000_${HEX}.pdf`;
    const fp = plant(IDENTITY_DIR, name);
    withUser({ id: UID, email: 'a@b.dz', id_document: `/api/upload/identity/${name}` });
    await anonymizeUser(UID);
    expect(fs.existsSync(fp)).toBe(false);
  });

  test('l\'ancien emplacement public/uploads est nettoyé aussi', async () => {
    const name = `${UID}_1700000000001_${HEX}.jpg`;
    const fp = plant(UPLOAD_DIR, name);
    withUser({ id: UID, email: 'a@b.dz', id_document: `/uploads/${name}` });
    await anonymizeUser(UID);
    expect(fs.existsSync(fp)).toBe(false);
  });

  test('un id_document pointant vers le fichier d\'un AUTRE utilisateur ne le supprime pas', async () => {
    const name = `${OTHER}_1700000000002_${HEX}.png`;
    const fp = plant(IDENTITY_DIR, name);
    withUser({ id: UID, email: 'a@b.dz', id_document: `/api/upload/identity/${name}` });
    await anonymizeUser(UID);
    expect(fs.existsSync(fp)).toBe(true);
  });

  test.each(['../../.env', '/api/upload/identity/../../../.env', `${UID}_1_${HEX}.exe`, `${UID}_1_abc.pdf`, '', null, 42])(
    'valeur non conforme ignorée sans erreur : %p', value => {
      expect(removeIdentityFile(UID, value)).toBe(false);
    });

  test('un préfixe d\'id partiel ne suffit pas (770 vs 7701)', () => {
    const name = `${UID}_1700000000003_${HEX}.pdf`;
    const fp = plant(IDENTITY_DIR, name);
    expect(removeIdentityFile(770, `/api/upload/identity/${name}`)).toBe(false);
    expect(fs.existsSync(fp)).toBe(true);
  });
});
