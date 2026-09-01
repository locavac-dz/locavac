const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const mailer = require('../mailer');

function nights(checkIn, checkOut) {
  return Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
}

function calcRefund(policy, totalPrice, checkIn) {
  const daysLeft = Math.ceil((new Date(checkIn) - new Date()) / 86400000);
  if (policy === 'flexible') {
    return { pct: daysLeft >= 1 ? 100 : 0, days: daysLeft };
  }
  if (policy === 'moderee') {
    if (daysLeft >= 5) return { pct: 100, days: daysLeft };
    if (daysLeft >= 2) return { pct: 50,  days: daysLeft };
    return { pct: 0, days: daysLeft };
  }
  // stricte
  if (daysLeft >= 7) return { pct: 50, days: daysLeft };
  return { pct: 0, days: daysLeft };
}

async function isAvailable(listingId, checkIn, checkOut, excludeId = null) {
  const conflict = await db.reservations.findOne(r =>
    r.listing_id === listingId &&
    r.status !== 'cancelled' &&
    r.id !== excludeId &&
    r.check_in < checkOut &&
    r.check_out > checkIn
  );
  return !conflict;
}

// POST /api/reservations
router.post('/', auth, async (req, res) => {
  const { listing_id, check_in, check_out, guests_count } = req.body;
  if (!listing_id || !check_in || !check_out)
    return res.status(400).json({ error: "Logement, dates d'arrivée et de départ requis." });

  const lid     = Number(listing_id);
  const listing = await db.listings.findOne(l => l.id === lid && l.available);
  if (!listing) return res.status(404).json({ error: 'Logement introuvable ou indisponible.' });
  if (listing.host_id === req.user.id)
    return res.status(400).json({ error: 'Vous ne pouvez pas réserver votre propre logement.' });

  const n = nights(check_in, check_out);
  if (n < 1) return res.status(400).json({ error: "La date de départ doit être après la date d'arrivée." });
  if (!await isAvailable(lid, check_in, check_out))
    return res.status(409).json({ error: "Ce logement n'est pas disponible pour ces dates." });

  const ranges = Array.isArray(listing.blocked_ranges) ? listing.blocked_ranges
    : (listing.blocked_ranges ? JSON.parse(listing.blocked_ranges) : []);
  if (ranges.some(b => b.start < check_out && b.end > check_in))
    return res.status(409).json({ error: "Ces dates sont indisponibles (logement bloqué par l'hôte)." });

  const total = listing.price * n;
  const resa  = await db.reservations.insert({
    listing_id: lid, guest_id: req.user.id, check_in, check_out,
    guests_count: guests_count || 1, total_price: total, status: 'pending',
  });

  const guest = await db.users.findOne(u => u.id === req.user.id);
  const host  = await db.users.findOne(u => u.id === listing.host_id);
  mailer.mailReservationCreated({
    guestName: guest.name, guestEmail: guest.email,
    listingTitle: listing.title, checkIn: check_in, checkOut: check_out,
    total, nights: n,
  });
  if (host) mailer.mailNewReservationToHost({
    hostName: host.name, hostEmail: host.email, guestName: guest.name,
    listingTitle: listing.title, checkIn: check_in, checkOut: check_out,
    total, nights: n,
  });

  res.status(201).json({ id: resa.id, total_price: total, nights: n, status: 'pending' });
});

// GET /api/reservations/mine
router.get('/mine', auth, async (req, res) => {
  const resas = await db.reservations.find(r => r.guest_id === req.user.id);
  resas.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const now = new Date();
  const result = await Promise.all(resas.map(async r => {
    const l = await db.listings.findOne(x => x.id === r.listing_id);
    const stayed = r.status === 'confirmed' && new Date(r.check_out) < now;
    let can_review = false;
    if (stayed) {
      const existing = await db.reviews.findOne(rv => rv.listing_id === r.listing_id && (rv.author_id === req.user.id || rv.user_id === req.user.id));
      can_review = !existing;
    }
    return { ...r, title: l?.title, location: l?.location, image: l?.image, price_per_night: l?.price, can_review };
  }));
  res.json(result);
});

// GET /api/reservations/hosting
router.get('/hosting', auth, async (req, res) => {
  const myListings = await db.listings.find(l => l.host_id === req.user.id);
  const myIds = myListings.map(l => l.id);
  const resas = await db.reservations.find(r => myIds.includes(r.listing_id));
  resas.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const result = await Promise.all(resas.map(async r => {
    const l = await db.listings.findOne(x => x.id === r.listing_id);
    const g = await db.users.findOne(u => u.id === r.guest_id);
    return { ...r, title: l?.title, location: l?.location, guest_name: g?.name, guest_email: g?.email };
  }));
  res.json(result);
});

// PATCH /api/reservations/:id/status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  if (!['confirmed', 'cancelled'].includes(status))
    return res.status(400).json({ error: 'Statut invalide.' });

  const resa = await db.reservations.findOne(r => r.id === Number(req.params.id));
  if (!resa) return res.status(404).json({ error: 'Réservation introuvable.' });

  const listing = await db.listings.findOne(l => l.id === resa.listing_id);
  const isHost  = listing?.host_id === req.user.id;
  const isGuest = resa.guest_id === req.user.id;
  if (!isHost && !isGuest) return res.status(403).json({ error: 'Accès refusé.' });
  if (isGuest && status === 'confirmed') return res.status(403).json({ error: "Seul l'hôte peut confirmer." });

  let refund = null;
  if (status === 'cancelled' && resa.status !== 'cancelled') {
    const policy = listing?.cancellation_policy || 'flexible';
    refund = calcRefund(policy, resa.total_price, resa.check_in);
    refund.amount = Math.round(Number(resa.total_price) * refund.pct / 100);
  }

  await db.reservations.update(r => r.id === resa.id, { status });

  const guest = await db.users.findOne(u => u.id === resa.guest_id);
  const host  = await db.users.findOne(u => u.id === listing?.host_id);
  if (status === 'confirmed' && guest) {
    mailer.mailReservationConfirmed({
      guestName: guest.name, guestEmail: guest.email,
      listingTitle: listing.title, checkIn: resa.check_in, checkOut: resa.check_out,
      hostName: host?.name || 'Votre hôte', hostPhone: host?.phone,
    });
  }
  if (status === 'cancelled') {
    if (guest) mailer.mailReservationCancelled({ to: guest.email, name: guest.name, listingTitle: listing?.title, checkIn: resa.check_in, checkOut: resa.check_out });
    if (isGuest && host) mailer.mailReservationCancelled({ to: host.email, name: host.name, listingTitle: listing?.title, checkIn: resa.check_in, checkOut: resa.check_out });
  }

  res.json({ ok: true, status, refund });
});

module.exports = router;
