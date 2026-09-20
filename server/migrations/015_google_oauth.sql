-- Connexion OAuth Google
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
-- Les comptes créés via Google n'ont pas de mot de passe local
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
