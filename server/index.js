require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('express-async-errors');

const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const db          = require('./db');

const app = express();
app.use(compression());

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
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});
// Appliqué uniquement sur login et register
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

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
    app.listen(PORT, () => {
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
