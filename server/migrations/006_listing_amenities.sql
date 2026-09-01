-- Équipements / commodités des logements
ALTER TABLE listings ADD COLUMN IF NOT EXISTS amenities JSONB DEFAULT '[]';
