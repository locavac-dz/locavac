-- Schéma de base Locavac — tables fondamentales uniquement.
-- Les évolutions (ALTER TABLE, nouvelles tables) sont dans server/migrations/.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password      TEXT NOT NULL,
  phone         TEXT,
  bio           TEXT,
  avatar        TEXT,
  is_host       BOOLEAN DEFAULT false,
  is_admin      BOOLEAN DEFAULT false,
  verified      BOOLEAN DEFAULT false,
  banned        BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id              SERIAL PRIMARY KEY,
  host_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  location        TEXT,
  wilaya          TEXT,
  category        TEXT,
  price           NUMERIC NOT NULL,
  guests          INTEGER DEFAULT 1,
  beds            INTEGER DEFAULT 1,
  baths           INTEGER DEFAULT 1,
  image           TEXT,
  photos          JSONB DEFAULT '[]',
  blocked_ranges  JSONB DEFAULT '[]',
  lat             NUMERIC,
  lng             NUMERIC,
  rating          NUMERIC DEFAULT 0,
  reviews         INTEGER DEFAULT 0,
  available       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservations (
  id            SERIAL PRIMARY KEY,
  listing_id    INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  guest_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  check_in      DATE NOT NULL,
  check_out     DATE NOT NULL,
  guests_count  INTEGER DEFAULT 1,
  total_price   NUMERIC,
  status        TEXT DEFAULT 'pending',
  payment_id    INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id              SERIAL PRIMARY KEY,
  listing_id      INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  author_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user_id         INTEGER,
  reservation_id  INTEGER,
  rating          NUMERIC,
  comment         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id              SERIAL PRIMARY KEY,
  reservation_id  INTEGER REFERENCES reservations(id),
  user_id         INTEGER REFERENCES users(id),
  amount          NUMERIC,
  currency        TEXT DEFAULT 'DZD',
  method          TEXT,
  status          TEXT DEFAULT 'pending',
  reference       TEXT,
  card_masked     TEXT,
  card_type       TEXT,
  processed_at    TIMESTAMPTZ,
  error_code      TEXT,
  error_msg       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  from_id     INTEGER REFERENCES users(id),
  to_id       INTEGER REFERENCES users(id),
  listing_id  INTEGER,
  body        TEXT,
  read        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
