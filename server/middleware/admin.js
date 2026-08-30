const auth = require('./auth');
const db   = require('../db');

module.exports = function adminMiddleware(req, res, next) {
  auth(req, res, async () => {
    const user = await db.users.findOne(u => u.id === req.user.id);
    if (!user || !user.is_admin)
      return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
    next();
  });
};
