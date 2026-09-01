-- Demandes de virement hôtes
CREATE TABLE IF NOT EXISTS payouts (
  id           SERIAL PRIMARY KEY,
  host_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount       NUMERIC NOT NULL,
  status       TEXT DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  admin_note   TEXT
);
