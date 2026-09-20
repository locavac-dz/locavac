require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('express-async-errors');

// Validation des variables critiques au démarrage
if (!process.env.JWT_SECRET) throw new Error('[Locavac] JWT_SECRET manquant dans .env — démarrage refusé.');
if (!process.env.JWT_EXPIRES_IN) throw new Error('[Locavac] JWT_EXPIRES_IN manquant dans .env — les tokens n\'expireraient jamais.');

const express     = require('express');
const http        = require('http');
const cors        = require('cors');
const path        = require('path');
const jwt         = require('jsonwebtoken');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const helmet      = require('helmet');
const db          = require('./db');
const { pool }    = require('./db');
const wsModule    = require('./ws');

const app = express();
app.use(compression());
app.use(helmet({
  // CSP assouplie pour le SPA vanilla (inline scripts et styles autorisés)
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:         ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc:     ["'self'", 'wss:', 'ws:'],
    },
  },
  crossOriginEmbedderPolicy: false, // evite les conflits avec les images Unsplash
}));

// ── CORS ────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Requêtes sans origin (curl, mobile natif, même serveur)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origine non autorisée — ' + origin));
  },
  credentials: true,
}));

// ── Rate limiting ────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives de connexion max par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop d\'inscriptions depuis cette IP. Réessayez dans 1 heure.' },
  skip: () => process.env.NODE_ENV === 'test',
});
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 3, // 3 demandes de reset max par IP et par heure
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes de réinitialisation. Réessayez dans 1 heure.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/auth/login',            loginLimiter);
app.use('/api/auth/register',         registerLimiter);
app.use('/api/auth/forgot-password',  forgotPasswordLimiter);

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop d\'uploads. Réessayez dans 1 heure.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/upload', uploadLimiter);

const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 messages max par minute par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de messages envoyés. Réessayez dans une minute.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/messages', messageLimiter);

const reservationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 réservations max par minute par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes de réservation. Réessayez dans une minute.' },
  skip: () => process.env.NODE_ENV === 'test',
});
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de paiement. Réessayez dans une minute.' },
  skip: () => process.env.NODE_ENV === 'test',
});
const listingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 20, // 20 annonces max par heure par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de publications d\'annonces. Réessayez dans une heure.' },
  skip: () => process.env.NODE_ENV === 'test',
});
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes admin. Réessayez dans une minute.' },
  skip: () => process.env.NODE_ENV === 'test',
});
const newsletterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 inscriptions max par IP et par quart d'heure (anti spam)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/reservations', reservationLimiter);
app.use('/api/payments',     paymentLimiter);
app.post('/api/listings',    listingLimiter);
app.use('/api/admin',        adminLimiter);
app.post('/api/newsletter',  newsletterLimiter);

app.use(express.json({ limit: '2mb' }));

// Journal HTTP (désactivé en test pour ne pas polluer la sortie Jest)
if (process.env.NODE_ENV !== 'test') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// Protection des documents CNI (PDF) — accès réservé au propriétaire et aux admins
// Les fichiers sont nommés {userId}_{timestamp}_{hex}.pdf par le module upload
app.use('/uploads', (req, res, next) => {
  if (!req.path.toLowerCase().endsWith('.pdf')) return next();
  const raw   = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
  const token = raw || req.query.token || null;
  if (!token) return res.status(401).json({ error: 'Authentification requise pour accéder à ce document.' });
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Token invalide.' }); }
  const ownerId = path.basename(req.path).split('_')[0];
  if (!payload.is_admin && String(payload.id) !== ownerId)
    return res.status(403).json({ error: 'Accès refusé.' });
  next();
});

// Service Worker : no-cache obligatoire pour que le navigateur détecte les mises à jour
app.get('/sw.js', (_, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Monté avant /api/auth pour éviter la capture par le routeur auth générique
app.use('/api/auth/google',  require('./routes/auth-google'));
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/listings',     require('./routes/listings'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/payments',     require('./routes/payments'));
app.use('/api/messages',     require('./routes/messages'));
app.use('/api/upload',       require('./routes/upload'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/stats',        require('./routes/stats'));
app.use('/api/admin',        require('./routes/admin'));
app.use('/api/agent',        require('./routes/agent'));
app.use('/api/publicites',   require('./routes/publicites'));
app.use('/api/newsletter',   require('./routes/newsletter'));

app.get('/api/health', async (_, res) => {
  const start = Date.now();
  let dbStatus = 'up';
  let dbLatencyMs = null;
  let dbError = null;
  let timer;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), 3000); }),
    ]);
    dbLatencyMs = Date.now() - start;
  } catch (err) {
    dbStatus = 'down';
    dbError  = err.message;
  } finally {
    // Sans cet arrêt, le timer de 3 s survit à chaque sonde réussie
    clearTimeout(timer);
  }
  const ok = dbStatus === 'up';
  res.status(ok ? 200 : 503).json({
    ok,
    db:        dbStatus,
    ...(dbLatencyMs !== null && { db_latency_ms: dbLatencyMs }),
    ...(dbError     !== null && { db_error: dbError }),
    uptime_s:  Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
// Toute route /api non reconnue (toutes méthodes) : 404 JSON, jamais le HTML du SPA
app.use('/api', (_, res) => res.status(404).json({ error: 'Route API introuvable.' }));
app.get('/404', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', '404.html')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Middleware d'erreur global
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[Erreur]', err.message);
  // Ne pas exposer les détails d'erreur interne (stack, messages PostgreSQL) en production
  const isProd = process.env.NODE_ENV === 'production';
  const msg = (err.status && err.status < 500) ? (err.message || 'Erreur.') : (isProd ? 'Erreur serveur.' : (err.message || 'Erreur serveur.'));
  res.status(err.status || 500).json({ error: msg });
});

// Exporté pour les tests (supertest)
module.exports = app;

// Démarrage uniquement en exécution directe (pas lors des imports de test)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  db.connect()
    .then(() => {
      const server = http.createServer(app);
      wsModule.setup(server);
      server.listen(PORT, () => {
        console.log(`\n🚀 Locavac démarré sur http://localhost:${PORT}`);
        console.log(`   API disponible sur http://localhost:${PORT}/api\n`);
        require('./agent').start();
        require('./cron');
      });
    })
    .catch(err => {
      console.error('❌ Connexion PostgreSQL échouée :', err.message);
      process.exit(1);
    });
}
