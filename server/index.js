require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('express-async-errors');

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
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

app.get('/api/health', (_, res) => res.json({ ok: true, message: 'Locavac API opérationnelle 🇩🇿' }));
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
    });
  })
  .catch(err => {
    console.error('❌ Connexion PostgreSQL échouée :', err.message);
    process.exit(1);
  });
