const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const ws     = require('../ws');

// GET /api/messages — conversations de l'utilisateur
router.get('/', auth, async (req, res) => {
  const uid  = req.user.id;
  const msgs = await db.messages.findByUser(uid);

  const convMap = {};
  for (const m of msgs) {
    const otherId = m.from_id === uid ? m.to_id : m.from_id;
    const key     = `${m.listing_id}-${otherId}`;
    if (!convMap[key] || String(m.created_at) > convMap[key].last_at) {
      const other   = await db.users.findById(otherId);
      const listing = await db.listings.findById(m.listing_id);
      convMap[key] = {
        key, listing_id: m.listing_id,
        listing_title: listing?.title || '',
        listing_img:   listing?.image || '',
        other_id:     otherId,
        other_name:   other?.name || 'Inconnu',
        last_msg:     m.body,
        last_at:      String(m.created_at),
        unread:       msgs.filter(x => x.from_id === otherId && x.to_id === uid && !x.read && x.listing_id === m.listing_id).length,
      };
    }
  }
  res.json(Object.values(convMap).sort((a,b) => b.last_at.localeCompare(a.last_at)));
});

// GET /api/messages/:listing_id/:other_id
router.get('/:listing_id/:other_id', auth, async (req, res) => {
  const uid     = req.user.id;
  const lid     = Number(req.params.listing_id);
  const otherId = Number(req.params.other_id);

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

  const msg = await db.messages.create({
    from_id: req.user.id, to_id: Number(to_id),
    listing_id: Number(listing_id), body: body.trim(), read: false,
  });

  const recipient = await db.users.findById(Number(to_id));
  const sender    = await db.users.findById(req.user.id);
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
