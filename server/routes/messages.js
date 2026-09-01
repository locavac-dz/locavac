const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const ws     = require('../ws');

// GET /api/messages — conversations de l'utilisateur
router.get('/', auth, async (req, res) => {
  const uid  = req.user.id;
  const msgs = await db.messages.find(m => m.from_id === uid || m.to_id === uid);

  const convMap = {};
  for (const m of msgs) {
    const otherId = m.from_id === uid ? m.to_id : m.from_id;
    const key     = `${m.listing_id}-${otherId}`;
    if (!convMap[key] || String(m.created_at) > convMap[key].last_at) {
      const other   = await db.users.findOne(u => u.id === otherId);
      const listing = await db.listings.findOne(l => l.id === m.listing_id);
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

  const thread = await db.messages.find(m =>
    m.listing_id === lid &&
    ((m.from_id === uid && m.to_id === otherId) || (m.from_id === otherId && m.to_id === uid))
  );
  thread.sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)));

  await db.messages.update(
    m => m.to_id === uid && m.from_id === otherId && m.listing_id === lid && !m.read,
    { read: true }
  );

  const other   = await db.users.findOne(u => u.id === otherId);
  const listing = await db.listings.findOne(l => l.id === lid);
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

  const listing = await db.listings.findOne(l => l.id === Number(listing_id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });

  const msg = await db.messages.insert({
    from_id: req.user.id, to_id: Number(to_id),
    listing_id: Number(listing_id), body: body.trim(), read: false,
  });

  const recipient = await db.users.findOne(u => u.id === Number(to_id));
  const sender    = await db.users.findOne(u => u.id === req.user.id);
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
  const count = await db.messages.count(m => m.to_id === req.user.id && !m.read);
  res.json({ count });
});

module.exports = router;
