-- Migration 014 — Index sur les colonnes fréquemment filtrées
-- Tous les CREATE INDEX sont CONCURRENT-safe (IF NOT EXISTS)

-- listings
CREATE INDEX IF NOT EXISTS idx_listings_host_id   ON listings(host_id);
CREATE INDEX IF NOT EXISTS idx_listings_available  ON listings(available);
CREATE INDEX IF NOT EXISTS idx_listings_wilaya     ON listings(wilaya);
CREATE INDEX IF NOT EXISTS idx_listings_category   ON listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_rating     ON listings(rating DESC);

-- reservations
CREATE INDEX IF NOT EXISTS idx_reservations_listing_id ON reservations(listing_id);
CREATE INDEX IF NOT EXISTS idx_reservations_guest_id   ON reservations(guest_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status     ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_check_in   ON reservations(check_in);
CREATE INDEX IF NOT EXISTS idx_reservations_check_out  ON reservations(check_out);

-- reviews
CREATE INDEX IF NOT EXISTS idx_reviews_listing_id ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_author_id  ON reviews(author_id);

-- payments
CREATE INDEX IF NOT EXISTS idx_payments_reservation_id ON payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id        ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status         ON payments(status);

-- messages
CREATE INDEX IF NOT EXISTS idx_messages_from_id    ON messages(from_id);
CREATE INDEX IF NOT EXISTS idx_messages_to_id      ON messages(to_id);
CREATE INDEX IF NOT EXISTS idx_messages_listing_id ON messages(listing_id);
CREATE INDEX IF NOT EXISTS idx_messages_read       ON messages(read) WHERE read = false;

-- payouts
CREATE INDEX IF NOT EXISTS idx_payouts_host_id ON payouts(host_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status  ON payouts(status);

-- users
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_host   ON users(is_host) WHERE is_host = true;
CREATE INDEX IF NOT EXISTS idx_users_banned    ON users(banned) WHERE banned = true;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
