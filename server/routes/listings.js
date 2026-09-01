const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

async function withHost(listing) {
  const host = await db.users.findOne(u => u.id === listing.host_id);
  return {
    ...listing,
    host_name:      host ? host.name      : 'Inconnu',
    host_phone:     host ? host.phone     : null,
    host_languages: host ? (host.languages || []) : [],
  };
}

// GET /api/listings
router.get('/', async (req, res) => {
  const { wilaya, category, guests, min_price, max_price, q, check_in, check_out, amenities, min_beds } = req.query;
  const wantedAmenities = amenities ? amenities.split(',').map(a => a.trim()).filter(Boolean) : [];

  let unavailableIds = new Set();
  if (check_in && check_out && check_in < check_out) {
    const conflicting = await db.reservations.find(r =>
      r.status !== 'cancelled' &&
      r.check_in  < check_out &&
      r.check_out > check_in
    );
    conflicting.forEach(r => unavailableIds.add(r.listing_id));
  }

  const all = await db.listings.find(l => {
    if (!l.available) return false;
    if (wilaya    && l.wilaya   !== wilaya)           return false;
    if (category  && l.category !== category)         return false;
    if (guests    && l.guests   <  Number(guests))    return false;
    if (min_price && l.price    <  Number(min_price)) return false;
    if (max_price && l.price    >  Number(max_price)) return false;
    if (min_beds  && l.beds     <  Number(min_beds))  return false;
    if (check_in && check_out  && unavailableIds.has(Number(l.id))) return false;
    if (check_in && check_out) {
      const ranges = Array.isArray(l.blocked_ranges) ? l.blocked_ranges
        : (l.blocked_ranges ? JSON.parse(l.blocked_ranges) : []);
      if (ranges.some(b => b.start < check_out && b.end > check_in)) return false;
    }
    if (wantedAmenities.length) {
      const la = Array.isArray(l.amenities) ? l.amenities : (l.amenities ? JSON.parse(l.amenities) : []);
      if (!wantedAmenities.every(a => la.includes(a))) return false;
    }
    if (q) {
      const s = q.toLowerCase();
      if (!l.title.toLowerCase().includes(s) &&
          !l.location.toLowerCase().includes(s) &&
          !(l.description||'').toLowerCase().includes(s)) return false;
    }
    return true;
  });

  all.sort((a, b) => b.rating - a.rating);
  res.json(await Promise.all(all.map(withHost)));
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  const listing = await db.listings.findOne(l => l.id === Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  const revList = await db.reviews.find(r => r.listing_id === listing.id);
  const reviews = (await Promise.all(
    revList
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 10)
      .map(async r => {
        const u = await db.users.findOne(u => u.id === (r.author_id || r.user_id));
        return { ...r, user_name: u ? u.name : 'Anonyme' };
      })
  ));
  res.json({ ...await withHost(listing), reviews });
});

// POST /api/listings
router.post('/', auth, async (req, res) => {
  const { title, description, location, wilaya, category, price, guests, beds, baths, image, photos, lat, lng, amenities } = req.body;
  if (!title || !location || !wilaya || !category || !price)
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  const finalImage    = image || (Array.isArray(photos) && photos[0]) || '';
  const finalPhotos   = Array.isArray(photos) && photos.length ? photos : (finalImage ? [finalImage] : []);
  const finalAmenities = Array.isArray(amenities) ? amenities : [];
  const { cancellation_policy } = req.body;
  const VALID_POLICIES = ['flexible', 'moderee', 'stricte'];
  const listing = await db.listings.insert({
    host_id: req.user.id, title, description: description || '', location, wilaya,
    category, price: Number(price), guests: guests || 1, beds: beds || 1, baths: baths || 1,
    image: finalImage, photos: JSON.stringify(finalPhotos),
    amenities: JSON.stringify(finalAmenities),
    lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null,
    rating: 0, reviews: 0, available: true,
    cancellation_policy: VALID_POLICIES.includes(cancellation_policy) ? cancellation_policy : 'flexible',
  });
  await db.users.update(u => u.id === req.user.id, { is_host: true });
  res.status(201).json({ id: listing.id });
});

// PUT /api/listings/:id
router.put('/:id', auth, async (req, res) => {
  const listing = await db.listings.findOne(l => l.id === Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { title, description, price, available, cancellation_policy, amenities } = req.body;
  const VALID_POLICIES = ['flexible', 'moderee', 'stricte'];
  const changes = {};
  if (title               !== undefined) changes.title               = title;
  if (description         !== undefined) changes.description         = description;
  if (price               !== undefined) changes.price               = price;
  if (available           !== undefined) changes.available           = available;
  if (cancellation_policy !== undefined && VALID_POLICIES.includes(cancellation_policy))
    changes.cancellation_policy = cancellation_policy;
  if (Array.isArray(amenities)) changes.amenities = JSON.stringify(amenities);
  await db.listings.update(l => l.id === listing.id, changes);
  res.json({ ok: true });
});

// DELETE /api/listings/:id
router.delete('/:id', auth, async (req, res) => {
  const listing = await db.listings.findOne(l => l.id === Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  await db.listings.delete(l => l.id === listing.id);
  res.json({ ok: true });
});

// POST /api/listings/:id/signaler — public (optionnellement authentifié)
router.post('/:id/signaler', async (req, res) => {
  const { motif, message } = req.body;
  if (!motif) return res.status(400).json({ error: 'Motif requis.' });
  await db.pool.query(
    'INSERT INTO signalements (listing_id, user_id, motif, message) VALUES ($1,$2,$3,$4)',
    [req.params.id, req.user?.id || null, motif, message || null]
  );
  res.json({ ok: true });
});

// POST /api/listings/:id/photos
router.post('/:id/photos', auth, async (req, res) => {
  const listing = await db.listings.findOne(l => l.id === Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requise.' });
  const photos = [...(listing.photos || [listing.image].filter(Boolean)), url];
  await db.listings.update(l => l.id === listing.id, { photos: JSON.stringify(photos) });
  res.json({ photos });
});

// DELETE /api/listings/:id/photos
router.delete('/:id/photos', auth, async (req, res) => {
  const listing = await db.listings.findOne(l => l.id === Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { url } = req.body;
  const photos = (listing.photos || []).filter(p => p !== url);
  await db.listings.update(l => l.id === listing.id, { photos: JSON.stringify(photos) });
  res.json({ photos });
});

// POST /api/listings/:id/reviews
router.post('/:id/reviews', auth, async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Note entre 1 et 5 requise.' });
  const lid = Number(req.params.id);
  // Vérifier séjour confirmé et terminé
  const now = new Date();
  const validStay = await db.reservations.findOne(r =>
    r.listing_id === lid &&
    r.guest_id   === req.user.id &&
    r.status     === 'confirmed' &&
    new Date(r.check_out) < now
  );
  if (!validStay)
    return res.status(403).json({ error: 'Vous pouvez laisser un avis uniquement après votre séjour.' });
  // Pas deux avis pour la même annonce
  const existing = await db.reviews.findOne(rv =>
    rv.listing_id === lid &&
    (rv.author_id === req.user.id || rv.user_id === req.user.id)
  );
  if (existing)
    return res.status(409).json({ error: 'Vous avez déjà laissé un avis pour ce séjour.' });
  await db.reviews.insert({ listing_id: lid, author_id: req.user.id, user_id: req.user.id, rating: Number(rating), comment: comment || '' });
  const allReviews = await db.reviews.find(r => r.listing_id === lid);
  const avg = allReviews.reduce((s, r) => s + Number(r.rating), 0) / allReviews.length;
  await db.listings.update(l => l.id === lid, { rating: Math.round(avg * 100) / 100, reviews: allReviews.length });
  res.status(201).json({ ok: true });
});

module.exports = router;
