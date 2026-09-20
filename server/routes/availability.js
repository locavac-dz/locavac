const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/availability/:listing_id
router.get('/:listing_id', async (req, res) => {
  const lid = Number(req.params.listing_id);
  const listing = await db.listings.findById(lid);
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });

  const reservations = (await db.reservations.findByListing(lid))
    .filter(r => r.status !== 'cancelled')
    .map(r => ({ start: r.check_in, end: r.check_out, type: 'reserved', status: r.status }));

  const blocked = (listing.blocked_ranges || [])
    .map(b => ({ start: b.start, end: b.end, type: 'blocked', reason: b.reason || '' }));

  res.json({ listing_id: lid, unavailable: [...reservations, ...blocked] });
});

// POST /api/availability/:listing_id/block
router.post('/:listing_id/block', auth, async (req, res) => {
  const lid = Number(req.params.listing_id);
  const listing = await db.listings.findById(lid);
  if (!listing)                        return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });

  const { start, end, reason } = req.body;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end) || start >= end)
    return res.status(400).json({ error: 'Dates invalides — format AAAA-MM-JJ requis, start < end.' });
  if (isNaN(new Date(start)) || isNaN(new Date(end)))
    return res.status(400).json({ error: 'Date calendrier invalide (ex. mois ou jour hors plage).' });
  const MAX_BLOCK_DAYS = 365;
  if (Math.round((new Date(end) - new Date(start)) / 86400000) > MAX_BLOCK_DAYS)
    return res.status(400).json({ error: `La durée de blocage ne peut pas dépasser ${MAX_BLOCK_DAYS} jours.` });
  if (reason && reason.length > 200)
    return res.status(400).json({ error: 'La raison ne peut pas dépasser 200 caractères.' });

  const ranges = [...(listing.blocked_ranges || []), { start, end, reason: reason || '' }];
  await db.listings.updateById(lid, { blocked_ranges: JSON.stringify(ranges) });
  res.status(201).json({ blocked_ranges: ranges });
});

// DELETE /api/availability/:listing_id/block
router.delete('/:listing_id/block', auth, async (req, res) => {
  const lid = Number(req.params.listing_id);
  const listing = await db.listings.findById(lid);
  if (!listing)                        return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });

  const { start, end } = req.body;
  const ranges = (listing.blocked_ranges || []).filter(b => !(b.start === start && b.end === end));
  await db.listings.updateById(lid, { blocked_ranges: JSON.stringify(ranges) });
  res.json({ blocked_ranges: ranges });
});

module.exports = router;
