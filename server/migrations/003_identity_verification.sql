-- Vérification d'identité des utilisateurs
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_verified  BOOLEAN DEFAULT false;
