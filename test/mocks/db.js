const bcrypt = require('bcryptjs');

// Hash pré-calculé pour 'MotDePasse123!' (évite le recalcul à chaque test)
const VALID_HASH = bcrypt.hashSync('MotDePasse123!', 10);

// Utilisateurs de test
const USERS = {
  1:  { id: 1,  name: 'Hôte Test',   email: 'host@test.dz',   password: VALID_HASH, is_host: true,  banned: false, is_admin: false },
  2:  { id: 2,  name: 'Guest Test',  email: 'guest@test.dz',  password: VALID_HASH, is_host: false, banned: false, is_admin: false },
  99: { id: 99, name: 'Guest Test',  email: 'guest@test.dz',  password: VALID_HASH, is_host: false, banned: false, is_admin: false },
};
const BANNED_USER = { id: 3, name: 'Banni', email: 'banned@test.dz', password: VALID_HASH, banned: true };

// Annonce de test : max 2 voyageurs
const LISTING_1 = {
  id: 1, host_id: 1, title: 'Villa de test', location: 'Alger', wilaya: 'Alger',
  category: 'villa', price: 5000, guests: 2, beds: 2, baths: 1,
  available: true, rating: 0, reviews: 0, blocked_ranges: [],
  cancellation_policy: 'flexible',
};

// pool.query est utilisé directement par le middleware auth
// Il faut simuler SELECT id, banned FROM users WHERE id = $1
const pool = {
  query: jest.fn((sql, params) => {
    const id = params && params[0];
    if (id === 3) return Promise.resolve({ rows: [{ id: 3, banned: true }] });
    if (USERS[id])  return Promise.resolve({ rows: [{ id, banned: false }] });
    return Promise.resolve({ rows: [] });
  }),
  connect: jest.fn().mockResolvedValue({
    query:   jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  }),
};

module.exports = {
  pool,
  connect: jest.fn().mockResolvedValue(),

  users: {
    findById:   jest.fn(id => Promise.resolve(USERS[id] || (id === 3 ? BANNED_USER : null))),
    findByIds:  jest.fn(ids => Promise.resolve(ids.map(id => USERS[id]).filter(Boolean))),
    findByEmail:jest.fn(email => {
      if (email === 'banned@test.dz') return Promise.resolve(BANNED_USER);
      const u = Object.values(USERS).find(u => u.email === email);
      return Promise.resolve(u || null);
    }),
    create:     jest.fn(data => Promise.resolve({ id: 100, ...data })),
    updateById: jest.fn().mockResolvedValue(),
    findAll:    jest.fn().mockResolvedValue([]),
    search:     jest.fn().mockResolvedValue([]),
  },

  listings: {
    findById:    jest.fn(id => Promise.resolve(id === 1 ? LISTING_1 : null)),
    findByIds:   jest.fn(ids => Promise.resolve(ids.map(id => id === 1 ? LISTING_1 : null).filter(Boolean))),
    findByHost:  jest.fn().mockResolvedValue([LISTING_1]),
    search:      jest.fn().mockResolvedValue([LISTING_1]),
    create:      jest.fn(data => Promise.resolve({ id: 200, ...data })),
    updateById:  jest.fn().mockResolvedValue(),
    deleteById:  jest.fn().mockResolvedValue(),
    setAvailableByHost: jest.fn().mockResolvedValue(),
  },

  reservations: {
    findById:       jest.fn().mockResolvedValue(null),
    findByGuest:    jest.fn().mockResolvedValue([]),
    findByListing:  jest.fn().mockResolvedValue([]),
    findByListings: jest.fn().mockResolvedValue([]),
    create:         jest.fn(data => Promise.resolve({ id: 300, ...data })),
    updateById:     jest.fn().mockResolvedValue(),
  },

  reviews: {
    findByListing:      jest.fn().mockResolvedValue([]),
    findByListings:     jest.fn().mockResolvedValue([]),
    reviewedListingIds: jest.fn().mockResolvedValue(new Set()),
    create:             jest.fn(data => Promise.resolve({ id: 400, ...data })),
  },

  messages: {
    findByUser:    jest.fn().mockResolvedValue([]),
    findThread:    jest.fn().mockResolvedValue([]),
    markThreadRead:jest.fn().mockResolvedValue(),
    countUnread:   jest.fn().mockResolvedValue(0),
    create:        jest.fn(data => Promise.resolve({ id: 500, ...data })),
    deleteByUser:  jest.fn().mockResolvedValue(),
  },

  payments: {
    findById:                jest.fn().mockResolvedValue(null),
    findByIds:               jest.fn().mockResolvedValue([]),
    findSuccessByReservation:jest.fn().mockResolvedValue(null),
    create:                  jest.fn(data => Promise.resolve({ id: 600, ...data })),
    updateById:              jest.fn().mockResolvedValue(),
  },

  payouts: {
    findAll:    jest.fn().mockResolvedValue([]),
    findByHost: jest.fn().mockResolvedValue([]),
    findById:   jest.fn().mockResolvedValue(null),
    create:     jest.fn(data => Promise.resolve({ id: 700, ...data })),
    updateById: jest.fn().mockResolvedValue(),
  },

  signalements: {
    create:    jest.fn().mockResolvedValue({ id: 800 }),
    findAll:   jest.fn().mockResolvedValue([]),
    updateById:jest.fn().mockResolvedValue(),
  },

  publicites: {
    findActive: jest.fn().mockResolvedValue([]),
    findAll:    jest.fn().mockResolvedValue([]),
    create:     jest.fn().mockResolvedValue({ id: 900 }),
    updateById: jest.fn().mockResolvedValue(),
    deleteById: jest.fn().mockResolvedValue(),
  },

  newsletter: {
    subscribe:   jest.fn().mockResolvedValue({ id: 1000 }),
    unsubscribe: jest.fn().mockResolvedValue(),
  },

  alerts: {
    findByUser:  jest.fn().mockResolvedValue([]),
    create:      jest.fn().mockResolvedValue({ id: 1100 }),
    deleteById:  jest.fn().mockResolvedValue(),
  },

  availability: {
    findByListing: jest.fn().mockResolvedValue([]),
  },
};
