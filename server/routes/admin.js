const router    = require('express').Router();
const db        = require('../db');
const { pool }  = require('../db');
const admin     = require('../middleware/admin');

router.use(admin);

// GET /api/admin/stats — agrégats SQL directs pour éviter de charger toutes les lignes
router.get('/stats', async (req, res) => {
  const [uStats, lStats, rStats, payAgg, msgCount] = await Promise.all([
    pool.query(`SELECT COUNT(*) total, SUM(CASE WHEN is_host THEN 1 ELSE 0 END) hosts, SUM(CASE WHEN is_admin THEN 1 ELSE 0 END) admins, SUM(CASE WHEN date_trunc('month', created_at) = date_trunc('month', NOW()) THEN 1 ELSE 0 END) new_this_month FROM users`),
    pool.query(`SELECT COUNT(*) total, SUM(CASE WHEN available THEN 1 ELSE 0 END) active FROM listings`),
    pool.query(`SELECT COUNT(*) total, SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) confirmed, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled FROM reservations`),
    pool.query(`SELECT COUNT(*) transactions, COALESCE(SUM(amount),0) total_revenue FROM payments WHERE status='success'`),
    pool.query(`SELECT COUNT(*) total FROM messages`),
  ]);
  const u = uStats.rows[0]; const l = lStats.rows[0]; const r = rStats.rows[0]; const p = payAgg.rows[0]; const m = msgCount.rows[0];
  res.json({
    users:        { total: parseInt(u.total), new_this_month: parseInt(u.new_this_month), hosts: parseInt(u.hosts), admins: parseInt(u.admins) },
    listings:     { total: parseInt(l.total), active: parseInt(l.active), inactive: parseInt(l.total) - parseInt(l.active) },
    reservations: { total: parseInt(r.total), confirmed: parseInt(r.confirmed), pending: parseInt(r.pending), cancelled: parseInt(r.cancelled) },
    revenue:      { total: parseFloat(p.total_revenue), transactions: parseInt(p.transactions) },
    messages:     { total: parseInt(m.total) },
  });
});

// GET /api/admin/users — compteurs agrégés en une seule requête SQL (anti N+1)
router.get('/users', async (req, res) => {
  const { q, role } = req.query;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const LIMIT  = 100;
  const offset = (page - 1) * LIMIT;
  const conds  = [];
  const params = [];
  let i = 1;
  if (q)             { conds.push(`(lower(u.name) LIKE $${i} OR lower(u.email) LIKE $${i})`); params.push(`%${q.toLowerCase()}%`); i++; }
  if (role === 'host')   conds.push('u.is_host = true');
  if (role === 'admin')  conds.push('u.is_admin = true');
  if (role === 'banned') conds.push('u.banned = true');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = (await pool.query(`
    SELECT u.*,
      (SELECT COUNT(*) FROM listings   WHERE host_id  = u.id) AS listings_count,
      (SELECT COUNT(*) FROM reservations WHERE guest_id = u.id) AS reservations_count
    FROM users u ${where}
    ORDER BY u.id ASC
    LIMIT ${LIMIT} OFFSET ${offset}
  `, params)).rows;

  res.json(rows.map(u => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    is_host: u.is_host, is_admin: u.is_admin || false,
    verified: u.verified || false, banned: u.banned || false,
    id_document: u.id_document || null, id_verified: u.id_verified || false,
    created_at: u.created_at,
    listings_count:     parseInt(u.listings_count),
    reservations_count: parseInt(u.reservations_count),
  })));
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', async (req, res) => {
  const uid = Number(req.params.id);
  if (uid === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre compte admin.' });
  const user = await db.users.findById(uid);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const { banned, is_admin, verified, id_verified } = req.body;
  const changes = {};
  if (banned      !== undefined) changes.banned      = !!banned;
  if (is_admin    !== undefined) changes.is_admin    = !!is_admin;
  if (verified    !== undefined) changes.verified    = !!verified;
  if (id_verified !== undefined) changes.id_verified = !!id_verified;
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Aucun champ à modifier.' });
  await db.users.updateById(uid, changes);
  res.json({ ok: true, ...changes });
});

// DELETE /api/admin/users/:id — anonymisation RGPD (loi 18-07) au lieu du hard-delete
// L'historique des réservations et paiements est conservé avec données pseudonymisées.
router.delete('/users/:id', async (req, res) => {
  const uid = Number(req.params.id);
  if (uid === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' });
  const user = await db.users.findById(uid);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  // Désactiver et rendre les annonces indisponibles (ne pas les supprimer — elles sont dans l'historique)
  await db.listings.setAvailableByHost(uid, false);
  await db.messages.deleteByUser(uid);
  // Pseudonymisation : effacement des données personnelles, conservation de l'ID
  await db.users.updateById(uid, {
    name:               'Utilisateur supprimé',
    email:              `deleted_${uid}@locavac.dz`,
    phone:              null,
    password:           '',
    bio:                null,
    avatar:             null,
    verification_token: null,
    reset_token:        null,
    is_host:            false,
    is_admin:           false,
    banned:             true,
  });
  res.json({ ok: true });
});

// GET /api/admin/listings — JOIN hôte + comptage réservations en une seule requête SQL (anti N+1)
router.get('/listings', async (req, res) => {
  const { q, status } = req.query;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const LIMIT  = 100;
  const offset = (page - 1) * LIMIT;
  const conds  = [];
  const params = [];
  let i = 1;
  if (q)               { conds.push(`(lower(l.title) LIKE $${i} OR lower(l.location) LIKE $${i})`); params.push(`%${q.toLowerCase()}%`); i++; }
  if (status === 'active')   conds.push('l.available = true');
  if (status === 'inactive') conds.push('l.available = false');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = (await pool.query(`
    SELECT l.*,
      u.name  AS host_name,
      u.email AS host_email,
      (SELECT COUNT(*) FROM reservations WHERE listing_id = l.id) AS reservations_count
    FROM listings l
    LEFT JOIN users u ON u.id = l.host_id
    ${where}
    ORDER BY l.id DESC
    LIMIT ${LIMIT} OFFSET ${offset}
  `, params)).rows;

  res.json(rows.map(l => ({
    id: l.id, title: l.title, location: l.location, wilaya: l.wilaya,
    category: l.category, price: l.price, available: l.available,
    rating: l.rating, reviews: l.reviews, created_at: l.created_at,
    image: (l.photos && l.photos[0]) || l.image || '',
    host_name: l.host_name || 'Inconnu', host_email: l.host_email,
    reservations_count: parseInt(l.reservations_count),
  })));
});

// PATCH /api/admin/listings/:id
router.patch('/listings/:id', async (req, res) => {
  const lid = Number(req.params.id);
  if (!await db.listings.findById(lid)) return res.status(404).json({ error: 'Annonce introuvable.' });
  const { available } = req.body;
  if (available !== undefined) await db.listings.updateById(lid, { available: !!available });
  res.json({ ok: true });
});

// DELETE /api/admin/listings/:id
router.delete('/listings/:id', async (req, res) => {
  const lid = Number(req.params.id);
  if (!await db.listings.findById(lid)) return res.status(404).json({ error: 'Annonce introuvable.' });
  await db.listings.deleteById(lid);
  await db.reservations.deleteByListing(lid);
  await db.reviews.deleteByListing(lid);
  res.json({ ok: true });
});

// GET /api/admin/reservations — JOIN annonce + voyageur en une seule requête SQL (anti N+1)
router.get('/reservations', async (req, res) => {
  const { status } = req.query;
  const rows = (await pool.query(`
    SELECT r.*,
      l.title    AS listing_title,
      l.location AS listing_location,
      g.name     AS guest_name,
      g.email    AS guest_email
    FROM reservations r
    LEFT JOIN listings l ON l.id = r.listing_id
    LEFT JOIN users    g ON g.id = r.guest_id
    WHERE ($1::text IS NULL OR r.status = $1)
    ORDER BY r.id DESC
    LIMIT 100
  `, [status || null])).rows;
  res.json(rows);
});

// GET /api/admin/signalements — requête SQL directe (inchangée)
router.get('/signalements', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE s.status = $1`; }
  const rows = (await db.pool.query(`
    SELECT s.*, l.title AS listing_title, u.name AS user_name, u.email AS user_email
    FROM signalements s
    LEFT JOIN listings l ON l.id = s.listing_id
    LEFT JOIN users   u ON u.id = s.user_id
    ${where}
    ORDER BY s.created_at DESC
    LIMIT 200
  `, params)).rows;
  res.json(rows);
});

// PATCH /api/admin/signalements/:id/resolve
router.patch('/signalements/:id/resolve', async (req, res) => {
  const { rows } = await db.pool.query(
    "UPDATE signalements SET status='resolved' WHERE id=$1 RETURNING id",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Signalement introuvable.' });
  res.json({ ok: true });
});

// DELETE /api/admin/signalements/:id
router.delete('/signalements/:id', async (req, res) => {
  await db.pool.query('DELETE FROM signalements WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/admin/reservations/:id/rembourser
router.post('/reservations/:id/rembourser', async (req, res) => {
  const id   = Number(req.params.id);
  const resa = await db.reservations.findById(id);
  if (!resa) return res.status(404).json({ error: 'Réservation introuvable.' });
  if (resa.status === 'cancelled') return res.status(400).json({ error: 'Déjà annulée.' });
  await db.reservations.updateById(id, { status: 'cancelled' });
  if (resa.payment_id) {
    await db.payments.updateById(resa.payment_id, { status: 'refunded' });
  }
  res.json({ ok: true });
});

module.exports = router;
