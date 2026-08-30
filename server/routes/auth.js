const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db');

function sign(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, is_host: user.is_host, is_admin: user.is_admin || false },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
}
function safe(u) {
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    is_host: u.is_host, is_admin: u.is_admin || false,
    bio: u.bio || '', avatar: u.avatar || '',
    verified: u.verified || false, created_at: u.created_at,
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Nom, email et mot de passe obligatoires.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  if (await db.users.findOne(u => u.email === email))
    return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
  const user = await db.users.insert({
    name, email, password: await bcrypt.hash(password, 10),
    phone: phone || null, is_host: false,
  });
  res.status(201).json({ token: sign(user), user: safe(user) });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  const user = await db.users.findOne(u => u.email === email);
  if (!user || !await bcrypt.compare(password, user.password))
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  if (user.banned)
    return res.status(403).json({ error: 'Ce compte a été suspendu. Contactez le support.' });
  res.json({ token: sign(user), user: safe(user) });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const user = await db.users.findOne(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json(safe(user));
});

// PUT /api/auth/profile
router.put('/profile', require('../middleware/auth'), async (req, res) => {
  const { name, phone, bio, avatar } = req.body;
  const changes = {};
  if (name   !== undefined) changes.name   = name.trim();
  if (phone  !== undefined) changes.phone  = phone.trim() || null;
  if (bio    !== undefined) changes.bio    = bio.trim();
  if (avatar !== undefined) changes.avatar = avatar.trim();
  if (!Object.keys(changes).length)
    return res.status(400).json({ error: 'Aucun champ à modifier.' });
  await db.users.update(u => u.id === req.user.id, changes);
  const updated = await db.users.findOne(u => u.id === req.user.id);
  res.json(safe(updated));
});

// GET /api/users/:id — profil public
router.get('/users/:id', async (req, res) => {
  const user = await db.users.findOne(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const listings = await db.listings.find(l => l.host_id === user.id && l.available);
  res.json({
    id: user.id, name: user.name, bio: user.bio || '',
    avatar: user.avatar || '', is_host: user.is_host,
    verified: user.verified || false, created_at: user.created_at,
    listing_count: listings.length,
  });
});

module.exports = router;
