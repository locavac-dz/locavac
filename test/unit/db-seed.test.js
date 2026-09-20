// Le compte de démonstration (demo@locavac.dz / demo1234) et ses 8 annonces ne doivent jamais être créés
// en production : le mot de passe est public, et l'attaquant qui s'y connecte devient l'hôte de la page d'accueil.
const mockQueries = [];
jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(sql => {
      mockQueries.push(String(sql));
      // Réponse générique compatible avec tous les appels de connect() : migrations, compte démo, comptage
      return Promise.resolve({ rows: [{ id: 1, count: '0', filename: '__aucune__' }], rowCount: 0 });
    }),
  })),
}));

const ORIGINAL_ENV = process.env.NODE_ENV;
let logSpy;
beforeEach(() => { mockQueries.length = 0; logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { process.env.NODE_ENV = ORIGINAL_ENV; logSpy.mockRestore(); });

async function connectAs(nodeEnv) {
  process.env.NODE_ENV = nodeEnv;
  let db;
  jest.isolateModules(() => { db = require('../../server/db'); });
  await db.connect();
  return mockQueries.slice();
}
const touchesDemo = q => /demo@locavac\.dz|demo1234|INSERT INTO listings/i.test(q);

describe('db.connect() — jeu de démonstration', () => {
  test('en production : schéma et migrations appliqués, mais aucune donnée de démonstration', async () => {
    const queries = await connectAs('production');
    expect(queries.some(q => /CREATE TABLE IF NOT EXISTS users/.test(q))).toBe(true);
    expect(queries.some(q => /schema_migrations/.test(q))).toBe(true);
    expect(queries.filter(touchesDemo)).toEqual([]);
  });

  test('hors production : le compte démo et les annonces sont créés (développement local)', async () => {
    const queries = await connectAs('development');
    expect(queries.some(q => /INSERT INTO users/.test(q) )).toBe(true);
    expect(queries.some(q => /INSERT INTO listings/.test(q))).toBe(true);
  });

  test('le compte démo est inséré avec ON CONFLICT DO NOTHING (idempotent au redémarrage)', async () => {
    const queries = await connectAs('development');
    const insert = queries.find(q => /INSERT INTO users/.test(q));
    expect(insert).toMatch(/ON CONFLICT \(email\) DO NOTHING/);
  });
});
