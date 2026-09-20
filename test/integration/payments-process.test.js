const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({
  mailPaymentConfirmedToGuest: jest.fn(),
  mailNewReservationToHost:    jest.fn(),
  mailVirementToHost:          jest.fn(),
}));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app    = require('../../server/index');
const db     = require('../mocks/db');
const mailer = require('../../server/mailer');

// id=2 est le voyageur propriétaire du paiement 600 / de la réservation 301 (25 000 DZD, 10→15 mars 2027)
const AUTH = { Authorization: `Bearer ${jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET)}` };

// Injecte un paiement pour le prochain appel à findByIdAndUser
const withPayment = (over = {}) => db.payments.findByIdAndUser.mockResolvedValueOnce({
  id: 600, reservation_id: 301, user_id: 2, amount: 25000, currency: 'DZD',
  method: 'cib', status: 'pending', reference: 'DZ-TEST-001', ...over,
});
const pay = body => request(app).post('/api/payments/600/process').set(AUTH).send(body);
// Laisse s'exécuter les notifications e-mail lancées sans await par la route
const flush = () => new Promise(r => setImmediate(r));

function luhnValid(s) {
  let sum = 0;
  [...s].reverse().forEach((c, i) => { let d = +c; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; });
  return sum % 10 === 0;
}
// Numéro de 16 chiffres valide (Luhn) avec préfixe et 4 derniers chiffres imposés
function cardNumber(prefix, last4) {
  const mid = 16 - prefix.length - last4.length;
  for (let i = 0; i < 10 ** Math.min(mid, 4); i++) {
    const n = prefix + String(i).padStart(mid, '0') + last4;
    if (luhnValid(n)) return n;
  }
  throw new Error('Aucun numéro Luhn valide généré');
}
const FUTURE_EXPIRY = `12/${String((new Date().getFullYear() + 3) % 100).padStart(2, '0')}`;
const card = (number, extra = {}) => ({ card_number: number, expiry: FUTURE_EXPIRY, cvv: '123', card_holder: 'Test User', ...extra });

const CIB_CARD = cardNumber('4111', '4242');
const EDA_CARD = cardNumber('6280', '1234');

afterEach(() => jest.clearAllMocks());

describe('POST /api/payments/init — détails', () => {
  test.each(['cib', 'edahabia', 'baridimob', 'virement', 'especes'])('201 pour le mode %s', async method => {
    const res = await request(app).post('/api/payments/init').set(AUTH).send({ reservation_id: 301, method });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 25000, currency: 'DZD', method });
    expect(db.payments.create).toHaveBeenCalledWith(expect.objectContaining({
      reservation_id: 301, user_id: 2, amount: 25000, currency: 'DZD', method, status: 'pending',
    }));
  });

  test('le montant vient de la réservation, jamais du client', async () => {
    const res = await request(app).post('/api/payments/init').set(AUTH)
      .send({ reservation_id: 301, method: 'cib', amount: 1 });
    expect(res.body.amount).toBe(25000);
    expect(db.payments.create.mock.calls[0][0].amount).toBe(25000);
  });

  test('annule les anciens paiements en attente de la réservation', async () => {
    await request(app).post('/api/payments/init').set(AUTH).send({ reservation_id: 301, method: 'cib' });
    const cancel = db.pool.query.mock.calls.find(c => /SET status = 'cancelled'/.test(c[0]));
    expect(cancel).toBeDefined();
    expect(cancel[1]).toEqual([301]);
  });

  test('expire dans ~15 minutes', async () => {
    const res = await request(app).post('/api/payments/init').set(AUTH).send({ reservation_id: 301, method: 'cib' });
    const delta = new Date(res.body.expires_at).getTime() - Date.now();
    expect(delta).toBeGreaterThan(14 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  test('reservation_id fourni en chaîne accepté', async () => {
    const res = await request(app).post('/api/payments/init').set(AUTH).send({ reservation_id: '301', method: 'especes' });
    expect(res.status).toBe(201);
  });
});

describe('Paiement d\'une réservation qui n\'est plus en attente', () => {
  test('init : 409 pour une réservation annulée, aucun paiement créé', async () => {
    db.reservations.findById.mockResolvedValueOnce({ id: 301, guest_id: 2, total_price: 25000, status: 'cancelled' });
    const res = await request(app).post('/api/payments/init').set(AUTH).send({ reservation_id: 301, method: 'cib' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/annulée/i);
    expect(db.payments.create).not.toHaveBeenCalled();
  });

  test.each(['cancelled', 'confirmed'])('process : réservation devenue "%s" depuis l\'initialisation → 409, paiement annulé, réservation intacte', async status => {
    withPayment({ method: 'especes' });
    db.reservations.findById.mockResolvedValueOnce({ id: 301, guest_id: 2, listing_id: 1, total_price: 25000, status });
    const res = await pay({});
    expect(res.status).toBe(409);
    expect(db.payments.updateById).toHaveBeenCalledTimes(1);
    expect(db.payments.updateById).toHaveBeenCalledWith(600, { status: 'cancelled' });
    expect(db.reservations.updateById).not.toHaveBeenCalled();
    expect(mailer.mailPaymentConfirmedToGuest).not.toHaveBeenCalled();
  });

  test('process : carte valide sur une réservation annulée — aucune confirmation (pas de double réservation)', async () => {
    withPayment({ method: 'cib' });
    db.reservations.findById.mockResolvedValueOnce({ id: 301, guest_id: 2, listing_id: 1, total_price: 25000, status: 'cancelled' });
    const res = await pay(card(CIB_CARD));
    expect(res.status).toBe(409);
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test('process : réservation supprimée entre-temps → 409', async () => {
    withPayment({ method: 'especes' });
    db.reservations.findById.mockResolvedValueOnce(null);
    expect((await pay({})).status).toBe(409);
  });
});

describe('POST /api/payments/:id/process — état du paiement', () => {
  test.each(['success', 'failed', 'cancelled', 'pending_transfer'])('409 si le paiement est déjà "%s"', async status => {
    withPayment({ status });
    const res = await pay(card(CIB_CARD));
    expect(res.status).toBe(409);
    expect(db.payments.updateById).not.toHaveBeenCalled();
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });
});

describe('Paiement en espèces à l\'arrivée', () => {
  test('200 : paiement réussi et réservation confirmée', async () => {
    withPayment({ method: 'especes' });
    const res = await pay({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, reference: 'DZ-TEST-001', amount: 25000 });
    expect(res.body.message).toMatch(/espèces/i);
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({ status: 'success' }));
    expect(db.reservations.updateById).toHaveBeenCalledWith(301, { status: 'confirmed', payment_id: 600 });
  });

  test('e-mails envoyés au voyageur et à l\'hôte (5 nuits)', async () => {
    withPayment({ method: 'especes' });
    await pay({});
    await flush();
    expect(mailer.mailPaymentConfirmedToGuest).toHaveBeenCalledWith(expect.objectContaining({
      guestName: 'Guest Test', guestEmail: 'guest@test.dz', amount: 25000, reference: 'DZ-TEST-001', method: 'especes',
    }));
    expect(mailer.mailNewReservationToHost).toHaveBeenCalledWith(expect.objectContaining({
      hostName: 'Hôte Test', hostEmail: 'host@test.dz', total: 25000, nights: 5,
    }));
  });
});

describe('Virement bancaire', () => {
  test('200 en attente : la réservation n\'est PAS confirmée avant réception du virement', async () => {
    withPayment({ method: 'virement' });
    const res = await pay({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, pending: true, reference: 'DZ-TEST-001' });
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({ status: 'pending_transfer' }));
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test('l\'hôte est prévenu du virement attendu', async () => {
    withPayment({ method: 'virement' });
    await pay({});
    await flush();
    expect(mailer.mailVirementToHost).toHaveBeenCalledWith(expect.objectContaining({
      hostEmail: 'host@test.dz', amount: 25000, reference: 'DZ-TEST-001',
    }));
    expect(mailer.mailPaymentConfirmedToGuest).not.toHaveBeenCalled();
  });
});

describe('BaridiMob', () => {
  test('400 sans numéro de téléphone', async () => {
    withPayment({ method: 'baridimob' });
    const res = await pay({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/téléphone/i);
  });

  test.each(['0123456789', '055512345', '08551234567', 'abcdefghij'])('400 pour le numéro %s', async phone => {
    withPayment({ method: 'baridimob' });
    const res = await pay({ phone });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/algérien/i);
  });

  test('phase 1 : OTP envoyé, numéro nettoyé (espaces et tirets), statut pending_otp', async () => {
    withPayment({ method: 'baridimob' });
    const res = await pay({ phone: '05 55-12 34-56' });
    expect(res.status).toBe(200);
    expect(res.body.otp_sent).toBe(true);
    expect(res.body.message).toContain('0555123456');
    expect(db.payments.updateById).toHaveBeenCalledWith(600, { status: 'pending_otp' });
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test.each(['123', '12345a', '1234567'])('400 pour l\'OTP invalide "%s"', async otp => {
    withPayment({ method: 'baridimob', status: 'pending_otp' });
    const res = await pay({ phone: '0555123456', otp });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/OTP/);
  });

  test('402 solde insuffisant (OTP 000000) : paiement en échec, réservation non confirmée', async () => {
    withPayment({ method: 'baridimob', status: 'pending_otp' });
    const res = await pay({ phone: '0555123456', otp: '000000' });
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ success: false, code: 'INSUFFICIENT' });
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({ status: 'failed', error_code: 'INSUFFICIENT' }));
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test('200 phase 2 : paiement réussi, réservation confirmée, numéro enregistré', async () => {
    withPayment({ method: 'baridimob', status: 'pending_otp' });
    const res = await pay({ phone: '0555123456', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({
      status: 'success', card_masked: '0555123456', card_type: 'baridimob',
    }));
    expect(db.reservations.updateById).toHaveBeenCalledWith(301, { status: 'confirmed', payment_id: 600 });
  });

  describe('garde production', () => {
    const OLD_ENV = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = OLD_ENV; delete process.env.BARIDIMOB_ENABLED; });

    test('503 en production tant que BARIDIMOB_ENABLED n\'est pas défini', async () => {
      process.env.NODE_ENV = 'production';
      withPayment({ method: 'baridimob' });
      const res = await pay({ phone: '0555123456' });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/BaridiMob/);
      expect(db.payments.updateById).not.toHaveBeenCalled();
    });

    test('garde levée uniquement avec BARIDIMOB_ENABLED=true : le flux continue (400 sans téléphone)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.BARIDIMOB_ENABLED = 'true';
      withPayment({ method: 'baridimob' });
      const res = await pay({});
      expect(res.status).toBe(400);
    });

    // Une chaîne non vide est « truthy » : sans comparaison stricte, BARIDIMOB_ENABLED=false activerait le mode
    test.each(['false', '0', '1', 'yes', 'TRUE', ' true'])('garde maintenue avec BARIDIMOB_ENABLED=%p', async value => {
      process.env.NODE_ENV = 'production';
      process.env.BARIDIMOB_ENABLED = value;
      withPayment({ method: 'baridimob' });
      const res = await pay({ phone: '0555123456' });
      expect(res.status).toBe(503);
      expect(db.payments.updateById).not.toHaveBeenCalled();
    });

    test('hors production, la garde ne s\'applique pas quelle que soit la variable', async () => {
      process.env.BARIDIMOB_ENABLED = 'false';
      withPayment({ method: 'baridimob' });
      const res = await pay({ phone: '0555123456' });
      expect(res.status).toBe(200);
      expect(res.body.otp_sent).toBe(true);
    });
  });
});

describe('Cartes CIB / Edahabia — contrôles', () => {
  test.each(['card_number', 'expiry', 'cvv', 'card_holder'])('400 si %s manquant', async field => {
    withPayment();
    const body = card(CIB_CARD);
    delete body[field];
    const res = await pay(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/champs carte/i);
  });

  test('400 si moins de 16 chiffres', async () => {
    withPayment();
    const res = await pay(card('4111 1111 1111'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/16 à 19/);
  });

  test.each(['13/30', '00/30', '1/30', '12-30', '12/2030'])('400 pour l\'expiration %s', async expiry => {
    withPayment();
    const res = await pay(card(CIB_CARD, { expiry }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MM\/AA/);
  });

  test.each(['12', '12345', 'abc'])('400 pour le CVV "%s"', async cvv => {
    withPayment();
    const res = await pay(card(CIB_CARD, { cvv }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CVV/);
  });

  test('CVV à 4 chiffres accepté', async () => {
    withPayment();
    const res = await pay(card(CIB_CARD, { cvv: '1234' }));
    expect(res.status).toBe(200);
  });

  test('400 : paiement Edahabia avec une carte CIB (préfixe 4)', async () => {
    withPayment({ method: 'edahabia' });
    const res = await pay(card(CIB_CARD));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Edahabia/);
  });

  test('400 : paiement CIB avec une carte Edahabia (préfixe 6280)', async () => {
    withPayment({ method: 'cib' });
    const res = await pay(card(EDA_CARD));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Edahabia/);
  });

  test('aucun contrôle de carte ne modifie le paiement ni la réservation', async () => {
    withPayment({ method: 'edahabia' });
    await pay(card(CIB_CARD));
    expect(db.payments.updateById).not.toHaveBeenCalled();
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });
});

describe('Cartes CIB / Edahabia — traitement', () => {
  test('200 CIB : carte masquée, type détecté, réservation confirmée', async () => {
    withPayment({ method: 'cib' });
    const res = await pay(card(CIB_CARD));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, reference: 'DZ-TEST-001', amount: 25000, card_masked: '**** **** **** 4242' });
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({
      status: 'success', card_masked: '**** **** **** 4242', card_type: 'cib',
    }));
    expect(db.reservations.updateById).toHaveBeenCalledWith(301, { status: 'confirmed', payment_id: 600 });
  });

  test('le numéro complet et le CVV ne sont jamais persistés ni renvoyés', async () => {
    withPayment({ method: 'cib' });
    const res = await pay(card(CIB_CARD));
    const persisted = JSON.stringify(db.payments.updateById.mock.calls) + JSON.stringify(db.reservations.updateById.mock.calls);
    expect(persisted).not.toContain(CIB_CARD);
    expect(persisted).not.toContain('"cvv"');
    expect(JSON.stringify(res.body)).not.toContain(CIB_CARD);
  });

  test('numéro saisi avec espaces accepté', async () => {
    withPayment({ method: 'cib' });
    const spaced = CIB_CARD.replace(/(\d{4})(?=\d)/g, '$1 ');
    const res = await pay(card(spaced));
    expect(res.status).toBe(200);
    expect(res.body.card_masked).toBe('**** **** **** 4242');
  });

  test.each(['6280', '6288'])('200 Edahabia avec une carte débutant par %s', async prefix => {
    withPayment({ method: 'edahabia' });
    const res = await pay(card(cardNumber(prefix, '1234')));
    expect(res.status).toBe(200);
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({ card_type: 'edahabia' }));
  });

  test('e-mails de confirmation envoyés après un paiement réussi', async () => {
    withPayment({ method: 'cib' });
    await pay(card(CIB_CARD));
    await flush();
    expect(mailer.mailPaymentConfirmedToGuest).toHaveBeenCalledTimes(1);
    expect(mailer.mailNewReservationToHost).toHaveBeenCalledTimes(1);
  });

  test('402 INVALID_CARD si la clé de Luhn est fausse', async () => {
    withPayment({ method: 'cib' });
    const bad = CIB_CARD.slice(0, -1) + ((Number(CIB_CARD.slice(-1)) + 1) % 10);
    expect(luhnValid(bad)).toBe(false);
    const res = await pay(card(bad));
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ success: false, code: 'INVALID_CARD' });
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({ status: 'failed', error_code: 'INVALID_CARD' }));
    expect(db.reservations.updateById).not.toHaveBeenCalled();
  });

  test.each([
    ['0000', 'REFUSED',      /refusé/i],
    ['9999', 'TIMEOUT',      /délai/i],
    ['8888', 'INSUFFICIENT', /solde/i],
  ])('402 pour une carte se terminant par %s (%s)', async (last4, code, msg) => {
    withPayment({ method: 'cib' });
    const res = await pay(card(cardNumber('4111', last4)));
    expect(res.status).toBe(402);
    expect(res.body.code).toBe(code);
    expect(res.body.error).toMatch(msg);
    expect(db.payments.updateById).toHaveBeenCalledWith(600, expect.objectContaining({ status: 'failed', error_code: code }));
    expect(db.reservations.updateById).not.toHaveBeenCalled();
    expect(mailer.mailPaymentConfirmedToGuest).not.toHaveBeenCalled();
  });
});
