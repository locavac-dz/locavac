const router = require('express').Router();
const db     = require('../db');
const admin  = require('../middleware/admin');

router.use(admin);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  const users    = await db.users.find();
  const listings = await db.listings.find();
  const resas    = await db.reservations.find();
  const payments = await db.payments.find(p => p.status === 'success');
  const messages = await db.messages.find();
  const totalRevenue = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const thisMonth    = new Date().toISOString().slice(0, 7);
  const newUsers     = users.filter(u => String(u.created_at).startsWith(thisMonth)).length;

  res.json({
    users:        { total: users.length, new_this_month: newUsers, hosts: users.filter(u => u.is_host).length, admins: users.filter(u => u.is_admin).length },
    listings:     { total: listings.length, active: listings.filter(l => l.available).length, inactive: listings.filter(l => !l.available).length },
    reservations: { total: resas.length, confirmed: resas.filter(r => r.status === 'confirmed').length, pending: resas.filter(r => r.status === 'pending').length, cancelled: resas.filter(r => r.status === 'cancelled').length },
    revenue:      { total: totalRevenue, transactions: payments.length },
    messages:     { total: messages.length },
  });
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const { q, role } = req.query;
  let users = await db.users.find();
  if (q)             { const s = q.toLowerCase(); users = users.filter(u => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)); }
  if (role === 'host')   users = users.filter(u => u.is_host);
  if (role === 'admin')  users = users.filter(u => u.is_admin);
  if (role === 'banned') users = users.filter(u => u.banned);

  const result = await Promise.all(users.map(async u => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    is_host: u.is_host, is_admin: u.is_admin || false,
    verified: u.verified || false, banned: u.banned || false,
    id_document: u.id_document || null, id_verified: u.id_verified || false,
    created_at: u.created_at,
    listings_count:     await db.listings.count(l => l.host_id === u.id),
    reservations_count: await db.reservations.count(r => r.guest_id === u.id),
  })));
  res.json(result.sort((a,b) => a.id - b.id));
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', async (req, res) => {
  const uid = Number(req.params.id);
  if (uid === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre compte admin.' });
  const user = await db.users.findOne(u => u.id === uid);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const { banned, is_admin, verified, id_verified } = req.body;
  const changes = {};
  if (banned      !== undefined) changes.banned      = !!banned;
  if (is_admin    !== undefined) changes.is_admin    = !!is_admin;
  if (verified    !== undefined) changes.verified    = !!verified;
  if (id_verified !== undefined) changes.id_verified = !!id_verified;
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Aucun champ à modifier.' });
  await db.users.update(u => u.id === uid, changes);
  res.json({ ok: true, ...changes });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const uid = Number(req.params.id);
  if (uid === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' });
  const user = await db.users.findOne(u => u.id === uid);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  await db.listings.delete(l => l.host_id === uid);
  await db.reservations.delete(r => r.guest_id === uid);
  await db.messages.delete(m => m.from_id === uid || m.to_id === uid);
  await db.users.delete(u => u.id === uid);
  res.json({ ok: true });
});

// GET /api/admin/listings
router.get('/listings', async (req, res) => {
  const { q, status } = req.query;
  let listings = await db.listings.find();
  if (q)                listings = listings.filter(l => l.title.toLowerCase().includes(q.toLowerCase()) || l.location.toLowerCase().includes(q.toLowerCase()));
  if (status === 'active')   listings = listings.filter(l =>  l.available);
  if (status === 'inactive') listings = listings.filter(l => !l.available);

  const result = await Promise.all(listings.map(async l => {
    const host = await db.users.findOne(u => u.id === l.host_id);
    return {
      id: l.id, title: l.title, location: l.location, wilaya: l.wilaya,
      category: l.category, price: l.price, available: l.available,
      rating: l.rating, reviews: l.reviews, created_at: l.created_at,
      image: (l.photos && l.photos[0]) || l.image || '',
      host_name: host?.name || 'Inconnu', host_email: host?.email,
      reservations_count: await db.reservations.count(r => r.listing_id === l.id),
    };
  }));
  res.json(result.sort((a,b) => b.id - a.id));
});

// PATCH /api/admin/listings/:id
router.patch('/listings/:id', async (req, res) => {
  const lid = Number(req.params.id);
  if (!await db.listings.findOne(l => l.id === lid)) return res.status(404).json({ error: 'Annonce introuvable.' });
  const { available } = req.body;
  if (available !== undefined) await db.listings.update(l => l.id === lid, { available: !!available });
  res.json({ ok: true });
});

// DELETE /api/admin/listings/:id
router.delete('/listings/:id', async (req, res) => {
  const lid = Number(req.params.id);
  if (!await db.listings.findOne(l => l.id === lid)) return res.status(404).json({ error: 'Annonce introuvable.' });
  await db.listings.delete(l => l.id === lid);
  await db.reservations.delete(r => r.listing_id === lid);
  await db.reviews.delete(r => r.listing_id === lid);
  res.json({ ok: true });
});

// GET /api/admin/reservations
router.get('/reservations', async (req, res) => {
  const { status } = req.query;
  let resas = await db.reservations.find();
  if (status) resas = resas.filter(r => r.status === status);
  const result = await Promise.all(resas.slice(0, 100).map(async r => {
    const l = await db.listings.findOne(x => x.id === r.listing_id);
    const g = await db.users.findOne(u => u.id === r.guest_id);
    return { ...r, listing_title: l?.title, listing_location: l?.location, guest_name: g?.name, guest_email: g?.email };
  }));
  res.json(result.sort((a,b) => b.id - a.id));
});

module.exports = router;
