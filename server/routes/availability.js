const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/availability/:listing_id
router.get('/:listing_id', async (req, res) => {
  const lid = Number(req.params.listing_id);
  const listing = await db.listings.findOne(l => l.id === lid);
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });

  const reservations = (await db.reservations.find(r => r.listing_id === lid && r.status !== 'cancelled'))
    .map(r => ({ start: r.check_in, end: r.check_out, type: 'reserved', status: r.status }));

  const blocked = (listing.blocked_ranges || [])
    .map(b => ({ start: b.start, end: b.end, type: 'blocked', reason: b.reason || '' }));

  res.json({ listing_id: lid, unavailable: [...reservations, ...blocked] });
});

// POST /api/availability/:listing_id/block
router.post('/:listing_id/block', auth, async (req, res) => {
  const lid = Number(req.params.listing_id);
  const listing = await db.listings.findOne(l => l.id === lid);
  if (!listing)                        return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });

  const { start, end, reason } = req.body;
  if (!start || !end || start >= end)
    return res.status(400).json({ error: 'Dates invalides (start < end requis).' });

  const ranges = [...(listing.blocked_ranges || []), { start, end, reason: reason || '' }];
  await db.listings.update(l => l.id === lid, { blocked_ranges: JSON.stringify(ranges) });
  res.status(201).json({ blocked_ranges: ranges });
});

// DELETE /api/availability/:listing_id/block
router.delete('/:listing_id/block', auth, async (req, res) => {
  const lid = Number(req.params.listing_id);
  const listing = await db.listings.findOne(l => l.id === lid);
  if (!listing)                        return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });

  const { start, end } = req.body;
  const ranges = (listing.blocked_ranges || []).filter(b => !(b.start === start && b.end === end));
  await db.listings.update(l => l.id === lid, { blocked_ranges: JSON.stringify(ranges) });
  res.json({ blocked_ranges: ranges });
});

module.exports = router;
