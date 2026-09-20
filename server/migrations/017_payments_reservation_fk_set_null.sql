-- La suppression d'une annonce supprime ses réservations en cascade ; sans ON DELETE, la clé
-- étrangère payments.reservation_id faisait échouer toute suppression d'annonce ayant un paiement.
-- L'historique financier est conservé, la référence à la réservation est simplement mise à NULL.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_reservation_id_fkey;
ALTER TABLE payments
  ADD CONSTRAINT payments_reservation_id_fkey
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;
