-- Politique d'annulation des logements
ALTER TABLE listings ADD COLUMN IF NOT EXISTS cancellation_policy TEXT DEFAULT 'flexible';
