-- Données d'exemple — Établissements partenaires (publicites)
-- Exécuter : psql -U locavac -d locavac -p 5433 -f seed-publicites.sql

INSERT INTO publicites (nom, type, wilaya, ville, description, telephone, site_web, email_contact, etoiles, forfait, actif) VALUES

-- ── Hôtels ──────────────────────────────────────────────────
('Hôtel El Djazaïr', 'hotel', 'Alger', 'Alger-Centre',
 'Ancien palais colonial du XIXe siècle transformé en hôtel de luxe. Jardins andalous, piscine, spa et restaurant gastronomique avec vue sur la baie d''Alger.',
 '+213 21 23 21 23', 'https://www.hoteldjazair.dz', 'reservation@hoteldjazair.dz', 5, 'vedette', true),

('Sheraton Oran Hotel & Convention Center', 'hotel', 'Oran', 'Oran',
 'Hôtel 5 étoiles au cœur d''Oran, salles de conférence, piscine, fitness center et vue panoramique sur la Méditerranée.',
 '+213 41 40 40 40', 'https://www.marriott.com', 'info@sheraton-oran.dz', 5, 'vedette', true),

('Hôtel Cirta Constantine', 'hotel', 'Constantine', 'Constantine',
 'Établissement incontournable de la ville du Vieux Rocher, au cœur de Constantine. Terrasse avec vue spectaculaire sur les gorges du Rhumel.',
 '+213 31 92 18 25', NULL, 'cirta@hotel-constantine.dz', 4, 'premium', true),

('Hôtel Riadh Palms', 'hotel', 'Skikda', 'Collo',
 'Complexe hôtelier en bord de mer à Collo, plages privées, bungalows et animations estivales. Idéal pour les familles.',
 '+213 38 76 00 00', NULL, 'contact@riadh-palms.dz', 4, 'premium', true),

('Hôtel Tahat', 'hotel', 'Tamanrasset', 'Tamanrasset',
 'Hôtel de référence au cœur du Hoggar. Point de départ idéal pour les excursions vers l''Assekrem, Djanet et les paysages désertiques.',
 '+213 29 73 42 55', NULL, 'tahat@hotel-tam.dz', 3, 'basic', true),

-- ── Campings ─────────────────────────────────────────────────
('Camping Plage de Tigzirt', 'camping', 'Tizi Ouzou', 'Tigzirt',
 'Camping familial en première ligne de mer à Tigzirt-sur-Mer. Emplacements pour tentes et caravanes, sanitaires modernes, snack et location de pédalos.',
 '+213 26 32 10 47', NULL, 'campingtigzirt@gmail.com', 0, 'premium', true),

('Camping Désert Aventure', 'camping', 'Tamanrasset', 'In Salah',
 'Bivouac équipé au cœur du Grand Erg. Yourtes sahariennes, dîner traditionnel targui, sorties en quad et balade en dromadaire. Nuits sous les étoiles garanties.',
 '+213 29 46 80 12', NULL, 'sahara@desert-aventure.dz', 0, 'vedette', true),

('Camping Les Cèdres — Chréa', 'camping', 'Blida', 'Chréa',
 'Camping d''altitude à 1 500 m dans le parc national de Chréa. Forêt de cèdres centenaires, barbecue, sentiers de randonnée balisés.',
 '+213 25 37 92 00', NULL, NULL, 0, 'basic', true),

-- ── Complexes touristiques ────────────────────────────────────
('Complexe Touristique Les Andalouses', 'complexe', 'Oran', 'Aïn El Turk',
 'Vaste complexe balnéaire sur la côte oranaise. Piscines olympiques, plage privée, bungalows, restaurants, discothèque et animations pour enfants.',
 '+213 41 48 00 00', 'https://www.lesandalouses.dz', 'resa@lesandalouses.dz', 0, 'vedette', true),

('Club Med Zeralda', 'complexe', 'Alger', 'Zeralda',
 'Club de vacances tout inclus à Zeralda, 30 km à l''ouest d''Alger. Sports nautiques, activités encadrées, animations, buffets internationaux.',
 '+213 21 39 01 10', 'https://www.clubmed.dz', 'contact@clubmed-zeralda.dz', 0, 'vedette', true),

('Complexe Touristique Cap Blanc', 'complexe', 'Annaba', 'Seraïdi',
 'Complexe de montagne à 900 m d''altitude dans la forêt de Seraïdi, à 15 km d''Annaba. Chalets, restaurant panoramique, piscine chauffée.',
 '+213 38 86 05 30', NULL, 'capblanc@annaba.dz', 0, 'premium', true),

('Complexe Touristique Moretti', 'complexe', 'Alger', 'Moretti',
 'Complexe en bord de mer à Moretti (Alger). Studios et appartements meublés, piscine, restaurant poissons, accès direct à la plage.',
 '+213 21 96 44 00', NULL, NULL, 0, 'basic', true)

ON CONFLICT DO NOTHING;
