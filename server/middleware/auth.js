const jwt        = require('jsonwebtoken');
const { pool }   = require('../db');

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // Vérifier que le compte existe toujours et n'est pas banni (couvre la suppression/désactivation de compte)
    const r = await pool.query('SELECT id, banned FROM users WHERE id = $1', [payload.id]);
    if (!r.rows[0] || r.rows[0].banned) {
      return res.status(401).json({ error: 'Compte désactivé ou introuvable.' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token expiré ou invalide.' });
  }
};
