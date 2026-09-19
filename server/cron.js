const cron   = require('node-cron');
const db     = require('./db');
const mailer = require('./mailer');

// Tourne toutes les heures (hh:00)
cron.schedule('0 * * * *', async () => {
  try {
    await sendCheckInReminders();
    await sendReviewReminders();
  } catch (e) {
    console.error('[Cron]', e.message);
  }
});

// Rappel check-in : envoyé 24h avant la date d'arrivée (une seule fois, entre H-25 et H-23)
async function sendCheckInReminders() {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tStr     = tomorrow.toISOString().slice(0, 10);

  // JOIN direct pour éviter N+1 (guest + listing + host en une seule requête)
  const resas = (await db.pool.query(`
    SELECT r.id, r.check_in,
      g.name AS guest_name, g.email AS guest_email,
      l.title AS listing_title, l.id AS listing_id,
      h.name AS host_name, h.phone AS host_phone
    FROM reservations r
    JOIN users    g ON g.id = r.guest_id
    JOIN listings l ON l.id = r.listing_id
    LEFT JOIN users h ON h.id = l.host_id
    WHERE r.status = 'confirmed' AND r.check_in::date = $1
      AND NOT COALESCE(r.checkin_reminded, false)
  `, [tStr])).rows;

  for (const r of resas) {
    await mailer.mailCheckInReminder({
      guestName:    r.guest_name,
      guestEmail:   r.guest_email,
      listingTitle: r.listing_title,
      checkIn:      String(r.check_in),
      hostName:     r.host_name  || 'Votre hôte',
      hostPhone:    r.host_phone || null,
    });
    await db.reservations.updateById(r.id, { checkin_reminded: true });
  }
}

// Rappel avis : envoyé le lendemain du check_out (entre H+0 et H+24)
async function sendReviewReminders() {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yStr      = yesterday.toISOString().slice(0, 10);

  // JOIN direct pour éviter N+1 — exclut les séjours déjà commentés
  const resas = (await db.pool.query(`
    SELECT r.id, r.listing_id, r.guest_id,
      g.name AS guest_name, g.email AS guest_email,
      l.title AS listing_title
    FROM reservations r
    JOIN users    g ON g.id = r.guest_id
    JOIN listings l ON l.id = r.listing_id
    WHERE r.status = 'confirmed' AND r.check_out::date = $1
      AND NOT COALESCE(r.review_reminded, false)
      AND NOT EXISTS (
        SELECT 1 FROM reviews rv
        WHERE rv.listing_id = r.listing_id
          AND (rv.author_id = r.guest_id OR rv.user_id = r.guest_id)
      )
  `, [yStr])).rows;

  for (const r of resas) {
    await mailer.mailReviewReminder({
      guestName:    r.guest_name,
      guestEmail:   r.guest_email,
      listingTitle: r.listing_title,
      listingId:    r.listing_id,
    });
    await db.reservations.updateById(r.id, { review_reminded: true });
  }
}

console.log('[Cron] Rappels check-in et avis actifs (toutes les heures)');
