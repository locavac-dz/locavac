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
  const now       = new Date();
  const tomorrow  = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tStr      = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD

  const resas = await db.reservations.find(r =>
    r.status === 'confirmed' &&
    String(r.check_in) === tStr &&
    !r.checkin_reminded
  );

  for (const r of resas) {
    const guest   = await db.users.findOne(u => u.id === r.guest_id);
    const listing = await db.listings.findOne(l => l.id === r.listing_id);
    const host    = listing ? await db.users.findOne(u => u.id === listing.host_id) : null;
    if (guest && listing) {
      await mailer.mailCheckInReminder({
        guestName:  guest.name,
        guestEmail: guest.email,
        listingTitle: listing.title,
        checkIn:    String(r.check_in),
        hostName:   host?.name  || 'Votre hôte',
        hostPhone:  host?.phone || null,
      });
    }
    await db.reservations.update(res => res.id === r.id, { checkin_reminded: true });
  }
}

// Rappel avis : envoyé le lendemain du check_out (entre H+0 et H+24)
async function sendReviewReminders() {
  const now       = new Date();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const yStr      = yesterday.toISOString().slice(0, 10);

  const resas = await db.reservations.find(r =>
    r.status === 'confirmed' &&
    String(r.check_out) === yStr &&
    !r.review_reminded
  );

  for (const r of resas) {
    // Ne pas envoyer si l'avis existe déjà
    const hasReview = await db.reviews.findOne(rv =>
      rv.listing_id === r.listing_id &&
      (rv.author_id === r.guest_id || rv.user_id === r.guest_id)
    );
    const guest   = await db.users.findOne(u => u.id === r.guest_id);
    const listing = await db.listings.findOne(l => l.id === r.listing_id);
    if (guest && listing && !hasReview) {
      await mailer.mailReviewReminder({
        guestName:    guest.name,
        guestEmail:   guest.email,
        listingTitle: listing.title,
        listingId:    listing.id,
      });
    }
    await db.reservations.update(res => res.id === r.id, { review_reminded: true });
  }
}

console.log('[Cron] Rappels check-in et avis actifs (toutes les heures)');
