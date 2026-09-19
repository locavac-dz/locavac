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

  const resas = await db.pool.query(
    `SELECT * FROM reservations WHERE status = 'confirmed' AND check_in::date = $1 AND NOT COALESCE(checkin_reminded, false)`,
    [tStr]
  ).then(r => r.rows);

  for (const r of resas) {
    const guest   = await db.users.findById(r.guest_id);
    const listing = await db.listings.findById(r.listing_id);
    const host    = listing ? await db.users.findById(listing.host_id) : null;
    if (guest && listing) {
      await mailer.mailCheckInReminder({
        guestName:    guest.name,
        guestEmail:   guest.email,
        listingTitle: listing.title,
        checkIn:      String(r.check_in),
        hostName:     host?.name  || 'Votre hôte',
        hostPhone:    host?.phone || null,
      });
    }
    await db.reservations.updateById(r.id, { checkin_reminded: true });
  }
}

// Rappel avis : envoyé le lendemain du check_out (entre H+0 et H+24)
async function sendReviewReminders() {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yStr      = yesterday.toISOString().slice(0, 10);

  const resas = await db.pool.query(
    `SELECT * FROM reservations WHERE status = 'confirmed' AND check_out::date = $1 AND NOT COALESCE(review_reminded, false)`,
    [yStr]
  ).then(r => r.rows);

  for (const r of resas) {
    const hasReview = await db.reviews.findOne(r.listing_id, r.guest_id);
    const guest     = await db.users.findById(r.guest_id);
    const listing   = await db.listings.findById(r.listing_id);
    if (guest && listing && !hasReview) {
      await mailer.mailReviewReminder({
        guestName:    guest.name,
        guestEmail:   guest.email,
        listingTitle: listing.title,
        listingId:    listing.id,
      });
    }
    await db.reservations.updateById(r.id, { review_reminded: true });
  }
}

console.log('[Cron] Rappels check-in et avis actifs (toutes les heures)');
