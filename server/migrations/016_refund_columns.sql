-- Colonnes de remboursement manquantes dans la table payments
-- Utilisées par PATCH /api/reservations/:id/status lors d'une annulation
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_amount NUMERIC;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_pct    SMALLINT;
