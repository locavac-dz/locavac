-- Pages publicitaires établissements (hôtels / campings / complexes)
CREATE TABLE IF NOT EXISTS publicites (
  id              SERIAL PRIMARY KEY,
  nom             TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('hotel','camping','complexe')),
  wilaya          TEXT NOT NULL,
  ville           TEXT,
  description     TEXT,
  logo            TEXT,
  images          JSONB DEFAULT '[]',
  telephone       TEXT,
  email_contact   TEXT,
  site_web        TEXT,
  adresse         TEXT,
  etoiles         INTEGER DEFAULT 0,
  forfait         TEXT DEFAULT 'basic',
  actif           BOOLEAN DEFAULT true,
  expire_le       DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
