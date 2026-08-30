const router = require('express').Router();
const crypto = require('crypto');
const db     = require('../db');
const auth   = require('../middleware/auth');
const mailer = require('../mailer');

async function notifyPaymentConfirmed(payment, reservation) {
  const guest   = await db.users.findOne(u => u.id === payment.user_id);
  const listing = await db.listings.findOne(l => l.id === reservation.listing_id);
  const host    = listing ? await db.users.findOne(u => u.id === listing.host_id) : null;
  if (guest && listing) mailer.mailPaymentConfirmedToGuest({
    guestName: guest.name, guestEmail: guest.email, listingTitle: listing.title,
    checkIn: reservation.check_in, checkOut: reservation.check_out,
    amount: payment.amount, reference: payment.reference, method: payment.method,
  });
  if (host && listing) mailer.mailNewReservationToHost({
    hostName: host.name, hostEmail: host.email,
    guestName: guest?.name || 'Voyageur', listingTitle: listing.title,
    checkIn: reservation.check_in, checkOut: reservation.check_out,
    total: payment.amount,
    nights: Math.round((new Date(reservation.check_out) - new Date(reservation.check_in)) / 86400000),
  });
}

async function notifyVirementToHost(payment, reservation) {
  const guest   = await db.users.findOne(u => u.id === payment.user_id);
  const listing = await db.listings.findOne(l => l.id === reservation.listing_id);
  const host    = listing ? await db.users.findOne(u => u.id === listing.host_id) : null;
  if (host && listing) mailer.mailVirementToHost({
    hostName: host.name, hostEmail: host.email, guestName: guest?.name || 'Voyageur',
    listingTitle: listing.title, amount: payment.amount, reference: payment.reference,
    checkIn: reservation.check_in, checkOut: reservation.check_out,
  });
}

function genRef() {
  return 'DZ' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function maskCard(number) {
  const clean = number.replace(/\s/g, '');
  return '**** **** **** ' + clean.slice(-4);
}
function detectCard(number) {
  const n = number.replace(/\s/g, '');
  if (/^628[08]/.test(n)) return 'edahabia';
  if (/^[45]/.test(n))    return 'cib';
  return 'unknown';
}
function luhnCheck(number) {
  const digits = number.replace(/\s/g, '').split('').reverse().map(Number);
  const sum = digits.reduce((acc, d, i) => {
    if (i % 2 !== 0) { d *= 2; if (d > 9) d -= 9; }
    return acc + d;
  }, 0);
  return sum % 10 === 0;
}
function simulateProcessing(cardNumber) {
  const n = cardNumber.replace(/\s/g, '');
  if (!luhnCheck(n))            return { success: false, code: 'INVALID_CARD',  msg: 'Numéro de carte invalide.' };
  const last4 = n.slice(-4);
  if (last4 === '0000') return { success: false, code: 'REFUSED',      msg: 'Paiement refusé par la banque.' };
  if (last4 === '9999') return { success: false, code: 'TIMEOUT',      msg: 'Délai dépassé. Réessayez.' };
  if (last4 === '8888') return { success: false, code: 'INSUFFICIENT', msg: 'Solde insuffisant.' };
  return { success: true, code: 'APPROVED', msg: 'Paiement approuvé.' };
}

const VALID_METHODS = ['cib', 'edahabia', 'baridimob', 'virement', 'especes'];

// POST /api/payments/init
router.post('/init', auth, async (req, res) => {
  const { reservation_id, method } = req.body;
  if (!reservation_id || !method)
    return res.status(400).json({ error: 'reservation_id et method requis.' });
  if (!VALID_METHODS.includes(method))
    return res.status(400).json({ error: 'Méthode invalide. Valeurs : ' + VALID_METHODS.join(', ') + '.' });

  const resa = await db.reservations.findOne(r => r.id === Number(reservation_id) && r.guest_id === req.user.id);
  if (!resa) return res.status(404).json({ error: 'Réservation introuvable.' });
  if (resa.status === 'confirmed')
    return res.status(409).json({ error: 'Cette réservation est déjà payée.' });

  await db.payments.update(
    p => p.reservation_id === resa.id && p.status === 'pending',
    { status: 'cancelled' }
  );

  const payment = await db.payments.insert({
    reservation_id: resa.id, user_id: req.user.id,
    amount: resa.total_price, currency: 'DZD', method,
    status: 'pending', reference: genRef(),
  });

  res.status(201).json({
    payment_id: payment.id, reference: payment.reference,
    amount: payment.amount, currency: 'DZD', method,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
});

// POST /api/payments/:id/process
router.post('/:id/process', auth, async (req, res) => {
  const payment = await db.payments.findOne(p => p.id === Number(req.params.id) && p.user_id === req.user.id);
  if (!payment) return res.status(404).json({ error: 'Paiement introuvable.' });
  if (!['pending', 'pending_otp'].includes(payment.status))
    return res.status(409).json({ error: "Ce paiement n'est plus actif." });

  // ── Espèces à l'arrivée ──────────────────────────────────
  if (payment.method === 'especes') {
    await db.payments.update(p => p.id === payment.id, { status: 'success', processed_at: new Date().toISOString() });
    await db.reservations.update(r => r.id === payment.reservation_id, { status: 'confirmed', payment_id: payment.id });
    const resa = await db.reservations.findOne(r => r.id === payment.reservation_id);
    notifyPaymentConfirmed({ ...payment, status: 'success' }, resa).catch(() => {});
    return res.json({ success: true, reference: payment.reference, amount: payment.amount, message: 'Réservation confirmée. Paiement en espèces à l\'arrivée.' });
  }

  // ── Virement bancaire ────────────────────────────────────
  if (payment.method === 'virement') {
    await db.payments.update(p => p.id === payment.id, { status: 'pending_transfer', processed_at: new Date().toISOString() });
    const resa = await db.reservations.findOne(r => r.id === payment.reservation_id);
    notifyVirementToHost({ ...payment, status: 'pending_transfer' }, resa).catch(() => {});
    return res.json({ success: true, pending: true, reference: payment.reference, amount: payment.amount, message: 'Votre réservation sera confirmée après réception du virement (24–48h ouvrables).' });
  }

  // ── BaridiMob ────────────────────────────────────────────
  if (payment.method === 'baridimob') {
    const { phone, otp } = req.body;
    if (!phone) return res.status(400).json({ error: 'Numéro de téléphone requis.' });
    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (!/^(05|06|07)\d{8}$/.test(cleanPhone))
      return res.status(400).json({ error: 'Numéro algérien invalide (05/06/07 + 8 chiffres requis).' });

    if (!otp) {
      // Phase 1 : envoi OTP (simulé)
      await db.payments.update(p => p.id === payment.id, { status: 'pending_otp' });
      return res.json({ otp_sent: true, message: `Code OTP envoyé au ${cleanPhone}` });
    }

    // Phase 2 : validation OTP
    if (!/^\d{6}$/.test(otp))
      return res.status(400).json({ error: 'Code OTP invalide (6 chiffres requis).' });
    if (otp === '000000') {
      await db.payments.update(p => p.id === payment.id, { status: 'failed', error_code: 'INSUFFICIENT', error_msg: 'Solde BaridiMob insuffisant.' });
      return res.status(402).json({ success: false, code: 'INSUFFICIENT', error: 'Solde BaridiMob insuffisant.' });
    }

    await db.payments.update(p => p.id === payment.id, { status: 'success', card_masked: cleanPhone, card_type: 'baridimob', processed_at: new Date().toISOString() });
    await db.reservations.update(r => r.id === payment.reservation_id, { status: 'confirmed', payment_id: payment.id });
    const resa = await db.reservations.findOne(r => r.id === payment.reservation_id);
    notifyPaymentConfirmed({ ...payment, status: 'success' }, resa).catch(() => {});
    return res.json({ success: true, reference: payment.reference, amount: payment.amount, message: 'Paiement BaridiMob approuvé.' });
  }

  // ── CIB / Edahabia (carte bancaire) ──────────────────────
  const { card_number, expiry, cvv, card_holder } = req.body;
  if (!card_number || !expiry || !cvv || !card_holder)
    return res.status(400).json({ error: 'Tous les champs carte sont requis.' });

  const cleanCard = card_number.replace(/\s/g, '');
  if (cleanCard.length < 16) return res.status(400).json({ error: 'Numéro de carte incomplet.' });

  const [expM, expY] = expiry.split('/').map(s => s.trim());
  if (new Date(2000 + Number(expY), Number(expM) - 1, 1) < new Date())
    return res.status(400).json({ error: 'Carte expirée.' });
  if (cvv.length < 3) return res.status(400).json({ error: 'CVV invalide.' });

  const cardType = detectCard(cleanCard);
  if (payment.method === 'edahabia' && cardType !== 'edahabia')
    return res.status(400).json({ error: "Cette carte n'est pas une carte Edahabia. Utilisez une carte débutant par 6280 ou 6288." });
  if (payment.method === 'cib' && cardType === 'edahabia')
    return res.status(400).json({ error: 'Cette carte est Edahabia. Sélectionnez le paiement Edahabia.' });

  const result = simulateProcessing(cleanCard);
  if (result.success) {
    await db.payments.update(p => p.id === payment.id, { status: 'success', card_masked: maskCard(cleanCard), card_type: cardType, processed_at: new Date().toISOString() });
    await db.reservations.update(r => r.id === payment.reservation_id, { status: 'confirmed', payment_id: payment.id });
    const resa = await db.reservations.findOne(r => r.id === payment.reservation_id);
    notifyPaymentConfirmed({ ...payment, status: 'success' }, resa).catch(() => {});
    res.json({ success: true, reference: payment.reference, amount: payment.amount, card_masked: maskCard(cleanCard), message: result.msg });
  } else {
    await db.payments.update(p => p.id === payment.id, { status: 'failed', error_code: result.code, error_msg: result.msg });
    res.status(402).json({ success: false, code: result.code, error: result.msg });
  }
});

// GET /api/payments/:id/status
router.get('/:id/status', auth, async (req, res) => {
  const payment = await db.payments.findOne(p => p.id === Number(req.params.id) && p.user_id === req.user.id);
  if (!payment) return res.status(404).json({ error: 'Paiement introuvable.' });
  res.json({ id: payment.id, reference: payment.reference, status: payment.status, amount: payment.amount, method: payment.method, card_masked: payment.card_masked, processed_at: payment.processed_at, error_msg: payment.error_msg });
});

// GET /api/payments/reservation/:resa_id
router.get('/reservation/:resa_id', auth, async (req, res) => {
  const payments = await db.payments.find(p => p.reservation_id === Number(req.params.resa_id) && p.user_id === req.user.id);
  payments.sort((a, b) => b.id - a.id);
  res.json(payments);
});

module.exports = router;
