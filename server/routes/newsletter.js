const router = require('express').Router();
const { pool } = require('../db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const valid = email => typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);

router.post('/', async (req, res) => {
  const { email } = req.body;
  if (!valid(email)) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }
  try {
    await pool.query(
      'INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email.toLowerCase().trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/newsletter/unsubscribe — désinscription (droit d'opposition, RGPD / loi 18-07).
// Réponse identique que l'adresse soit abonnée ou non : on ne révèle pas qui est inscrit.
router.post('/unsubscribe', async (req, res) => {
  const { email } = req.body;
  if (!valid(email)) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }
  await pool.query('DELETE FROM newsletter_subscribers WHERE email = $1', [email.toLowerCase().trim()]);
  res.json({ ok: true });
});

module.exports = router;
