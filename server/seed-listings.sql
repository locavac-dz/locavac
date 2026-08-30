-- Données de démonstration — Logements (listings)
-- Exécuter : psql -U locavac -d locavac -p 5433 -f server/seed-listings.sql

-- ── Hôte de démonstration ──────────────────────────────────────
INSERT INTO users (name, email, password, phone, bio, is_host, verified)
VALUES (
  'Équipe Locavac',
  'demo@locavac.dz',
  '$2a$10$wQPNfaPHexKocj4W5EgRo.dl.s2/Q6NfG733NLfT9RLJItBUHzidu',
  '+213 21 00 00 00',
  'Logements de démonstration sélectionnés par l''équipe Locavac pour vous faire découvrir la plateforme.',
  true,
  true
) ON CONFLICT (email) DO NOTHING;

-- ── Annonces ──────────────────────────────────────────────────
-- Récupérer l'id du host demo
DO $$
DECLARE h INTEGER;
BEGIN
  SELECT id INTO h FROM users WHERE email = 'demo@locavac.dz';

  INSERT INTO listings
    (host_id, title, description, location, wilaya, category, price, guests, beds, baths, image, photos, rating, reviews, available)
  VALUES

  -- ── PLAGES ───────────────────────────────────────────────────
  (h,
   'Villa pieds dans l''eau — Tipaza',
   'Magnifique villa de plain-pied directement sur la plage de Tipaza, face aux ruines romaines classées UNESCO. Terrasse privée, barbecue, accès direct au sable blanc. Vue imprenable sur la mer.',
   'Tipaza centre', 'Tipaza', 'plage', 8500, 6, 3, 2,
   'https://images.unsplash.com/photo-1499678329028-101435549a4e?w=800&q=80',
   '["https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80","https://images.unsplash.com/photo-1455587734955-081b22074882?w=800&q=80","https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80"]',
   4.9, 48, true),

  (h,
   'Appartement vue mer — Béjaïa',
   'Appartement moderne au 4ème étage avec balcon et panorama sur la baie de Béjaïa. À 5 minutes à pied de la plage Tichi. Idéal pour couples et petites familles.',
   'Béjaïa, Tichi', 'Béjaïa', 'plage', 4200, 4, 2, 1,
   'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80',
   '["https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800&q=80","https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80"]',
   4.7, 31, true),

  (h,
   'Bungalow de charme — Jijel',
   'Bungalow en bois exotique niché dans la forêt de pins qui surplombe les Cornouilles de Jijel. Plage naturelle préservée à 200 m, eau turquoise, snorkeling exceptionnel.',
   'Les Cornouilles, Jijel', 'Jijel', 'plage', 5500, 5, 2, 1,
   'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=800&q=80',
   '["https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80","https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=800&q=80"]',
   4.8, 22, true),

  (h,
   'Maison de pêcheur — Annaba',
   'Ancienne maison de pêcheur rénovée dans la vieille ville d''Annaba, à 50 m de la plage de Seybouse. Cour intérieure ombragée, cuisine équipée, authentique.',
   'Annaba, plage El Battah', 'Annaba', 'plage', 3800, 6, 3, 1,
   'https://images.unsplash.com/photo-1448630360428-65456885c650?w=800&q=80',
   '["https://images.unsplash.com/photo-1495954484750-af469f2f9be5?w=800&q=80","https://images.unsplash.com/photo-1473496169904-658ba7574b0d?w=800&q=80"]',
   4.5, 17, true),

  -- ── SAHARA ───────────────────────────────────────────────────
  (h,
   'Tente Touareg de luxe — Tamanrasset',
   'Bivouac premium au cœur du Hoggar, à 40 km d''Assekrem. Tente spacieuse avec literie confortable, repas targuis inclus, guide local disponible. Couchers de soleil sur les roches volcaniques inoubliables.',
   'Hoggar, Tamanrasset', 'Tamanrasset', 'sahara', 12000, 2, 1, 1,
   'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80',
   '["https://images.unsplash.com/photo-1451337516015-6b6e9a44a8a3?w=800&q=80","https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80","https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80"]',
   5.0, 14, true),

  (h,
   'Ksar rénové — Timimoun',
   'Maison traditionnelle en pisé rouge rénovée dans l''oasis de Timimoun. Salon berbère, terrasse sur les dunes, piscine naturelle d''oasis. Accès aux palmeraies et aux ksour alentour.',
   'Timimoun centre', 'Adrar', 'sahara', 7500, 4, 2, 1,
   'https://images.unsplash.com/photo-1494783367193-149034c05e8f?w=800&q=80',
   '["https://images.unsplash.com/photo-1542621334-a254cf47733d?w=800&q=80","https://images.unsplash.com/photo-1516726817505-f5ed825624d8?w=800&q=80"]',
   4.9, 9, true),

  (h,
   'Chambre d''hôtes — Djanet',
   'Chambre privée chez Mohand, guide saharien. Jardin de palmiers, repas maison inclus au dîner. Porte d''entrée du Tassili n''Ajjer, classé UNESCO. Excursions organisées sur demande.',
   'Djanet ville', 'Illizi', 'sahara', 5200, 2, 1, 1,
   'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80',
   '["https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80","https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80"]',
   4.8, 26, true),

  -- ── MONTAGNE ─────────────────────────────────────────────────
  (h,
   'Chalet en forêt de cèdres — Tikjda',
   'Chalet bois et pierre à 1 800 m d''altitude dans le parc national du Djurdjura. Cheminée, vue sur les crêtes enneigées en hiver, randonnées depuis le chalet. Idéal pour se ressourcer.',
   'Tikjda, Bouira', 'Bouira', 'montagne', 6500, 6, 3, 2,
   'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=80',
   '["https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=80","https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?w=800&q=80","https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80"]',
   4.9, 19, true),

  (h,
   'Gîte Aurès — Batna',
   'Gîte rural typique dans les gorges de Tighanimine (Aurès). Mouton grillé traditionnel, hammam, excursions vers Timgad (Lambèse romain, classé UNESCO) et Ghoufi.',
   'Ghoufi, Batna', 'Batna', 'montagne', 4800, 8, 4, 2,
   'https://images.unsplash.com/photo-1516726817505-f5ed825624d8?w=800&q=80',
   '["https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80","https://images.unsplash.com/photo-1473496169904-658ba7574b0d?w=800&q=80"]',
   4.6, 11, true),

  -- ── VILLAS ───────────────────────────────────────────────────
  (h,
   'Villa avec piscine — Club des Pins, Alger',
   'Villa contemporaine 5 chambres avec piscine chauffée dans le quartier résidentiel du Club des Pins, à l''ouest d''Alger. Jardin méditerranéen, salle de sport, parking sécurisé.',
   'Club des Pins, Alger', 'Alger', 'villa', 28000, 10, 5, 3,
   'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80',
   '["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80","https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80","https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80"]',
   4.8, 34, true),

  (h,
   'Villa Andalouse — Oran',
   'Villa de style andalou avec patio central et fontaine, nichée dans les hauteurs d''Oran. Vue sur la baie, terrasse arborée, 4 chambres climatisées. À 15 min du centre-ville.',
   'Hai Fellaoucene, Oran', 'Oran', 'villa', 18500, 8, 4, 2,
   'https://images.unsplash.com/photo-1580418827493-f2b22c0a76cb?w=800&q=80',
   '["https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80","https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=800&q=80"]',
   4.7, 27, true),

  -- ── RIADS ────────────────────────────────────────────────────
  (h,
   'Riad de la Casbah — Alger',
   'Riad du XVIIIe siècle entièrement restauré au cœur de la Casbah d''Alger (UNESCO). Géraniums, zellige, galerie à colonnes. Petit-déjeuner maison inclus. Expérience authentique unique.',
   'Casbah, Alger', 'Alger', 'riad', 9500, 4, 2, 1,
   'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&q=80',
   '["https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80","https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=80"]',
   4.9, 41, true),

  (h,
   'Dar Zitoun — Tlemcen',
   'Maison traditionnelle tlemcénienne entourée d''oliviers centenaires, à deux pas de la Grande Mosquée et du Méchouar. Salon marocain, terrasse jasminée, fontaine.',
   'Médina, Tlemcen', 'Tlemcen', 'riad', 7200, 6, 3, 2,
   'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80',
   '["https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80","https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80"]',
   4.8, 23, true),

  -- ── PISCINE ──────────────────────────────────────────────────
  (h,
   'Penthouse avec piscine sur toit — Alger',
   'Penthouse luxueux au 12ème étage avec piscine à débordement sur le toit donnant sur la baie d''Alger. Cuisine américaine haut de gamme, smart TV, concierge disponible.',
   'Hydra, Alger', 'Alger', 'piscine', 22000, 4, 2, 2,
   'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&q=80',
   '["https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80","https://images.unsplash.com/photo-1596178060671-7a80dc8059ea?w=800&q=80"]',
   4.9, 18, true),

  -- ── CAMPAGNE ─────────────────────────────────────────────────
  (h,
   'Ferme agrotouristique — Kabylie',
   'Ferme familiale kabyle sur 2 hectares d''oliviers et de figuiers à Ait Yahia Moussa. Randonnée, cueillette, repas traditionnel (couscous, chekhchoukha). Accueil chaleureux garanti.',
   'Ait Yahia Moussa, Tizi Ouzou', 'Tizi Ouzou', 'maison', 3500, 8, 4, 2,
   'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80',
   '["https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80","https://images.unsplash.com/photo-1516726817505-f5ed825624d8?w=800&q=80"]',
   4.9, 37, true),

  (h,
   'Maison de montagne — Chréa',
   'Maison en pierre traditionnelle dans le village de Chréa, à 1 500 m d''altitude, au cœur du Parc National de Chréa. Forêt de cèdres à la porte, air pur, déconnexion totale.',
   'Chréa, Blida', 'Blida', 'maison', 4200, 6, 3, 1,
   'https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=80',
   '["https://images.unsplash.com/photo-1505765050516-f72dcac9c60e?w=800&q=80","https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=80"]',
   4.7, 28, true);

END $$;
