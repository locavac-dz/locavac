const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const mailer = require('../mailer');
const ws     = require('../ws');

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
  const conflict = await db.reservations.findConflict(listingId, checkIn, checkOut, excludeId);
  return !conflict;
}

// POST /api/reservations
router.post('/', auth, async (req, res) => {
  const { listing_id, check_in, check_out, guests_count } = req.body;
  if (!listing_id || !check_in || !check_out)
    return res.status(400).json({ error: "Logement, dates d'arrivée et de départ requis." });

  // Validation format et cohérence des dates
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(check_in) || !DATE_RE.test(check_out))
    return res.status(400).json({ error: 'Format de date invalide. Utilisez AAAA-MM-JJ.' });
  const today = new Date().toISOString().slice(0, 10);
  if (check_in < today)
    return res.status(400).json({ error: "La date d'arrivée ne peut pas être dans le passé." });
  if (check_out <= check_in)
    return res.status(400).json({ error: "La date de départ doit être après la date d'arrivée." });

  const lid     = Number(listing_id);
  const listing = await db.listings.findById(lid);
  if (!listing || !listing.available) return res.status(404).json({ error: 'Logement introuvable ou indisponible.' });
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
  const resa  = await db.reservations.create({
    listing_id: lid, guest_id: req.user.id, check_in, check_out,
    guests_count: guests_count || 1, total_price: total, status: 'pending',
  });

  const guest = await db.users.findById(req.user.id);
  const host  = await db.users.findById(listing.host_id);
  mailer.mailReservationCreated({
    guestName: guest.name, guestEmail: guest.email,
    listingTitle: listing.title, checkIn: check_in, checkOut: check_out,
    total, nights: n,
  });
  if (host) {
    mailer.mailNewReservationToHost({
      hostName: host.name, hostEmail: host.email, guestName: guest.name,
      listingTitle: listing.title, checkIn: check_in, checkOut: check_out,
      total, nights: n,
    });
    // Notifier l'hôte en temps réel via WebSocket
    ws.send(listing.host_id, {
      type: 'new_reservation',
      guest_name: guest.name,
      listing_title: listing.title,
      check_in, check_out,
      nights: n,
    });
  }

  res.status(201).json({ id: resa.id, total_price: total, nights: n, status: 'pending' });
});

// GET /api/reservations/mine
router.get('/mine', auth, async (req, res) => {
  const resas = await db.reservations.findByGuest(req.user.id);
  resas.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const now = new Date();
  const result = await Promise.all(resas.map(async r => {
    const l = await db.listings.findById(r.listing_id);
    const stayed = r.status === 'confirmed' && new Date(r.check_out) < now;
    let can_review = false;
    if (stayed) {
      const existing = await db.reviews.findOne(r.listing_id, req.user.id);
      can_review = !existing;
    }
    return { ...r, title: l?.title, location: l?.location, image: l?.image, price_per_night: l?.price, cancellation_policy: l?.cancellation_policy || 'flexible', can_review };
  }));
  res.json(result);
});

// GET /api/reservations/hosting
router.get('/hosting', auth, async (req, res) => {
  const myListings = await db.listings.findByHost(req.user.id);
  const myIds = myListings.map(l => l.id);
  const resas = await db.reservations.findByListings(myIds);
  resas.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const result = await Promise.all(resas.map(async r => {
    const l = await db.listings.findById(r.listing_id);
    const g = await db.users.findById(r.guest_id);
    return { ...r, title: l?.title, location: l?.location, guest_name: g?.name, guest_email: g?.email };
  }));
  res.json(result);
});

// PATCH /api/reservations/:id/status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  if (!['confirmed', 'cancelled'].includes(status))
    return res.status(400).json({ error: 'Statut invalide.' });

  const resa = await db.reservations.findById(Number(req.params.id));
  if (!resa) return res.status(404).json({ error: 'Réservation introuvable.' });

  const listing = await db.listings.findById(resa.listing_id);
  const isHost  = listing?.host_id === req.user.id;
  const isGuest = resa.guest_id === req.user.id;
  if (!isHost && !isGuest) return res.status(403).json({ error: 'Accès refusé.' });
  if (isGuest && status === 'confirmed') return res.status(403).json({ error: "Seul l'hôte peut confirmer." });

  // Vérifier qu'un paiement valide existe avant confirmation
  if (status === 'confirmed') {
    const paid = await db.payments.findSuccessByReservation(resa.id);
    if (!paid) return res.status(402).json({ error: 'Impossible de confirmer : aucun paiement valide enregistré pour cette réservation.' });
  }

  let refund = null;
  if (status === 'cancelled' && resa.status !== 'cancelled') {
    const policy = listing?.cancellation_policy || 'flexible';
    refund = calcRefund(policy, resa.total_price, resa.check_in);
    refund.amount = Math.round(Number(resa.total_price) * refund.pct / 100);
  }

  await db.reservations.updateById(resa.id, { status });

  const guest = await db.users.findById(resa.guest_id);
  const host  = listing ? await db.users.findById(listing.host_id) : null;
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

  // Notifier le voyageur en temps réel (confirmation ou annulation par l'hôte)
  if (!isGuest) {
    ws.send(resa.guest_id, {
      type: 'reservation_status_changed',
      reservation_id: resa.id,
      status,
      listing_title: listing?.title,
    });
  }

  res.json({ ok: true, status, refund });
});

module.exports = router;
