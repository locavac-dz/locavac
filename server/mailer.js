const nodemailer = require('nodemailer');

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Configuration SMTP depuis .env (optionnelle)
// Si EMAIL_HOST n'est pas défini, les emails sont ignorés silencieusement
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) return null;
  transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  if (!t || !to) return; // Silencieux si non configuré
  try {
    await t.sendMail({
      from: `"Locavac 🇩🇿" <${process.env.EMAIL_USER}>`,
      to, subject, html,
    });
  } catch (e) {
    console.error('[Mailer]', e.message);
  }
}

// ── Templates ────────────────────────────────────────────
function wrap(content) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f9f9f9;padding:0;margin:0">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)">
  <div style="background:#E8261A;padding:24px 32px;color:#fff;display:flex;align-items:center;gap:10px">
    <span style="font-size:26px;font-weight:900;letter-spacing:-1px;font-family:Georgia,serif">loca</span><span style="display:inline-block;width:8px;height:8px;background:#fff;border-radius:50%;margin:0 1px 6px;flex-shrink:0"></span><span style="font-size:26px;font-weight:300;letter-spacing:-1px;font-family:Georgia,serif">vac</span>
    <span style="margin-left:10px;font-size:12px;opacity:.8;font-weight:400">Location de vacances en Algérie</span>
  </div>
  <div style="padding:28px 32px">${content}</div>
  <div style="background:#f1f1f1;padding:16px 32px;font-size:12px;color:#999;text-align:center">
    © 2026 Locavac · Algérie · <a href="https://locavac.dz" style="color:#E8261A">Visiter le site</a>
  </div>
</div></body></html>`;
}

function mailReservationCreated({ guestName, guestEmail, listingTitle, checkIn, checkOut, total, nights }) {
  return sendMail({
    to: guestEmail, subject: `✅ Réservation reçue — ${listingTitle}`,
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Votre réservation est en cours 🎉</h2>
      <p>Bonjour <strong>${esc(guestName)}</strong>,</p>
      <p>Votre demande de réservation a bien été reçue. Elle est en attente de confirmation par l'hôte.</p>
      <div style="background:#f9f9f9;border-radius:10px;padding:16px;margin:20px 0">
        <p style="margin:4px 0"><strong>📍 Logement :</strong> ${esc(listingTitle)}</p>
        <p style="margin:4px 0"><strong>📅 Arrivée :</strong> ${esc(checkIn)}</p>
        <p style="margin:4px 0"><strong>📅 Départ :</strong> ${esc(checkOut)}</p>
        <p style="margin:4px 0"><strong>🌙 Nuits :</strong> ${nights}</p>
        <p style="margin:4px 0"><strong>💰 Total :</strong> ${Number(total).toLocaleString('fr-DZ')} DZD</p>
      </div>
      <p style="color:#666;font-size:13px">Vous serez notifié par email dès que l'hôte aura confirmé votre séjour.</p>
    `),
  });
}

function mailReservationConfirmed({ guestName, guestEmail, listingTitle, checkIn, checkOut, hostName, hostPhone }) {
  return sendMail({
    to: guestEmail, subject: `🏠 Réservation confirmée — ${listingTitle}`,
    html: wrap(`
      <h2 style="color:#0a7c47;margin-top:0">Votre séjour est confirmé ! ✅</h2>
      <p>Bonjour <strong>${esc(guestName)}</strong>,</p>
      <p>Bonne nouvelle ! Votre réservation à <strong>${esc(listingTitle)}</strong> est confirmée.</p>
      <div style="background:#e6f9f0;border-radius:10px;padding:16px;margin:20px 0">
        <p style="margin:4px 0"><strong>📅 Arrivée :</strong> ${esc(checkIn)}</p>
        <p style="margin:4px 0"><strong>📅 Départ :</strong> ${esc(checkOut)}</p>
        <p style="margin:4px 0"><strong>👤 Hôte :</strong> ${esc(hostName)}</p>
        ${hostPhone ? `<p style="margin:4px 0"><strong>📞 Contact :</strong> ${esc(hostPhone)}</p>` : ''}
      </div>
      <p>Bon séjour en Algérie ! 🇩🇿</p>
    `),
  });
}

function mailReservationCancelled({ to, name, listingTitle, checkIn, checkOut }) {
  return sendMail({
    to, subject: `❌ Réservation annulée — ${listingTitle}`,
    html: wrap(`
      <h2 style="color:#b91c1c;margin-top:0">Réservation annulée</h2>
      <p>Bonjour <strong>${esc(name)}</strong>,</p>
      <p>La réservation pour <strong>${esc(listingTitle)}</strong> du <strong>${esc(checkIn)}</strong> au <strong>${esc(checkOut)}</strong> a été annulée.</p>
      <p style="color:#666;font-size:13px">Si vous avez effectué un paiement, un remboursement sera traité dans les meilleurs délais.</p>
    `),
  });
}

function mailNewMessage({ to, senderName, listingTitle, preview }) {
  return sendMail({
    to, subject: `💬 Nouveau message de ${senderName}`,
    html: wrap(`
      <h2 style="margin-top:0">Vous avez un nouveau message</h2>
      <p><strong>${esc(senderName)}</strong> vous a envoyé un message concernant <strong>${esc(listingTitle)}</strong> :</p>
      <div style="background:#f9f9f9;border-left:4px solid #E8261A;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;font-style:italic;color:#444">
        "${esc(preview.length > 120 ? preview.slice(0, 120) + '…' : preview)}"
      </div>
      <a href="https://locavac.dz" style="display:inline-block;background:#E8261A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Répondre sur Locavac →</a>
    `),
  });
}

function mailNewReservationToHost({ hostName, hostEmail, guestName, listingTitle, checkIn, checkOut, total, nights }) {
  return sendMail({
    to: hostEmail, subject: `📅 Nouvelle réservation — ${listingTitle}`,
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Vous avez une nouvelle réservation ! 🎉</h2>
      <p>Bonjour <strong>${esc(hostName)}</strong>,</p>
      <p><strong>${esc(guestName)}</strong> souhaite réserver votre logement <strong>${esc(listingTitle)}</strong>.</p>
      <div style="background:#f9f9f9;border-radius:10px;padding:16px;margin:20px 0">
        <p style="margin:4px 0"><strong>👤 Voyageur :</strong> ${esc(guestName)}</p>
        <p style="margin:4px 0"><strong>📅 Arrivée :</strong> ${esc(checkIn)}</p>
        <p style="margin:4px 0"><strong>📅 Départ :</strong> ${esc(checkOut)}</p>
        <p style="margin:4px 0"><strong>🌙 Nuits :</strong> ${nights}</p>
        <p style="margin:4px 0"><strong>💰 Total voyageur :</strong> ${Number(total).toLocaleString('fr-DZ')} DZD</p>
      </div>
      <a href="https://locavac.dz" style="display:inline-block;background:#E8261A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Voir la réservation →</a>
    `),
  });
}

function mailPaymentConfirmedToGuest({ guestName, guestEmail, listingTitle, checkIn, checkOut, amount, reference, method }) {
  const methodLabel = { cib:'CIB', edahabia:'Edahabia', baridimob:'BaridiMob', especes:'Espèces à l\'arrivée', virement:'Virement bancaire' }[method] || method;
  return sendMail({
    to: guestEmail, subject: `✅ Paiement confirmé — ${listingTitle}`,
    html: wrap(`
      <h2 style="color:#0a7c47;margin-top:0">Réservation et paiement confirmés ✅</h2>
      <p>Bonjour <strong>${guestName}</strong>,</p>
      <p>Votre paiement pour <strong>${listingTitle}</strong> a été accepté.</p>
      <div style="background:#e6f9f0;border-radius:10px;padding:16px;margin:20px 0">
        <p style="margin:4px 0"><strong>📅 Arrivée :</strong> ${checkIn}</p>
        <p style="margin:4px 0"><strong>📅 Départ :</strong> ${checkOut}</p>
        <p style="margin:4px 0"><strong>💳 Méthode :</strong> ${methodLabel}</p>
        <p style="margin:4px 0"><strong>💰 Montant :</strong> ${Number(amount).toLocaleString('fr-DZ')} DZD</p>
        <p style="margin:4px 0"><strong>🔖 Référence :</strong> <code>${reference}</code></p>
      </div>
      <p>Bon séjour en Algérie ! 🇩🇿</p>
    `),
  });
}

function mailVirementToHost({ hostName, hostEmail, guestName, listingTitle, amount, reference, checkIn, checkOut }) {
  return sendMail({
    to: hostEmail, subject: `⏳ Virement en attente — ${listingTitle}`,
    html: wrap(`
      <h2 style="color:#92400e;margin-top:0">Virement bancaire déclaré ⏳</h2>
      <p>Bonjour <strong>${hostName}</strong>,</p>
      <p><strong>${guestName}</strong> a déclaré avoir effectué un virement pour <strong>${listingTitle}</strong>.</p>
      <div style="background:#fffbeb;border-radius:10px;padding:16px;margin:20px 0">
        <p style="margin:4px 0"><strong>📅 Arrivée :</strong> ${checkIn}</p>
        <p style="margin:4px 0"><strong>📅 Départ :</strong> ${checkOut}</p>
        <p style="margin:4px 0"><strong>💰 Montant :</strong> ${Number(amount).toLocaleString('fr-DZ')} DZD</p>
        <p style="margin:4px 0"><strong>🔖 Référence :</strong> <code>${reference}</code></p>
      </div>
      <p style="font-size:13px;color:#666">Vérifiez la réception du virement sur votre compte bancaire. Contactez Locavac si vous n'avez pas reçu le paiement dans 48h ouvrables.</p>
    `),
  });
}

function mailWelcome({ name, email }) {
  return sendMail({
    to: email, subject: '🏡 Bienvenue sur Locavac !',
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Bienvenue, ${esc(name)} ! 🎉</h2>
      <p>Votre compte Locavac est prêt. Vous pouvez dès maintenant :</p>
      <ul style="line-height:2;color:#444">
        <li>🔍 Rechercher un logement parmi toutes les wilayas d'Algérie</li>
        <li>📅 Réserver et payer en ligne en toute sécurité</li>
        <li>🏠 Proposer votre propre logement à la location</li>
      </ul>
      <a href="https://locavac.dz" style="display:inline-block;background:#E8261A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:8px">Découvrir les logements →</a>
      <p style="margin-top:20px;font-size:13px;color:#999">Besoin d'aide ? Contactez-nous à <a href="mailto:support@locavac.dz" style="color:#E8261A">support@locavac.dz</a></p>
    `),
  });
}

function mailCheckInReminder({ guestName, guestEmail, listingTitle, checkIn, hostName, hostPhone }) {
  return sendMail({
    to: guestEmail, subject: `📅 Rappel : arrivée demain — ${listingTitle}`,
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Votre arrivée est demain ! 🏡</h2>
      <p>Bonjour <strong>${esc(guestName)}</strong>,</p>
      <p>Rappel : vous arrivez demain à <strong>${esc(listingTitle)}</strong>.</p>
      <div style="background:#eff6ff;border-radius:10px;padding:16px;margin:20px 0">
        <p style="margin:4px 0"><strong>📅 Arrivée :</strong> ${esc(checkIn)}</p>
        <p style="margin:4px 0"><strong>👤 Hôte :</strong> ${esc(hostName)}</p>
        ${hostPhone ? `<p style="margin:4px 0"><strong>📞 Contact hôte :</strong> ${esc(hostPhone)}</p>` : ''}
      </div>
      <p style="font-size:13px;color:#666">Pensez à confirmer votre heure d'arrivée avec l'hôte via la messagerie Locavac.</p>
      <a href="https://locavac.dz" style="display:inline-block;background:#E8261A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Ouvrir la messagerie →</a>
    `),
  });
}

function mailReviewReminder({ guestName, guestEmail, listingTitle, listingId }) {
  return sendMail({
    to: guestEmail, subject: `⭐ Votre avis sur ${listingTitle}`,
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Comment s'est passé votre séjour ?</h2>
      <p>Bonjour <strong>${esc(guestName)}</strong>,</p>
      <p>Votre séjour à <strong>${esc(listingTitle)}</strong> est maintenant terminé. Votre avis aide les autres voyageurs à choisir leur logement.</p>
      <div style="text-align:center;margin:24px 0;font-size:32px">⭐ ⭐ ⭐ ⭐ ⭐</div>
      <a href="https://locavac.dz" style="display:inline-block;background:#E8261A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Laisser un avis →</a>
      <p style="margin-top:16px;font-size:12px;color:#999">Vous avez 30 jours pour déposer votre avis.</p>
    `),
  });
}

function mailPasswordReset({ name, email, resetUrl }) {
  return sendMail({
    to: email, subject: '🔑 Réinitialisation de votre mot de passe — Locavac',
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Réinitialisation du mot de passe</h2>
      <p>Bonjour <strong>${esc(name)}</strong>,</p>
      <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${resetUrl}" style="display:inline-block;background:#E8261A;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Réinitialiser mon mot de passe →</a>
      </div>
      <p style="font-size:13px;color:#666">Ce lien est valable <strong>1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email — votre mot de passe reste inchangé.</p>
      <p style="font-size:12px;color:#999;margin-top:16px">Lien alternatif : <a href="${resetUrl}" style="color:#E8261A">${resetUrl}</a></p>
    `),
  });
}

function mailVerifyEmail({ name, email, verifyUrl }) {
  return sendMail({
    to: email, subject: '✅ Confirmez votre adresse email — Locavac',
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Confirmez votre adresse email</h2>
      <p>Bonjour <strong>${esc(name)}</strong>,</p>
      <p>Merci de vous être inscrit sur Locavac ! Pour activer votre compte, confirmez votre adresse email :</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${verifyUrl}" style="display:inline-block;background:#0a7c47;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Confirmer mon email →</a>
      </div>
      <p style="font-size:13px;color:#666">Ce lien est valable <strong>24 heures</strong>. Si vous n'avez pas créé de compte, ignorez cet email.</p>
    `),
  });
}

module.exports = {
  sendMail,
  mailReservationCreated, mailReservationConfirmed, mailReservationCancelled,
  mailNewMessage, mailNewReservationToHost,
  mailPaymentConfirmedToGuest, mailVirementToHost,
  mailWelcome, mailCheckInReminder, mailReviewReminder,
  mailPasswordReset, mailVerifyEmail,
};
