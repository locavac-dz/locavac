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

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const { q, role } = req.query;
  const users = await db.users.search({ q, role });

  const result = await Promise.all(users.map(async u => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    is_host: u.is_host, is_admin: u.is_admin || false,
    verified: u.verified || false, banned: u.banned || false,
    id_document: u.id_document || null, id_verified: u.id_verified || false,
    created_at: u.created_at,
    listings_count:     await db.users.countListings(u.id),
    reservations_count: await db.users.countReservations(u.id),
  })));
  res.json(result.sort((a,b) => a.id - b.id));
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

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const uid = Number(req.params.id);
  if (uid === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' });
  const user = await db.users.findById(uid);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  await db.listings.deleteByHost(uid);
  await db.reservations.deleteByGuest(uid);
  await db.messages.deleteByUser(uid);
  await db.users.deleteById(uid);
  res.json({ ok: true });
});

// GET /api/admin/listings
router.get('/listings', async (req, res) => {
  const { q, status } = req.query;
  const listings = await db.listings.adminSearch({ q, status });

  const result = await Promise.all(listings.map(async l => {
    const host = await db.users.findById(l.host_id);
    return {
      id: l.id, title: l.title, location: l.location, wilaya: l.wilaya,
      category: l.category, price: l.price, available: l.available,
      rating: l.rating, reviews: l.reviews, created_at: l.created_at,
      image: (l.photos && l.photos[0]) || l.image || '',
      host_name: host?.name || 'Inconnu', host_email: host?.email,
      reservations_count: await db.listings.countByListing(l.id),
    };
  }));
  res.json(result.sort((a,b) => b.id - a.id));
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

// GET /api/admin/reservations
router.get('/reservations', async (req, res) => {
  const { status } = req.query;
  const resas = await db.reservations.findAll(status || undefined);
  const result = await Promise.all(resas.slice(0, 100).map(async r => {
    const l = await db.listings.findById(r.listing_id);
    const g = await db.users.findById(r.guest_id);
    return { ...r, listing_title: l?.title, listing_location: l?.location, guest_name: g?.name, guest_email: g?.email };
  }));
  res.json(result.sort((a,b) => b.id - a.id));
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
