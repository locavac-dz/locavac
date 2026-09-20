const router   = require('express').Router();
const db       = require('../db');
const { pool } = require('../db');
const auth     = require('../middleware/auth');
const mailer   = require('../mailer');
const ws       = require('../ws');

const MAX_NIGHTS       = 90;
const MAX_ADVANCE_DAYS = 730;

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

  const numGuests = guests_count ? Number(guests_count) : 1;
  if (!Number.isInteger(numGuests) || numGuests < 1)
    return res.status(400).json({ error: 'Le nombre de voyageurs doit être au moins 1.' });
  if (listing.guests && numGuests > listing.guests)
    return res.status(400).json({ error: `Ce logement accepte au maximum ${listing.guests} voyageur(s).` });

  const n = nights(check_in, check_out);
  if (n < 1) return res.status(400).json({ error: "La date de départ doit être après la date d'arrivée." });
  // Une réservation non payée bloque le calendrier : bornes raisonnables sur la durée et l'anticipation
  if (n > MAX_NIGHTS)
    return res.status(400).json({ error: `Un séjour ne peut pas dépasser ${MAX_NIGHTS} nuits.` });
  if (nights(today, check_in) > MAX_ADVANCE_DAYS)
    return res.status(400).json({ error: `Les réservations sont ouvertes au maximum ${MAX_ADVANCE_DAYS} jours à l'avance.` });

  // Vérification blocked_ranges (données JS/JSON, hors transaction)
  const ranges = Array.isArray(listing.blocked_ranges) ? listing.blocked_ranges
    : (listing.blocked_ranges ? JSON.parse(listing.blocked_ranges) : []);
  if (ranges.some(b => b.start < check_out && b.end > check_in))
    return res.status(409).json({ error: "Ces dates sont indisponibles (logement bloqué par l'hôte)." });

  const total = listing.price * n;

  // Transaction avec advisory lock pour éviter la race condition (double-réservation)
  const client = await pool.connect();
  let resa;
  try {
    await client.query('BEGIN');
    // Verrou exclusif par logement — bloque les réservations concurrentes sur le même lid
    await client.query('SELECT pg_advisory_xact_lock($1)', [lid]);
    // Re-vérification de disponibilité à l'intérieur de la transaction
    const conflict = await client.query(
      `SELECT id FROM reservations WHERE listing_id = $1 AND status != 'cancelled' AND check_in < $2 AND check_out > $3 LIMIT 1`,
      [lid, check_out, check_in]
    );
    if (conflict.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: "Ce logement n'est pas disponible pour ces dates." });
    }
    const result = await client.query(
      `INSERT INTO reservations (listing_id, guest_id, check_in, check_out, guests_count, total_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
      [lid, req.user.id, check_in, check_out, numGuests, total]
    );
    resa = result.rows[0];
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

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

// GET /api/reservations/mine — batch listings + reviews pour éviter N+1
router.get('/mine', auth, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const resas = await db.reservations.findByGuest(req.user.id);
  resas.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const total = resas.length;
  const pages = Math.ceil(total / limit) || 0;
  const paged = resas.slice((page - 1) * limit, page * limit);

  const listingIds = [...new Set(paged.map(r => r.listing_id))];
  const [listings, reviewedIds] = await Promise.all([
    db.listings.findByIds(listingIds),
    db.reviews.reviewedListingIds(req.user.id),
  ]);
  const listingMap = Object.fromEntries(listings.map(l => [l.id, l]));
  const now = new Date();

  const data = paged.map(r => {
    const l      = listingMap[r.listing_id];
    const stayed = r.status === 'confirmed' && new Date(r.check_out) < now;
    return {
      ...r,
      title: l?.title, location: l?.location, image: l?.image,
      price_per_night: l?.price, cancellation_policy: l?.cancellation_policy || 'flexible',
      can_review: stayed && !reviewedIds.has(r.listing_id),
    };
  });
  res.json({ data, pagination: { page, limit, total, pages } });
});

// GET /api/reservations/hosting — batch guests pour éviter N+1 (listings déjà en mémoire)
router.get('/hosting', auth, async (req, res) => {
  const myListings = await db.listings.findByHost(req.user.id);
  const myIds      = myListings.map(l => l.id);
  const resas      = await db.reservations.findByListings(myIds);
  resas.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const listingMap = Object.fromEntries(myListings.map(l => [l.id, l]));
  const guestIds   = [...new Set(resas.map(r => r.guest_id))];
  const guests     = await db.users.findByIds(guestIds);
  const guestMap   = Object.fromEntries(guests.map(g => [g.id, g]));

  const result = resas.map(r => {
    const l = listingMap[r.listing_id];
    const g = guestMap[r.guest_id];
    return { ...r, title: l?.title, location: l?.location, guest_name: g?.name, guest_email: g?.email };
  });
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

  if (status === 'confirmed') {
    // Une réservation annulée ou déjà confirmée ne se « re-confirme » pas (dates peut-être relouées entre-temps)
    if (resa.status !== 'pending')
      return res.status(409).json({ error: 'Seule une réservation en attente peut être confirmée.' });
    // Vérifier qu'un paiement valide existe avant confirmation
    const paid = await db.payments.findSuccessByReservation(resa.id);
    if (!paid) return res.status(402).json({ error: 'Impossible de confirmer : aucun paiement valide enregistré pour cette réservation.' });
  }

  let refund = null;
  if (status === 'cancelled') {
    if (resa.status === 'cancelled')
      return res.status(409).json({ error: 'Cette réservation est déjà annulée.' });
    // Séjour terminé : l'annuler effacerait un revenu acquis par l'hôte
    const startOfToday = new Date(new Date().toISOString().slice(0, 10));
    if (new Date(resa.check_out) < startOfToday)
      return res.status(400).json({ error: 'Un séjour terminé ne peut plus être annulé.' });

    const policy = listing?.cancellation_policy || 'flexible';
    refund = calcRefund(policy, resa.total_price, resa.check_in);
    // La politique d'annulation protège l'hôte contre un désistement du voyageur ; si c'est l'hôte
    // qui annule, le voyageur n'y est pour rien : remboursement intégral.
    if (!isGuest) refund.pct = 100;
    refund.cancelled_by = isGuest ? 'guest' : 'host';
    refund.amount = Math.round(Number(resa.total_price) * refund.pct / 100);
  }

  await db.reservations.updateById(resa.id, { status });

  // Mettre à jour le paiement lors d'une annulation avec remboursement
  if (refund && resa.payment_id) {
    const payStatus = refund.pct === 100 ? 'refunded' : refund.pct > 0 ? 'partial_refund' : 'no_refund';
    if (payStatus !== 'no_refund') {
      await db.payments.updateById(resa.payment_id, {
        status: payStatus,
        refund_amount: refund.amount,
        refund_pct:    refund.pct,
      });
    }
  }

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
// Exportés pour les tests unitaires
module.exports.calcRefund = calcRefund;
module.exports.nights     = nights;
