const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const IDENTITY_DIR = path.join(__dirname, '..', 'private', 'identity');
const UPLOAD_DIR   = path.join(__dirname, '..', 'public', 'uploads'); // emplacement historique des pièces d'identité
const DOC_NAME_RE  = /^(\d+)_\d+_[0-9a-f]{16}\.(jpg|jpeg|png|webp|pdf)$/i;

// Supprime du disque la pièce d'identité d'un utilisateur. Le nom est revalidé et doit porter l'id du
// titulaire : une valeur id_document falsifiée ne peut ni sortir du dossier ni viser le fichier d'un tiers.
function removeIdentityFile(uid, idDocument) {
  const name = path.basename(String(idDocument || ''));
  const m = DOC_NAME_RE.exec(name);
  if (!m || m[1] !== String(uid)) return false;
  let removed = false;
  for (const dir of [IDENTITY_DIR, UPLOAD_DIR]) {
    const fp = path.join(dir, name);
    try { if (fs.existsSync(fp)) { fs.unlinkSync(fp); removed = true; } } catch {}
  }
  return removed;
}

// Effacement RGPD / loi 18-07 — point d'entrée UNIQUE (suppression par l'utilisateur ou par un admin).
// Les données personnelles sont effacées ; l'identifiant, les réservations et les paiements sont conservés
// pseudonymisés pour l'historique comptable. Le compte est banni, ce qui invalide ses JWT encore valides.
async function anonymizeUser(uid) {
  const user = await db.users.findById(uid);
  if (!user) return false;

  removeIdentityFile(uid, user.id_document);

  await db.listings.setAvailableByHost(uid, false);
  await db.messages.deleteByUser(uid);

  const deleted = await db.pool.query('DELETE FROM reviews WHERE author_id = $1 OR user_id = $1 RETURNING listing_id', [uid]);
  const listingIds = [...new Set((deleted.rows || []).map(r => r.listing_id).filter(Boolean))];
  for (const lid of listingIds) await db.listings.updateRating(lid);

  await db.pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [uid]);
  if (user.email) {
    await db.pool.query('DELETE FROM newsletter_subscribers WHERE email = $1', [String(user.email).toLowerCase().trim()]);
  }

  await db.users.updateById(uid, {
    name:               'Utilisateur supprimé',
    email:              `deleted_${uid}_${Date.now()}@deleted.invalid`,
    password:           '',
    phone:              null,
    bio:                null,
    avatar:             null,
    languages:          [],
    rib:                null,
    ccp:                null,
    id_document:        null,
    id_verified:        false,
    google_id:          null,
    verification_token: null,
    email_verified:     false,
    verified:           false,
    is_host:            false,
    is_admin:           false,
    banned:             true,
  });
  return true;
}

module.exports = { anonymizeUser, removeIdentityFile };
