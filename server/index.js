require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('express-async-errors');

// Validation des variables critiques au démarrage
if (!process.env.JWT_SECRET) throw new Error('[Locavac] JWT_SECRET manquant dans .env — démarrage refusé.');
if (!process.env.JWT_EXPIRES_IN) throw new Error('[Locavac] JWT_EXPIRES_IN manquant dans .env — les tokens n\'expireraient jamais.');

const express     = require('express');
const http        = require('http');
const cors        = require('cors');
const path        = require('path');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const helmet      = require('helmet');
const db          = require('./db');
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

app.use(express.json());
// Service Worker : no-cache obligatoire pour que le navigateur détecte les mises à jour
app.get('/sw.js', (_, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

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

app.get('/api/health', (_, res) => res.json({ ok: true, message: 'Locavac API opérationnelle 🇩🇿' }));
app.get('/404', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', '404.html')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Middleware d'erreur global
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[Erreur]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur.' });
});

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
