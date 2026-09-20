'use strict';
const router  = require('express').Router();
const https   = require('https');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db');

// Helpers de configuration (lus à l'appel pour respecter les tests)
const clientId     = () => process.env.GOOGLE_CLIENT_ID;
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET;
const callbackUrl  = () => process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback';
const appUrl       = () => process.env.APP_URL || 'http://localhost:3000';

function sign(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, is_host: user.is_host, is_admin: user.is_admin || false },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN },
  );
}

// Requête HTTPS vers l'API Google (Node 20 — module https natif)
function googleFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: { 'User-Agent': 'Locavac/1.0', ...options.headers },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Réponse Google non JSON')); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// GET /api/auth/google — redirection vers la page de consentement Google
router.get('/', (req, res) => {
  if (!clientId()) {
    return res.redirect(`${appUrl()}/?auth_error=google_not_configured`);
  }
  // Nonce signé (JWT) pour protection CSRF sans session serveur
  const state = jwt.sign(
    { nonce: crypto.randomBytes(16).toString('hex') },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
  const params = new URLSearchParams({
    client_id:     clientId(),
    redirect_uri:  callbackUrl(),
    response_type: 'code',
    scope:         'openid email profile',
    state,
    access_type:   'online',
    prompt:        'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback — retour après authentification Google
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const app = appUrl();

  if (error)          return res.redirect(`${app}/?auth_error=google_denied`);
  if (!code || !state) return res.redirect(`${app}/?auth_error=google_invalid`);

  // Vérification du nonce CSRF
  try { jwt.verify(state, process.env.JWT_SECRET); }
  catch { return res.redirect(`${app}/?auth_error=google_csrf`); }

  // Échange du code contre des tokens Google
  const body = new URLSearchParams({
    code,
    client_id:     clientId(),
    client_secret: clientSecret(),
    redirect_uri:  callbackUrl(),
    grant_type:    'authorization_code',
  }).toString();

  let tokens;
  try {
    tokens = await googleFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });
  } catch {
    return res.redirect(`${app}/?auth_error=google_token`);
  }

  if (!tokens.access_token) return res.redirect(`${app}/?auth_error=google_token`);

  // Profil Google de l'utilisateur
  let profile;
  try {
    profile = await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
  } catch {
    return res.redirect(`${app}/?auth_error=google_profile`);
  }

  if (!profile.email) return res.redirect(`${app}/?auth_error=google_no_email`);
  // Google ne garantit l'adresse que si email_verified est vrai (comptes Workspace notamment)
  if (profile.email_verified !== true) return res.redirect(`${app}/?auth_error=google_email_unverified`);

  // Recherche ou création du compte
  let user = await db.users.findByGoogleId(profile.sub);

  if (!user) {
    // Lier à un compte existant partageant le même email
    user = await db.users.findByEmail(profile.email);
    if (user) {
      // Liaison refusée si l'adresse locale n'a jamais été confirmée : sinon quiconque a inscrit cette
      // adresse sans la vérifier capterait le compte de son vrai titulaire à sa première connexion Google.
      if (user.email_verified !== true) return res.redirect(`${app}/?auth_error=google_link_unverified`);
      await db.users.updateById(user.id, { google_id: profile.sub });
      user = await db.users.findById(user.id);
    } else {
      user = await db.users.create({
        name:           (profile.name || profile.email.split('@')[0]).slice(0, 100),
        email:          profile.email,
        password:       null,
        avatar:         profile.picture || null,
        google_id:      profile.sub,
        verified:       true,
        email_verified: true,
      });
    }
  }

  if (user.banned) return res.redirect(`${app}/?auth_error=google_banned`);

  const token = sign(user);
  // Cookie httpOnly éphémère (5 min) — le JWT ne transite jamais dans l'URL
  res.cookie('_gat', token, {
    httpOnly: true,
    secure:   app.startsWith('https'),
    sameSite: 'Lax',
    maxAge:   5 * 60 * 1000,
    path:     '/',
  });
  res.redirect(`${app}/?google_auth=1`);
});

// GET /api/auth/google/token — échange du cookie httpOnly contre le JWT (usage unique)
router.get('/token', (req, res) => {
  const hdr   = req.headers.cookie || '';
  const entry = hdr.split(';').map(s => s.trim()).find(s => s.startsWith('_gat='));
  const cookieToken = entry ? decodeURIComponent(entry.slice(5)) : null;

  if (!cookieToken) return res.status(400).json({ error: 'Aucun token en attente.' });

  try { jwt.verify(cookieToken, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Token expiré ou invalide.' }); }

  res.clearCookie('_gat', { path: '/' });
  res.json({ token: cookieToken });
});

module.exports = router;
