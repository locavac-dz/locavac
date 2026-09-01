const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

router.get('/host', auth, async (req, res) => {
  const myListings = await db.listings.find(l => l.host_id === req.user.id);
  const myIds      = myListings.map(l => l.id);

  const allResas  = await db.reservations.find(r => myIds.includes(r.listing_id));
  const confirmed = allResas.filter(r => r.status === 'confirmed');
  const pending   = allResas.filter(r => r.status === 'pending');
  const cancelled = allResas.filter(r => r.status === 'cancelled');

  const totalRevenue = confirmed.reduce((s, r) => s + Number(r.total_price || 0), 0);

  let bookedNights = 0;
  confirmed.forEach(r => {
    bookedNights += Math.max(0, Math.round((new Date(r.check_out) - new Date(r.check_in)) / 86400000));
  });
  const occupancyRate = myListings.length > 0
    ? Math.round((bookedNights / (myListings.length * 365)) * 100)
    : 0;

  const monthly = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthly[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`] = 0;
  }
  confirmed.forEach(r => {
    const key = String(r.check_in).slice(0, 7);
    if (monthly[key] !== undefined) monthly[key] += Number(r.total_price || 0);
  });

  const allReviews = await db.reviews.find(r => myIds.includes(r.listing_id));
  const avgRating  = allReviews.length
    ? Math.round(allReviews.reduce((s, r) => s + Number(r.rating), 0) / allReviews.length * 10) / 10
    : 0;

  const resaByListing = {};
  confirmed.forEach(r => { resaByListing[r.listing_id] = (resaByListing[r.listing_id] || 0) + 1; });
  const topId = Object.entries(resaByListing).sort((a,b) => b[1]-a[1])[0]?.[0];
  const topListing = topId ? myListings.find(l => l.id === Number(topId)) : null;

  res.json({
    listings_count: myListings.length,
    reservations:   { total: allResas.length, confirmed: confirmed.length, pending: pending.length, cancelled: cancelled.length },
    revenue:        { total: totalRevenue, monthly },
    occupancy_rate: occupancyRate,
    booked_nights:  bookedNights,
    avg_rating:     avgRating,
    reviews_count:  allReviews.length,
    top_listing:    topListing ? { id: topListing.id, title: topListing.title, bookings: resaByListing[topId] } : null,
  });
});

// GET /api/stats/host/earnings — relevé de compte hôte
router.get('/host/earnings', auth, async (req, res) => {
  const COMMISSION = 0.10; // 10% frais de plateforme
  const myListings = await db.listings.find(l => l.host_id === req.user.id);
  const myIds      = myListings.map(l => l.id);

  const confirmed = await db.reservations.find(r => myIds.includes(r.listing_id) && r.status === 'confirmed');

  const transactions = await Promise.all(confirmed.map(async r => {
    const listing = myListings.find(l => l.id === r.listing_id);
    const payment = await db.payments.findOne(p => p.id === r.payment_id && p.status === 'success');
    const gross   = Number(r.total_price || 0);
    const fee     = Math.round(gross * COMMISSION);
    const net     = gross - fee;
    return {
      reservation_id: r.id, listing_title: listing?.title || '—',
      check_in: r.check_in, check_out: r.check_out,
      gross, fee, net,
      method:  payment?.method || '—',
      paid_at: payment?.processed_at || r.created_at,
    };
  }));
  transactions.sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));

  const totalGross = transactions.reduce((s, t) => s + t.gross, 0);
  const totalFee   = transactions.reduce((s, t) => s + t.fee,   0);
  const totalNet   = transactions.reduce((s, t) => s + t.net,   0);

  const user = await db.users.findOne(u => u.id === req.user.id);
  res.json({
    summary:      { gross: totalGross, fee: totalFee, net: totalNet, commission_pct: COMMISSION * 100 },
    bank_info:    { rib: user?.rib || null, ccp: user?.ccp || null },
    transactions,
  });
});

// PATCH /api/stats/host/bank — enregistrer coordonnées bancaires
router.patch('/host/bank', auth, async (req, res) => {
  const { rib, ccp } = req.body;
  const changes = {};
  if (rib !== undefined) changes.rib = rib.trim() || null;
  if (ccp !== undefined) changes.ccp = ccp.trim() || null;
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'rib ou ccp requis.' });
  await db.users.update(u => u.id === req.user.id, changes);
  res.json({ ok: true });
});

// GET /api/stats/host/payouts — liste des demandes de virement de l'hôte
router.get('/host/payouts', auth, async (req, res) => {
  const list = await db.payouts.find(p => p.host_id === req.user.id);
  list.sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
  res.json(list);
});

// POST /api/stats/host/payout — demande de virement
router.post('/host/payout', auth, async (req, res) => {
  const COMMISSION = 0.10;
  const uid = req.user.id;

  // Calcul du solde disponible
  const myListings  = await db.listings.find(l => l.host_id === uid);
  const myIds       = myListings.map(l => l.id);
  const confirmed   = await db.reservations.find(r => myIds.includes(r.listing_id) && r.status === 'confirmed');
  const totalNet    = confirmed.reduce((s, r) => s + Math.round(Number(r.total_price || 0) * (1 - COMMISSION)), 0);
  const paidPayouts = await db.payouts.find(p => p.host_id === uid && (p.status === 'paid' || p.status === 'pending'));
  const alreadyOut  = paidPayouts.reduce((s, p) => s + Number(p.amount), 0);
  const available   = totalNet - alreadyOut;

  if (available < 1000)
    return res.status(400).json({ error: `Solde insuffisant. Minimum 1 000 DZD requis (disponible : ${available.toLocaleString('fr-DZ')} DZD).` });

  const user = await db.users.findOne(u => u.id === uid);
  if (!user?.rib && !user?.ccp)
    return res.status(400).json({ error: 'Veuillez enregistrer vos coordonnées bancaires (RIB ou CCP) avant de demander un virement.' });

  const payout = await db.payouts.insert({ host_id: uid, amount: available, status: 'pending' });
  res.status(201).json(payout);
});

// GET /api/admin/payouts — liste admin
router.get('/admin/payouts', auth, async (req, res) => {
  const user = await db.users.findOne(u => u.id === req.user.id);
  if (!user?.is_admin) return res.status(403).json({ error: 'Accès refusé.' });
  const list = await db.payouts.find();
  const enriched = await Promise.all(list.map(async p => {
    const host = await db.users.findOne(u => u.id === p.host_id);
    return { ...p, host_name: host?.name || '—', host_email: host?.email || '—', host_rib: host?.rib || null, host_ccp: host?.ccp || null };
  }));
  enriched.sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
  res.json(enriched);
});

// PATCH /api/admin/payouts/:id — approuver ou refuser
router.patch('/admin/payouts/:id', auth, async (req, res) => {
  const admin = await db.users.findOne(u => u.id === req.user.id);
  if (!admin?.is_admin) return res.status(403).json({ error: 'Accès refusé.' });
  const { status, admin_note } = req.body;
  if (!['paid', 'rejected'].includes(status))
    return res.status(400).json({ error: 'status doit être "paid" ou "rejected".' });
  const id = Number(req.params.id);
  const payout = await db.payouts.findOne(p => p.id === id);
  if (!payout) return res.status(404).json({ error: 'Demande introuvable.' });
  await db.payouts.update(p => p.id === id, {
    status,
    processed_at: new Date().toISOString(),
    admin_note: admin_note || null,
  });
  res.json({ ok: true });
});

module.exports = router;
