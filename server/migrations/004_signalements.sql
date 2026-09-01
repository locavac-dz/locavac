-- Signalements d'annonces par les utilisateurs
CREATE TABLE IF NOT EXISTS signalements (
  id         SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  user_id    INTEGER,
  motif      TEXT,
  message    TEXT,
  status     TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
