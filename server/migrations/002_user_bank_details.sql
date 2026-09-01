-- Coordonnées bancaires hôte (RIB / CCP) pour les virements de commission
ALTER TABLE users ADD COLUMN IF NOT EXISTS rib TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ccp TEXT;
