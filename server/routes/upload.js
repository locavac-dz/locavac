const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');
const auth    = require('../middleware/auth');
const db      = require('../db');

const UPLOAD_DIR   = path.join(__dirname, '..', '..', 'public', 'uploads');
// Pièces d'identité hors de public/ : jamais servies statiquement, uniquement via GET /identity/:filename
const IDENTITY_DIR = path.join(__dirname, '..', '..', 'private', 'identity');
for (const dir of [UPLOAD_DIR, IDENTITY_DIR]) if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// ── Vérification magic bytes côté serveur (anti MIME-spoofing) ──
function checkMagicBytes(filePath, allowPdf = false) {
  const buf = Buffer.alloc(12);
  const fd  = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true; // WebP
  if (allowPdf && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return true; // PDF
  return false;
}

// Extension dérivée du type MIME validé (anti path-traversal via originalname)
const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg',
  'image/png': '.png', 'image/webp': '.webp',
  'application/pdf': '.pdf',
};

// ── Stockage disque — inclut l'id utilisateur dans le nom de fichier ──
const makeStorage = dir => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename:    (req, file, cb) => {
    const ext    = MIME_EXT[file.mimetype] || '.jpg';
    const userId = req.user ? String(req.user.id) : '0';
    // Format : {userId}_{timestamp}_{hex}.{ext}  — permet la vérification de propriété au DELETE
    const name   = userId + '_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex') + ext;
    cb(null, name);
  },
});
const storage = makeStorage(UPLOAD_DIR);

function fileFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Format non supporté. Utilisez JPG, PNG ou WebP.'));
}

const upload = multer({
  storage,
  limits:     { fileSize: 5 * 1024 * 1024, files: 10 }, // 5 Mo, 10 fichiers max
  fileFilter,
});

// ── POST /api/upload  (une seule photo) ─────────────────
router.post('/', auth, (req, res) => {
  upload.single('photo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Erreur upload.' });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    // Vérifier les magic bytes réels du fichier (anti MIME-spoofing)
    if (!checkMagicBytes(req.file.path)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Format de fichier non reconnu. Utilisez JPG, PNG ou WebP.' });
    }
    res.json({
      url:      '/uploads/' + req.file.filename,
      filename: req.file.filename,
      size:     req.file.size,
    });
  });
});

// ── POST /api/upload/multiple  (jusqu'à 10 photos) ──────
router.post('/multiple', auth, (req, res) => {
  upload.array('photos', 10)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Erreur upload.' });
    if (!req.files?.length) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    // Vérifier les magic bytes de chaque fichier
    for (const f of req.files) {
      if (!checkMagicBytes(f.path)) {
        req.files.forEach(x => { try { fs.unlinkSync(x.path); } catch {} });
        return res.status(400).json({ error: 'Format de fichier non reconnu. Utilisez JPG, PNG ou WebP.' });
      }
    }
    res.json({
      urls: req.files.map(f => ({
        url:      '/uploads/' + f.filename,
        filename: f.filename,
        size:     f.size,
      })),
    });
  });
});

// ── POST /api/upload/identity  (CNI algérienne — soumission pour revue admin) ──
const uploadId = multer({
  storage:    makeStorage(IDENTITY_DIR),
  limits:     { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/jpg','application/pdf'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Format non supporté (JPG, PNG, PDF).'));
  },
});

router.post('/identity', auth, (req, res) => {
  uploadId.single('document')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message || 'Erreur upload.' });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    // Vérifier les magic bytes
    if (!checkMagicBytes(req.file.path, true)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Format de fichier non reconnu (JPG, PNG ou PDF attendu).' });
    }
    const url = '/api/upload/identity/' + req.file.filename;
    // Soumettre le document pour revue manuelle — id_verified reste false jusqu'à validation admin
    await db.users.updateById(req.user.id, { id_document: url, id_verified: false });
    res.json({ url, message: 'Document soumis. Votre identité sera vérifiée par notre équipe sous 24–48h.' });
  });
});

// ── GET /api/upload/identity/:filename  (propriétaire ou admin uniquement) ──
const IDENTITY_NAME_RE = /^(\d+)_\d+_[0-9a-f]{16}\.(jpg|png|webp|pdf)$/i;
router.get('/identity/:filename', auth, async (req, res) => {
  const m = IDENTITY_NAME_RE.exec(req.params.filename);
  if (!m) return res.status(400).json({ error: 'Nom de fichier invalide.' });
  if (String(req.user.id) !== m[1]) {
    // Droit admin relu en base : un admin rétrogradé ne garde pas l'accès via un ancien JWT
    const me = await db.users.findById(req.user.id);
    if (!me?.is_admin) return res.status(403).json({ error: 'Accès refusé.' });
  }
  const fp = path.join(IDENTITY_DIR, m[0]);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Document introuvable.' });
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', 'inline');
  res.sendFile(fp);
});

// ── DELETE /api/upload  (supprimer une photo) ───────────
router.delete('/', auth, (req, res) => {
  const { filename } = req.body;
  // Format attendu : {userId}_{timestamp}_{hex}.{ext}
  if (!filename || !/^\d+_\d+_[0-9a-f]{16}\.(jpg|jpeg|png|webp|pdf)$/i.test(filename))
    return res.status(400).json({ error: 'Nom de fichier invalide.' });

  // Vérification de propriété : le fichier appartient à l'utilisateur courant (sauf admin)
  const ownerId = filename.split('_')[0];
  if (String(req.user.id) !== ownerId && !req.user.is_admin)
    return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres fichiers.' });

  const fp = path.resolve(UPLOAD_DIR, filename);
  // Anti path-traversal
  if (!fp.startsWith(path.resolve(UPLOAD_DIR)))
    return res.status(400).json({ error: 'Accès refusé.' });
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier introuvable.' });
  fs.unlinkSync(fp);
  res.json({ ok: true });
});

module.exports = router;
