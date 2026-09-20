const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const jwt    = require('jsonwebtoken');

// Enrichit une liste d'annonces avec les données hôte en une seule requête (anti N+1)
async function attachHosts(listings) {
  if (!listings.length) return listings;
  const ids  = [...new Set(listings.map(l => l.host_id))];
  const hosts = await db.users.findByIds(ids);
  const byId  = Object.fromEntries(hosts.map(h => [h.id, h]));
  return listings.map(l => {
    const h = byId[l.host_id];
    // Le téléphone de l'hôte n'est jamais exposé ici (routes publiques, mises en cache) : il est communiqué
    // au voyageur dans l'e-mail de confirmation de réservation.
    return { ...l, host_name: h?.name || 'Inconnu', host_languages: h?.languages || [] };
  });
}

// Enrichit une seule annonce (pour GET /:id)
async function withHost(listing) {
  const [enriched] = await attachHosts([listing]);
  return enriched;
}

// GET /api/listings
router.get('/', async (req, res) => {
  const { wilaya, category, guests, min_price, max_price, q, check_in, check_out, amenities, min_beds } = req.query;
  const wantedAmenities = amenities ? amenities.split(',').map(a => a.trim()).filter(Boolean) : [];

  // Récupérer les ids d'annonces indisponibles pour les dates demandées
  let unavailableIds = [];
  if (check_in && check_out && check_in < check_out) {
    unavailableIds = await db.reservations.findConflictingListingIds(check_in, check_out);
  }

  let results = await db.listings.search({
    wilaya, category, guests,
    minPrice: min_price, maxPrice: max_price, minBeds: min_beds,
    q, unavailableIds,
  });

  // Filtrage JS pour les champs JSON complexes (blocked_ranges, amenities)
  if (check_in && check_out) {
    results = results.filter(l => {
      const ranges = Array.isArray(l.blocked_ranges) ? l.blocked_ranges
        : (l.blocked_ranges ? JSON.parse(l.blocked_ranges) : []);
      return !ranges.some(b => b.start < check_out && b.end > check_in);
    });
  }
  if (wantedAmenities.length) {
    results = results.filter(l => {
      const la = Array.isArray(l.amenities) ? l.amenities : (l.amenities ? JSON.parse(l.amenities) : []);
      return wantedAmenities.every(a => la.includes(a));
    });
  }

  results.sort((a, b) => b.rating - a.rating);
  // Cache public 30s — cohérent avec la fréquence de mise à jour des annonces
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  res.json(await attachHosts(results));
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  const listing = await db.listings.findById(Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  // Incrémenter le compteur de vues de façon asynchrone
  db.listings.incrementViews(listing.id).catch(() => {});
  // Les avis sont retournés avec le nom de l'auteur directement par le DAO
  const reviews = await db.reviews.findWithAuthor(listing.id, 10);
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  res.json({ ...await withHost(listing), reviews });
});

// POST /api/listings
router.post('/', auth, async (req, res) => {
  const { title, description, location, wilaya, category, price, guests, beds, baths, image, photos, lat, lng, amenities } = req.body;
  if (!title || !location || !wilaya || !category || price === undefined || price === null || price === '')
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  if (typeof title !== 'string' || title.trim().length < 5 || title.length > 120)
    return res.status(400).json({ error: 'Le titre doit contenir entre 5 et 120 caractères.' });
  if (description && description.length > 3000)
    return res.status(400).json({ error: 'La description ne peut pas dépasser 3000 caractères.' });
  const numPrice = Number(price);
  if (!Number.isFinite(numPrice) || numPrice <= 0 || numPrice > 1_000_000)
    return res.status(400).json({ error: 'Le prix doit être compris entre 1 et 1 000 000 DZD.' });
  const numGuests = guests !== undefined ? Number(guests) : 1;
  const numBeds   = beds   !== undefined ? Number(beds)   : 1;
  const numBaths  = baths  !== undefined ? Number(baths)  : 1;
  if (!Number.isInteger(numGuests) || numGuests < 1 || numGuests > 50)
    return res.status(400).json({ error: 'Le nombre de voyageurs doit être compris entre 1 et 50.' });
  if (!Number.isInteger(numBeds) || numBeds < 1 || numBeds > 30)
    return res.status(400).json({ error: 'Le nombre de chambres doit être compris entre 1 et 30.' });
  if (!Number.isInteger(numBaths) || numBaths < 1 || numBaths > 20)
    return res.status(400).json({ error: 'Le nombre de salles de bain doit être compris entre 1 et 20.' });
  if (lat !== undefined && lat !== null && lat !== '') {
    const numLat = Number(lat);
    if (!Number.isFinite(numLat) || numLat < -90 || numLat > 90)
      return res.status(400).json({ error: 'Latitude invalide (doit être entre -90 et 90).' });
  }
  if (lng !== undefined && lng !== null && lng !== '') {
    const numLng = Number(lng);
    if (!Number.isFinite(numLng) || numLng < -180 || numLng > 180)
      return res.status(400).json({ error: 'Longitude invalide (doit être entre -180 et 180).' });
  }
  const finalImage    = image || (Array.isArray(photos) && photos[0]) || '';
  const finalPhotos   = Array.isArray(photos) && photos.length ? photos : (finalImage ? [finalImage] : []);
  const finalAmenities = Array.isArray(amenities) ? amenities : [];
  const { cancellation_policy } = req.body;
  const VALID_POLICIES = ['flexible', 'moderee', 'stricte'];
  const listing = await db.listings.create({
    host_id: req.user.id, title, description: description || '', location, wilaya,
    category, price: numPrice, guests: numGuests, beds: numBeds, baths: numBaths,
    image: finalImage, photos: JSON.stringify(finalPhotos),
    amenities: JSON.stringify(finalAmenities),
    lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null,
    rating: 0, reviews: 0, available: true,
    cancellation_policy: VALID_POLICIES.includes(cancellation_policy) ? cancellation_policy : 'flexible',
  });
  await db.users.updateById(req.user.id, { is_host: true });
  res.status(201).json({ id: listing.id });
});

// PUT /api/listings/:id
router.put('/:id', auth, async (req, res) => {
  const listing = await db.listings.findById(Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { title, description, price, available, cancellation_policy, amenities } = req.body;
  const VALID_POLICIES = ['flexible', 'moderee', 'stricte'];
  if (title !== undefined && (typeof title !== 'string' || title.trim().length < 5 || title.length > 120))
    return res.status(400).json({ error: 'Le titre doit contenir entre 5 et 120 caractères.' });
  if (description !== undefined && description.length > 3000)
    return res.status(400).json({ error: 'La description ne peut pas dépasser 3000 caractères.' });
  if (price !== undefined) {
    const np = Number(price);
    if (!Number.isFinite(np) || np <= 0 || np > 1_000_000)
      return res.status(400).json({ error: 'Le prix doit être compris entre 1 et 1 000 000 DZD.' });
  }
  const changes = {};
  if (title               !== undefined) changes.title               = title.trim();
  if (description         !== undefined) changes.description         = description;
  if (price               !== undefined) changes.price               = Number(price);
  if (available           !== undefined) changes.available           = available;
  if (cancellation_policy !== undefined && VALID_POLICIES.includes(cancellation_policy))
    changes.cancellation_policy = cancellation_policy;
  if (Array.isArray(amenities)) changes.amenities = JSON.stringify(amenities);
  await db.listings.updateById(listing.id, changes);
  res.json({ ok: true });
});

// DELETE /api/listings/:id
router.delete('/:id', auth, async (req, res) => {
  const listing = await db.listings.findById(Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  await db.listings.deleteById(listing.id);
  res.json({ ok: true });
});

// POST /api/listings/:id/signaler — public (optionnellement authentifié)
const SIGNALEMENT_MOTIFS = ['frauduleuse', 'photos', 'prix', 'comportement', 'autre'];
router.post('/:id/signaler', async (req, res) => {
  const { motif, message } = req.body;
  if (!motif) return res.status(400).json({ error: 'Motif requis.' });
  if (!SIGNALEMENT_MOTIFS.includes(motif))
    return res.status(400).json({ error: 'Motif invalide.' });
  if (message !== undefined && message !== null && (typeof message !== 'string' || message.length > 1000))
    return res.status(400).json({ error: 'Le message ne peut pas dépasser 1000 caractères.' });
  const lid = Number(req.params.id);
  if (!Number.isInteger(lid) || !await db.listings.findById(lid))
    return res.status(404).json({ error: 'Annonce introuvable.' });

  // Signalement anonyme autorisé ; s'il y a un jeton valide, on rattache l'auteur
  let userId = null;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try { userId = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] }).id || null; } catch {}
  }

  await db.pool.query(
    'INSERT INTO signalements (listing_id, user_id, motif, message) VALUES ($1,$2,$3,$4)',
    [lid, userId, motif, (message || '').trim() || null]
  );
  res.json({ ok: true });
});

// POST /api/listings/:id/photos
router.post('/:id/photos', auth, async (req, res) => {
  const listing = await db.listings.findById(Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requise.' });
  const photos = [...(listing.photos || [listing.image].filter(Boolean)), url];
  await db.listings.updateById(listing.id, { photos: JSON.stringify(photos) });
  res.json({ photos });
});

// DELETE /api/listings/:id/photos
router.delete('/:id/photos', auth, async (req, res) => {
  const listing = await db.listings.findById(Number(req.params.id));
  if (!listing) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (listing.host_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { url } = req.body;
  const photos = (listing.photos || []).filter(p => p !== url);
  await db.listings.updateById(listing.id, { photos: JSON.stringify(photos) });
  res.json({ photos });
});

// POST /api/listings/:id/reviews
router.post('/:id/reviews', auth, async (req, res) => {
  const { rating, comment } = req.body;
  const numRating = Number(rating);
  if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5)
    return res.status(400).json({ error: 'Note entre 1 et 5 requise (entier).' });
  if (comment && comment.length > 1000)
    return res.status(400).json({ error: 'Le commentaire ne peut pas dépasser 1000 caractères.' });
  const lid = Number(req.params.id);
  // Vérifier séjour confirmé et terminé
  const validStay = await db.reservations.findValidStay(lid, req.user.id);
  if (!validStay)
    return res.status(403).json({ error: 'Vous pouvez laisser un avis uniquement après votre séjour.' });
  // Pas deux avis pour la même annonce
  const existing = await db.reviews.findOne(lid, req.user.id);
  if (existing)
    return res.status(409).json({ error: 'Vous avez déjà laissé un avis pour ce séjour.' });
  await db.reviews.create({ listing_id: lid, author_id: req.user.id, user_id: req.user.id, rating: numRating, comment: (comment || '').trim() });
  // Recalcul automatique de la note moyenne via SQL
  await db.listings.updateRating(lid);
  res.status(201).json({ ok: true });
});

module.exports = router;
