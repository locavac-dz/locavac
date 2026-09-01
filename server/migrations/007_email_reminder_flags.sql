-- Flags anti-doublon pour les crons d'emails transactionnels
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS checkin_reminded BOOLEAN DEFAULT false;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_reminded  BOOLEAN DEFAULT false;
