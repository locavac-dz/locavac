-- Données d'exemple — Établissements partenaires (publicites)
-- Exécuter : psql -U locavac -d locavac -p 5433 -f server/seed-publicites.sql

INSERT INTO publicites (nom, type, wilaya, ville, description, telephone, site_web, email_contact, etoiles, forfait, actif, logo, images) VALUES

-- ── Hôtels ──────────────────────────────────────────────────
('Hôtel El Djazaïr', 'hotel', 'Alger', 'Alger-Centre',
 'Ancien palais colonial du XIXe siècle transformé en hôtel de luxe. Jardins andalous, piscine, spa et restaurant gastronomique avec vue sur la baie d''Alger.',
 '+213 21 23 21 23', 'https://www.hoteldjazair.dz', 'reservation@hoteldjazair.dz', 5, 'vedette', true,
 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80',
 '["https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80","https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80","https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=800&q=80"]'),

('Sheraton Oran Hotel & Convention Center', 'hotel', 'Oran', 'Oran',
 'Hôtel 5 étoiles au cœur d''Oran, salles de conférence, piscine, fitness center et vue panoramique sur la Méditerranée.',
 '+213 41 40 40 40', 'https://www.marriott.com', 'info@sheraton-oran.dz', 5, 'vedette', true,
 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80',
 '["https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800&q=80","https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80","https://images.unsplash.com/photo-1568084680786-a84f91d1153c?w=800&q=80"]'),

('Hôtel Cirta Constantine', 'hotel', 'Constantine', 'Constantine',
 'Établissement incontournable de la ville du Vieux Rocher, au cœur de Constantine. Terrasse avec vue spectaculaire sur les gorges du Rhumel.',
 '+213 31 92 18 25', NULL, 'cirta@hotel-constantine.dz', 4, 'premium', true,
 'https://images.unsplash.com/photo-1455587734955-081b22074882?w=800&q=80',
 '["https://images.unsplash.com/photo-1444201983204-c43cbd584d93?w=800&q=80","https://images.unsplash.com/photo-1495365200479-c4ed1d35e1aa?w=800&q=80"]'),

('Hôtel Riadh Palms', 'hotel', 'Skikda', 'Collo',
 'Complexe hôtelier en bord de mer à Collo, plages privées, bungalows et animations estivales. Idéal pour les familles.',
 '+213 38 76 00 00', NULL, 'contact@riadh-palms.dz', 4, 'premium', true,
 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&q=80',
 '["https://images.unsplash.com/photo-1499678329028-101435549a4e?w=800&q=80","https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80"]'),

('Hôtel Tahat', 'hotel', 'Tamanrasset', 'Tamanrasset',
 'Hôtel de référence au cœur du Hoggar. Point de départ idéal pour les excursions vers l''Assekrem, Djanet et les paysages désertiques.',
 '+213 29 73 42 55', NULL, 'tahat@hotel-tam.dz', 3, 'basic', true,
 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80',
 '["https://images.unsplash.com/photo-1451337516015-6b6e9a44a8a3?w=800&q=80","https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80"]'),

-- ── Campings ─────────────────────────────────────────────────
('Camping Plage de Tigzirt', 'camping', 'Tizi Ouzou', 'Tigzirt',
 'Camping familial en première ligne de mer à Tigzirt-sur-Mer. Emplacements pour tentes et caravanes, sanitaires modernes, snack et location de pédalos.',
 '+213 26 32 10 47', NULL, 'campingtigzirt@gmail.com', 0, 'premium', true,
 'https://images.unsplash.com/photo-1473496169904-658ba7574b0d?w=800&q=80',
 '["https://images.unsplash.com/photo-1499678329028-101435549a4e?w=800&q=80","https://images.unsplash.com/photo-1495954484750-af469f2f9be5?w=800&q=80"]'),

('Camping Désert Aventure', 'camping', 'Tamanrasset', 'In Salah',
 'Bivouac équipé au cœur du Grand Erg. Yourtes sahariennes, dîner traditionnel targui, sorties en quad et balade en dromadaire. Nuits sous les étoiles garanties.',
 '+213 29 46 80 12', NULL, 'sahara@desert-aventure.dz', 0, 'vedette', true,
 'https://images.unsplash.com/photo-1494783367193-149034c05e8f?w=800&q=80',
 '["https://images.unsplash.com/photo-1542621334-a254cf47733d?w=800&q=80","https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80"]'),

('Camping Les Cèdres — Chréa', 'camping', 'Blida', 'Chréa',
 'Camping d''altitude à 1 500 m dans le parc national de Chréa. Forêt de cèdres centenaires, barbecue, sentiers de randonnée balisés.',
 '+213 25 37 92 00', NULL, NULL, 0, 'basic', true,
 'https://images.unsplash.com/photo-1516726817505-f5ed825624d8?w=800&q=80',
 '["https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80","https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80"]'),

-- ── Complexes touristiques ────────────────────────────────────
('Complexe Touristique Les Andalouses', 'complexe', 'Oran', 'Aïn El Turk',
 'Vaste complexe balnéaire sur la côte oranaise. Piscines olympiques, plage privée, bungalows, restaurants, discothèque et animations pour enfants.',
 '+213 41 48 00 00', 'https://www.lesandalouses.dz', 'resa@lesandalouses.dz', 0, 'vedette', true,
 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&q=80',
 '["https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80","https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=80","https://images.unsplash.com/photo-1596178060671-7a80dc8059ea?w=800&q=80"]'),

('Club Med Zeralda', 'complexe', 'Alger', 'Zeralda',
 'Club de vacances tout inclus à Zeralda, 30 km à l''ouest d''Alger. Sports nautiques, activités encadrées, animations, buffets internationaux.',
 '+213 21 39 01 10', 'https://www.clubmed.dz', 'contact@clubmed-zeralda.dz', 0, 'vedette', true,
 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80',
 '["https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800&q=80","https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80","https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=800&q=80"]'),

('Complexe Touristique Cap Blanc', 'complexe', 'Annaba', 'Seraïdi',
 'Complexe de montagne à 900 m d''altitude dans la forêt de Seraïdi, à 15 km d''Annaba. Chalets, restaurant panoramique, piscine chauffée.',
 '+213 38 86 05 30', NULL, 'capblanc@annaba.dz', 0, 'premium', true,
 'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=80',
 '["https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=80","https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?w=800&q=80"]'),

('Complexe Touristique Moretti', 'complexe', 'Alger', 'Moretti',
 'Complexe en bord de mer à Moretti (Alger). Studios et appartements meublés, piscine, restaurant poissons, accès direct à la plage.',
 '+213 21 96 44 00', NULL, NULL, 0, 'basic', true,
 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80',
 '["https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80","https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80"]')

ON CONFLICT DO NOTHING;
