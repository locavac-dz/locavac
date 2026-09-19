// Variables d'environnement pour les tests — doit être chargé avant tout require du serveur
process.env.NODE_ENV    = 'test';
process.env.JWT_SECRET  = 'locavac-test-secret-key-2026';
process.env.JWT_EXPIRES_IN = '1d';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgresql://localhost:5432/locavac_test';
