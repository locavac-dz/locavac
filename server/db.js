require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');
const bcrypt   = require('bcryptjs');

// ── Connexion PostgreSQL ─────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
});

// ── Helpers bas niveau ────────────────────────────────────────
const _q   = (sql, p = []) => pool.query(sql, p).then(r => r.rows);
const _one = (sql, p = []) => pool.query(sql, p).then(r => r.rows[0] || null);
const _run = (sql, p = []) => pool.query(sql, p).then(r => r.rowCount);

async function _insert(table, doc) {
  const keys   = Object.keys(doc);
  const vals   = Object.values(doc);
  const cols   = keys.join(', ');
  const params = keys.map((_, i) => `$${i + 1}`).join(', ');
  return _one(`INSERT INTO ${table} (${cols}) VALUES (${params}) RETURNING *`, vals);
}

async function _updateById(table, id, changes) {
  const keys = Object.keys(changes);
  if (!keys.length) return;
  const vals = Object.values(changes);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await pool.query(`UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1}`, [...vals, id]);
}

// ── Initialisation du schéma ─────────────────────────────────
async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

// ═══════════════════════════════════════════════════════════════
// DAO USERS
// ═══════════════════════════════════════════════════════════════
const users = {
  findById:                id     => _one('SELECT * FROM users WHERE id = $1', [id]),
  findByIds:               ids    => ids.length ? _q('SELECT * FROM users WHERE id = ANY($1)', [ids]) : Promise.resolve([]),
  findByEmail:             email  => _one('SELECT * FROM users WHERE email = $1', [email]),
  findByVerificationToken: token  => _one('SELECT * FROM users WHERE verification_token = $1', [token]),
  findAll:                 ()     => _q('SELECT * FROM users ORDER BY id'),

  // Recherche admin avec filtres optionnels
  async search({ q, role } = {}) {
    const conds = [];
    const params = [];
    let i = 1;
    if (q) {
      conds.push(`(lower(name) LIKE $${i} OR lower(email) LIKE $${i})`);
      params.push(`%${q.toLowerCase()}%`);
      i++;
    }
    if (role === 'host')   { conds.push(`is_host = true`); }
    if (role === 'admin')  { conds.push(`is_admin = true`); }
    if (role === 'banned') { conds.push(`banned = true`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return _q(`SELECT * FROM users ${where} ORDER BY id`, params);
  },

  create:    doc                => _insert('users', doc),
  updateById: (id, changes)    => _updateById('users', id, changes),
  deleteById:  id               => _run('DELETE FROM users WHERE id = $1', [id]),

  // Compteurs pour admin
  countListings:     hostId  => _one('SELECT COUNT(*) FROM listings WHERE host_id = $1', [hostId]).then(r => parseInt(r.count)),
  countReservations: guestId => _one('SELECT COUNT(*) FROM reservations WHERE guest_id = $1', [guestId]).then(r => parseInt(r.count)),
};

// ═══════════════════════════════════════════════════════════════
// DAO LISTINGS
// ═══════════════════════════════════════════════════════════════
const listings = {
  findById:   id     => _one('SELECT * FROM listings WHERE id = $1', [id]),
  findByHost: hostId => _q('SELECT * FROM listings WHERE host_id = $1 ORDER BY id', [hostId]),
  findAll:    ()     => _q('SELECT * FROM listings ORDER BY id'),

  // Recherche publique avec filtres dynamiques (retourne les annonces disponibles)
  // Les filtres amenities et blocked_ranges sont appliqués en JS après (champs JSON)
  async search({ wilaya, category, guests, minPrice, maxPrice, minBeds, q, unavailableIds = [] } = {}) {
    const conds  = ['available = true'];
    const params = [];
    let i = 1;
    if (wilaya)    { conds.push(`wilaya = $${i++}`);            params.push(wilaya); }
    if (category)  { conds.push(`category = $${i++}`);          params.push(category); }
    if (guests)    { conds.push(`guests >= $${i++}`);           params.push(Number(guests)); }
    if (minPrice)  { conds.push(`price >= $${i++}`);            params.push(Number(minPrice)); }
    if (maxPrice)  { conds.push(`price <= $${i++}`);            params.push(Number(maxPrice)); }
    if (minBeds)   { conds.push(`beds >= $${i++}`);             params.push(Number(minBeds)); }
    if (q)         { conds.push(`(lower(title) LIKE $${i} OR lower(location) LIKE $${i} OR lower(coalesce(description,'')) LIKE $${i})`); params.push(`%${q.toLowerCase()}%`); i++; }
    if (unavailableIds.length) { conds.push(`id != ALL($${i++})`); params.push(unavailableIds); }
    return _q(`SELECT * FROM listings WHERE ${conds.join(' AND ')} ORDER BY rating DESC LIMIT 200`, params);
  },

  // Recherche admin avec filtres
  async adminSearch({ q, status } = {}) {
    const conds  = [];
    const params = [];
    let i = 1;
    if (q)                 { conds.push(`(lower(title) LIKE $${i} OR lower(location) LIKE $${i})`); params.push(`%${q.toLowerCase()}%`); i++; }
    if (status === 'active')   { conds.push('available = true'); }
    if (status === 'inactive') { conds.push('available = false'); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return _q(`SELECT * FROM listings ${where} ORDER BY id DESC`, params);
  },

  create:       doc             => _insert('listings', doc),
  updateById:   (id, changes)  => _updateById('listings', id, changes),
  deleteById:   id              => _run('DELETE FROM listings WHERE id = $1', [id]),
  deleteByHost: hostId          => _run('DELETE FROM listings WHERE host_id = $1', [hostId]),
  setAvailableByHost: (hostId, available) => _run('UPDATE listings SET available = $1 WHERE host_id = $2', [available, hostId]),

  incrementViews: id => _run('UPDATE listings SET views = COALESCE(views, 0) + 1 WHERE id = $1', [id]),

  updateRating: async (id) => {
    await _run(`
      UPDATE listings SET
        rating   = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE listing_id = $1), 0),
        reviews  = (SELECT COUNT(*) FROM reviews WHERE listing_id = $1)
      WHERE id = $1`, [id]);
  },

  countByListing: listingId => _one('SELECT COUNT(*) FROM reservations WHERE listing_id = $1', [listingId]).then(r => parseInt(r.count)),
};

// ═══════════════════════════════════════════════════════════════
// DAO RESERVATIONS
// ═══════════════════════════════════════════════════════════════
const reservations = {
  findById:       id      => _one('SELECT * FROM reservations WHERE id = $1', [id]),
  findByGuest:    guestId => _q('SELECT * FROM reservations WHERE guest_id = $1 ORDER BY created_at DESC', [guestId]),
  findByListing:  listingId => _q('SELECT * FROM reservations WHERE listing_id = $1 ORDER BY created_at DESC', [listingId]),
  findByListings: listingIds => listingIds.length
    ? _q('SELECT * FROM reservations WHERE listing_id = ANY($1) ORDER BY created_at DESC', [listingIds])
    : Promise.resolve([]),

  // Toutes les réservations (admin) avec filtre statut optionnel
  findAll: (status) => status
    ? _q('SELECT * FROM reservations WHERE status = $1 ORDER BY id DESC', [status])
    : _q('SELECT * FROM reservations ORDER BY id DESC'),

  // Vérifier conflit de dates (pour créer / modifier une réservation)
  findConflict: (listingId, checkIn, checkOut, excludeId = null) => _one(
    `SELECT id FROM reservations
     WHERE listing_id = $1 AND status != 'cancelled'
       AND check_in < $2 AND check_out > $3
       AND ($4::int IS NULL OR id != $4)
     LIMIT 1`,
    [listingId, checkOut, checkIn, excludeId]
  ),

  // Ids des logements déjà réservés sur une plage de dates (pour la recherche)
  findConflictingListingIds: (checkIn, checkOut) => _q(
    `SELECT DISTINCT listing_id FROM reservations
     WHERE status != 'cancelled' AND check_in < $1 AND check_out > $2`,
    [checkOut, checkIn]
  ).then(rows => rows.map(r => r.listing_id)),

  // Vérifier séjour confirmé et terminé (pour autoriser un avis)
  findValidStay: (listingId, guestId) => _one(
    `SELECT id FROM reservations
     WHERE listing_id = $1 AND guest_id = $2 AND status = 'confirmed'
       AND check_out < NOW()`,
    [listingId, guestId]
  ),

  create:          doc           => _insert('reservations', doc),
  updateById:      (id, changes) => _updateById('reservations', id, changes),
  deleteByGuest:   guestId       => _run('DELETE FROM reservations WHERE guest_id = $1', [guestId]),
  deleteByListing: listingId     => _run('DELETE FROM reservations WHERE listing_id = $1', [listingId]),
};

// ═══════════════════════════════════════════════════════════════
// DAO REVIEWS
// ═══════════════════════════════════════════════════════════════
const reviews = {
  findByListing:  listingId => _q('SELECT * FROM reviews WHERE listing_id = $1 ORDER BY created_at DESC', [listingId]),
  findByListings: listingIds => listingIds.length
    ? _q('SELECT * FROM reviews WHERE listing_id = ANY($1)', [listingIds])
    : Promise.resolve([]),

  findOne: (listingId, authorId) => _one(
    'SELECT id FROM reviews WHERE listing_id = $1 AND (author_id = $2 OR user_id = $2) LIMIT 1',
    [listingId, authorId]
  ),

  // Avis enrichis avec nom auteur pour listing detail
  findWithAuthor: async (listingId, limit = 10) => _q(
    `SELECT r.*, u.name AS user_name
     FROM reviews r
     LEFT JOIN users u ON u.id = COALESCE(r.author_id, r.user_id)
     WHERE r.listing_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [listingId, limit]
  ),

  create:          doc           => _insert('reviews', doc),
  deleteByListing: listingId     => _run('DELETE FROM reviews WHERE listing_id = $1', [listingId]),
  deleteByAuthor:  authorId      => _run('DELETE FROM reviews WHERE author_id = $1 OR user_id = $1', [authorId]),
};

// ═══════════════════════════════════════════════════════════════
// DAO PAYMENTS
// ═══════════════════════════════════════════════════════════════
const payments = {
  findById:           id        => _one('SELECT * FROM payments WHERE id = $1', [id]),
  findByIdAndUser:    (id, uid) => _one('SELECT * FROM payments WHERE id = $1 AND user_id = $2', [id, uid]),
  findByReservation:  resaId    => _q('SELECT * FROM payments WHERE reservation_id = $1', [resaId]),
  findByResaAndUser:  (resaId, uid) => _q('SELECT * FROM payments WHERE reservation_id = $1 AND user_id = $2', [resaId, uid]),

  findSuccessByReservation: resaId => _one(
    "SELECT id FROM payments WHERE reservation_id = $1 AND status = 'success' LIMIT 1",
    [resaId]
  ),

  findAll: (status) => status
    ? _q('SELECT * FROM payments WHERE status = $1 ORDER BY id DESC', [status])
    : _q('SELECT * FROM payments ORDER BY id DESC'),

  findByIds: ids => ids.length ? _q('SELECT * FROM payments WHERE id = ANY($1)', [ids]) : Promise.resolve([]),
  create:    doc           => _insert('payments', doc),
  updateById: (id, changes) => _updateById('payments', id, changes),
};

// ═══════════════════════════════════════════════════════════════
// DAO MESSAGES
// ═══════════════════════════════════════════════════════════════
const messages = {
  // Toutes les conversations d'un utilisateur (liste groupée)
  findByUser: uid => _q(
    'SELECT * FROM messages WHERE from_id = $1 OR to_id = $1 ORDER BY created_at DESC',
    [uid]
  ),

  // Fil d'une conversation
  findThread: (uid, otherId, listingId) => _q(
    `SELECT * FROM messages
     WHERE listing_id = $1
       AND ((from_id = $2 AND to_id = $3) OR (from_id = $3 AND to_id = $2))
     ORDER BY created_at ASC`,
    [listingId, uid, otherId]
  ),

  // Marquer comme lus les messages d'une conversation
  markThreadRead: (toId, fromId, listingId) => _run(
    'UPDATE messages SET read = true WHERE to_id = $1 AND from_id = $2 AND listing_id = $3 AND read = false',
    [toId, fromId, listingId]
  ),

  countUnread: uid => _one(
    'SELECT COUNT(*) FROM messages WHERE to_id = $1 AND read = false',
    [uid]
  ).then(r => parseInt(r.count)),

  create:     doc    => _insert('messages', doc),
  deleteByUser: uid  => _run('DELETE FROM messages WHERE from_id = $1 OR to_id = $1', [uid]),
};

// ═══════════════════════════════════════════════════════════════
// DAO PAYOUTS
// ═══════════════════════════════════════════════════════════════
const payouts = {
  findByHost: hostId => _q('SELECT * FROM payouts WHERE host_id = $1 ORDER BY id DESC', [hostId]),
  findAll:    ()     => _q('SELECT * FROM payouts ORDER BY id DESC'),
  findById:   id     => _one('SELECT * FROM payouts WHERE id = $1', [id]),
  create:     doc           => _insert('payouts', doc),
  updateById: (id, changes) => _updateById('payouts', id, changes),
};

// ═══════════════════════════════════════════════════════════════
// SEED
// ═══════════════════════════════════════════════════════════════
const SEED_LISTINGS = [
  { title:"Villa pieds dans l'eau à Tipaza",  description:"Vue imprenable sur la Méditerranée, terrasse privée, accès direct à la plage. Parfait pour un séjour en famille ou entre amis à deux pas d'Alger.",        location:"Tipaza",           wilaya:"Tipaza",      category:"plage",    price:12500, guests:6,  beds:3, baths:2, image:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80", rating:4.97, reviews:128 },
  { title:"Camp de luxe sous les étoiles",    description:"Nuits féériques dans le Grand Erg Occidental. Bivouac équipé, dîner traditionnel targui, balade en dromadaire au lever du soleil.",                          location:"Tamanrasset",      wilaya:"Tamanrasset", category:"sahara",   price:18000, guests:4,  beds:2, baths:1, image:"https://images.unsplash.com/photo-1451337516015-6b6e9a44a8a3?w=800&q=80", rating:5.0,  reviews:54  },
  { title:"Somptueuse villa avec piscine",    description:"Immense villa avec piscine chauffée, jardin méditerranéen et vue panoramique sur la baie d'Oran. Personnel de maison inclus sur demande.",                   location:"Oran, Aïn El Turk",wilaya:"Oran",        category:"villa",    price:22000, guests:10, beds:5, baths:3, image:"https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80", rating:4.92, reviews:89  },
  { title:"Riad authentique en Médina",       description:"Riad traditionnel du XVIIe siècle, patio central avec fontaine, décoration zellige et bois sculpté. À deux pas de la Grande Mosquée de Tlemcen.",           location:"Tlemcen",          wilaya:"Tlemcen",     category:"riad",     price:8500,  guests:4,  beds:2, baths:1, image:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80", rating:4.88, reviews:212 },
  { title:"Chalet en bois dans les Aurès",    description:"Chaleureux chalet niché au cœur du massif des Aurès, cheminée crépitante, forêt de cèdres millénaires. Randonnées et découverte berbère.",                  location:"Batna",            wilaya:"Batna",       category:"montagne", price:9800,  guests:8,  beds:4, baths:2, image:"https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=80", rating:4.95, reviews:67  },
  { title:"Appartement vue mer à Skikda",     description:"Appartement moderne avec balcon face à la mer, accès direct à une plage de sable fin, proche du port de Skikda.",                                            location:"Skikda",           wilaya:"Skikda",      category:"plage",    price:7200,  guests:4,  beds:2, baths:1, image:"https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80", rating:4.80, reviews:144 },
  { title:"Maison de charme à la campagne",   description:"Vaste ferme rénovée avec potager bio, vue sur les oliveraies et la montagne de l'Atlas blidéen. Idéal pour se ressourcer.",                                  location:"Médéa",            wilaya:"Médéa",       category:"maison",   price:5500,  guests:6,  beds:3, baths:2, image:"https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=800&q=80", rating:4.76, reviews:33  },
  { title:"Villa piscine & jardin tropical",  description:"Luxueuse villa dotée d'une grande piscine à débordement, barbecue extérieur, jardin tropical et terrasse couverte avec vue sur la mer.",                    location:"Annaba",           wilaya:"Annaba",      category:"piscine",  price:16500, guests:8,  beds:4, baths:3, image:"https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80", rating:4.91, reviews:77  },
];
const SEED_COORDS = [
  { lat:36.5911, lng:2.4483  }, { lat:22.7851, lng:5.5228  },
  { lat:35.6974, lng:-0.6341 }, { lat:34.8800, lng:-1.3200 },
  { lat:35.5559, lng:6.1741  }, { lat:36.8767, lng:6.9053  },
  { lat:36.2638, lng:2.7529  }, { lat:36.9000, lng:7.7667  },
];
const SEED_PHOTOS = [
  ["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80","https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&q=80","https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80","https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80"],
  ["https://images.unsplash.com/photo-1451337516015-6b6e9a44a8a3?w=800&q=80","https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80","https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80","https://images.unsplash.com/photo-1494783367193-149034c05e8f?w=800&q=80"],
  ["https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80","https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80","https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=800&q=80","https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80"],
  ["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80","https://images.unsplash.com/photo-1555993539-1732b0258235?w=800&q=80","https://images.unsplash.com/photo-1585543805890-6051f7829f98?w=800&q=80","https://images.unsplash.com/photo-1590381105924-c72589b9ef3f?w=800&q=80"],
  ["https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=80","https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=80","https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80","https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80"],
  ["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80","https://images.unsplash.com/photo-1499678329028-101435549a4e?w=800&q=80","https://images.unsplash.com/photo-1495954484750-af469f2f9be5?w=800&q=80","https://images.unsplash.com/photo-1473496169904-658ba7574b0d?w=800&q=80"],
  ["https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=800&q=80","https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=80","https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80","https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80"],
  ["https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80","https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80","https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=80","https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800&q=80"],
];

async function seed() {
  const hash = bcrypt.hashSync('demo1234', 10);
  await pool.query(
    `INSERT INTO users (name, email, password, is_host, is_admin, verified)
     VALUES ($1,$2,$3,true,false,true) ON CONFLICT (email) DO NOTHING`,
    ['Locavac Demo', 'demo@locavac.dz', hash]
  );
  const hostRow = await pool.query(`SELECT id FROM users WHERE email = 'demo@locavac.dz'`);
  const hostId  = hostRow.rows[0].id;
  const listingCount = await pool.query(`SELECT COUNT(*) FROM listings`);
  if (parseInt(listingCount.rows[0].count) === 0) {
    for (let i = 0; i < SEED_LISTINGS.length; i++) {
      const s = SEED_LISTINGS[i];
      await pool.query(
        `INSERT INTO listings (host_id,title,description,location,wilaya,category,price,guests,beds,baths,image,photos,lat,lng,rating,reviews,available)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)`,
        [hostId, s.title, s.description, s.location, s.wilaya, s.category, s.price,
         s.guests, s.beds, s.baths, s.image, JSON.stringify(SEED_PHOTOS[i]),
         SEED_COORDS[i].lat, SEED_COORDS[i].lng, s.rating, s.reviews]
      );
    }
    console.log('✅ Base de données initialisée.');
  }
}

async function connect() {
  await pool.query('SELECT 1');
  await initSchema();
  const migrate = require('./migrate');
  await migrate(pool);
  await seed();
  console.log('🐘 PostgreSQL connecté');
}

module.exports = { users, listings, reservations, reviews, payments, messages, payouts, connect, pool };
