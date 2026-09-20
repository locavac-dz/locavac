const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const ws     = require('../ws');

// GET /api/messages — conversations de l'utilisateur — batch users+listings (anti N+1)
router.get('/', auth, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit = Math.min(50,  Math.max(1, parseInt(req.query.limit, 10) || 20));

  const uid  = req.user.id;
  const msgs = await db.messages.findByUser(uid);
  if (!msgs.length) return res.json({ data: [], pagination: { page: 1, limit, total: 0, pages: 0 } });

  // Passe 1 (purement JS) : dernier message et compteur non-lus par conversation
  const convLatest = {};
  const unreadCount = {};
  for (const m of msgs) {
    const otherId = m.from_id === uid ? m.to_id : m.from_id;
    const key     = `${m.listing_id}-${otherId}`;
    if (!convLatest[key] || String(m.created_at) > convLatest[key].last_at)
      convLatest[key] = { key, listing_id: m.listing_id, other_id: otherId, last_msg: m.body, last_at: String(m.created_at) };
    if (m.from_id !== uid && m.to_id === uid && !m.read)
      unreadCount[key] = (unreadCount[key] || 0) + 1;
  }

  // Passe 2 : chargement batch de tous les autres et annonces distincts
  const allConvs     = Object.values(convLatest);
  const otherIds     = [...new Set(allConvs.map(c => c.other_id))];
  const listingIds   = [...new Set(allConvs.map(c => c.listing_id))];
  const [otherUsers, listings] = await Promise.all([
    db.users.findByIds(otherIds),
    db.listings.findByIds(listingIds),
  ]);
  const userMap    = Object.fromEntries(otherUsers.map(u => [u.id, u]));
  const listingMap = Object.fromEntries(listings.map(l => [l.id, l]));

  const result = allConvs.map(c => ({
    key:           c.key,
    listing_id:    c.listing_id,
    listing_title: listingMap[c.listing_id]?.title || '',
    listing_img:   listingMap[c.listing_id]?.image || '',
    other_id:      c.other_id,
    other_name:    userMap[c.other_id]?.name || 'Inconnu',
    last_msg:      c.last_msg,
    last_at:       c.last_at,
    unread:        unreadCount[c.key] || 0,
  }));
  const sorted = result.sort((a, b) => b.last_at.localeCompare(a.last_at));
  const total  = sorted.length;
  const pages  = Math.ceil(total / limit) || 0;
  const data   = sorted.slice((page - 1) * limit, page * limit);
  res.json({ data, pagination: { page, limit, total, pages } });
});

// GET /api/messages/:listing_id/:other_id
router.get('/:listing_id/:other_id', auth, async (req, res) => {
  const uid     = req.user.id;
  const lid     = parseInt(req.params.listing_id, 10);
  const otherId = parseInt(req.params.other_id, 10);
  if (isNaN(lid) || isNaN(otherId)) return res.status(400).json({ error: 'Identifiants invalides.' });

  // Déjà trié ASC par le DAO — pas de sort() manuel nécessaire
  const thread = await db.messages.findThread(uid, otherId, lid);

  await db.messages.markThreadRead(uid, otherId, lid);

  const other   = await db.users.findById(otherId);
  const listing = await db.listings.findById(lid);
  res.json({ thread, other: { id: otherId, name: other?.name }, listing: { id: lid, title: listing?.title, image: listing?.image } });
});

// POST /api/messages
router.post('/', auth, async (req, res) => {
  const { to_id, listing_id, body } = req.body;
  if (!to_id || !listing_id || !body?.trim())
    return res.status(400).json({ error: 'Destinataire, annonce et message requis.' });
  if (body.length > 2000)
    return res.status(400).json({ error: 'Le message ne peut pas dépasser 2000 caractères.' });
  if (Number(to_id) === req.user.id)
    return res.status(400).json({ error: 'Vous ne pouvez pas vous envoyer un message.' });

  const listing = await db.listings.findById(Number(listing_id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });

  const recipient = await db.users.findById(Number(to_id));
  if (!recipient) return res.status(404).json({ error: 'Destinataire introuvable.' });

  const msg    = await db.messages.create({
    from_id: req.user.id, to_id: Number(to_id),
    listing_id: Number(listing_id), body: body.trim(), read: false,
  });

  const sender = await db.users.findById(req.user.id);
  if (recipient?.email) {
    require('../mailer').mailNewMessage({
      to: recipient.email, senderName: sender.name,
      listingTitle: listing.title, preview: body.trim(),
    });
  }
  ws.send(to_id, {
    type: 'message',
    msg: { ...msg, sender_name: sender.name, listing_title: listing.title },
  });
  res.status(201).json(msg);
});

// GET /api/messages/unread-count
router.get('/unread-count', auth, async (req, res) => {
  const count = await db.messages.countUnread(req.user.id);
  res.json({ count });
});

module.exports = router;
