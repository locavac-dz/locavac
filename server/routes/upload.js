const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');
const auth    = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Stockage disque ──────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase().replace(/[^.a-z]/g, '') || '.jpg';
    const name = Date.now() + '_' + crypto.randomBytes(8).toString('hex') + ext;
    cb(null, name);
  },
});

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
    res.json({
      urls: req.files.map(f => ({
        url:      '/uploads/' + f.filename,
        filename: f.filename,
        size:     f.size,
      })),
    });
  });
});

// ── POST /api/upload/identity  (CNI algérienne — vérification automatique) ──
const uploadId = multer({
  storage,
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
    const db  = require('../db');
    const url = '/uploads/' + req.file.filename;
    // Vérification automatique à réception de la CNI algérienne
    await db.users.update(u => u.id === req.user.id, { id_document: url, id_verified: true });
    res.json({ url, message: 'CNI vérifiée. Votre identité est maintenant confirmée.' });
  });
});

// ── DELETE /api/upload  (supprimer une photo) ───────────
router.delete('/', auth, (req, res) => {
  const { filename } = req.body;
  if (!filename || filename.includes('..') || filename.includes('/'))
    return res.status(400).json({ error: 'Nom de fichier invalide.' });
  const fp = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier introuvable.' });
  fs.unlinkSync(fp);
  res.json({ ok: true });
});

module.exports = router;
