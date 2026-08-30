const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Accès refusé.' });
  next();
}

// GET /api/publicites/admin/all — doit être AVANT /:id
router.get('/admin/all', auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM publicites ORDER BY created_at DESC');
  res.json(rows);
});

// GET /api/publicites — liste publique des actifs (tri vedette > premium > basic)
router.get('/', async (req, res) => {
  const { type, wilaya } = req.query;
  let q = `SELECT * FROM publicites WHERE actif = true`;
  const params = [];
  if (type)   { params.push(type);   q += ` AND type = $${params.length}`; }
  if (wilaya) { params.push(wilaya); q += ` AND wilaya ILIKE $${params.length}`; }
  q += ` ORDER BY CASE forfait WHEN 'vedette' THEN 1 WHEN 'premium' THEN 2 ELSE 3 END, created_at DESC`;
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// GET /api/publicites/:id
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM publicites WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Introuvable.' });
  res.json(rows[0]);
});

// POST /api/publicites — admin only
router.post('/', auth, adminOnly, async (req, res) => {
  const { nom, type, wilaya, ville, description, logo, images,
          telephone, email_contact, site_web, adresse, etoiles, forfait, expire_le } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO publicites
       (nom,type,wilaya,ville,description,logo,images,telephone,email_contact,site_web,adresse,etoiles,forfait,expire_le)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [nom, type, wilaya, ville||null, description||null, logo||null,
     JSON.stringify(images||[]), telephone||null, email_contact||null,
     site_web||null, adresse||null, etoiles||0, forfait||'basic', expire_le||null]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/publicites/:id — admin only
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { nom, type, wilaya, ville, description, logo, images,
          telephone, email_contact, site_web, adresse, etoiles, forfait, actif, expire_le } = req.body;
  const { rows } = await pool.query(
    `UPDATE publicites SET
       nom=$1,type=$2,wilaya=$3,ville=$4,description=$5,logo=$6,images=$7,
       telephone=$8,email_contact=$9,site_web=$10,adresse=$11,etoiles=$12,
       forfait=$13,actif=$14,expire_le=$15
     WHERE id=$16 RETURNING *`,
    [nom, type, wilaya, ville||null, description||null, logo||null,
     JSON.stringify(images||[]), telephone||null, email_contact||null,
     site_web||null, adresse||null, etoiles||0, forfait||'basic',
     actif !== undefined ? actif : true, expire_le||null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Introuvable.' });
  res.json(rows[0]);
});

// DELETE /api/publicites/:id — admin only
router.delete('/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM publicites WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
