const fs   = require('fs');
const path = require('path');
const migrate = require('../../server/migrate');

const FILES = fs.readdirSync(path.join(__dirname, '..', '..', 'server', 'migrations')).filter(f => f.endsWith('.sql')).sort();

// Faux pool : tout doit passer par UNE connexion obtenue via connect() ; pool.query n'existe volontairement pas
function fakePool({ applied = [], failOn = null } = {}) {
  const calls = [];
  const client = {
    query: jest.fn((sql, params) => {
      const text = String(sql).trim();
      calls.push({ text, params });
      if (failOn && failOn(text)) return Promise.reject(new Error('syntax error at or near "BROKEN"'));
      if (/^SELECT filename FROM schema_migrations/.test(text)) return Promise.resolve({ rows: applied.map(filename => ({ filename })) });
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  return { pool: { connect: jest.fn().mockResolvedValue(client) }, client, calls };
}

let logSpy;
beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => logSpy.mockRestore());

describe('migrate — une seule connexion, sous verrou', () => {
  test('prend le verrou consultatif avant toute lecture, le rend à la fin, libère la connexion', async () => {
    const { pool, client, calls } = fakePool({ applied: FILES });
    await migrate(pool);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual({ text: 'SELECT pg_advisory_lock($1)', params: [migrate.MIGRATION_LOCK_KEY] });
    expect(calls[calls.length - 1]).toEqual({ text: 'SELECT pg_advisory_unlock($1)', params: [migrate.MIGRATION_LOCK_KEY] });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('tout est déjà appliqué : aucune transaction ouverte', async () => {
    const { pool, calls } = fakePool({ applied: FILES });
    await migrate(pool);
    expect(calls.map(c => c.text)).not.toContain('BEGIN');
  });

  test('seule la migration manquante est appliquée : BEGIN → SQL → enregistrement → COMMIT sur la même connexion', async () => {
    const last = FILES[FILES.length - 1];
    const { pool, calls } = fakePool({ applied: FILES.slice(0, -1) });
    await migrate(pool);
    const texts = calls.map(c => c.text);
    const begin = texts.indexOf('BEGIN');
    expect(texts.filter(t => t === 'BEGIN')).toHaveLength(1);
    expect(texts[begin + 2]).toBe('INSERT INTO schema_migrations (filename) VALUES ($1)');
    expect(calls[begin + 2].params).toEqual([last]);
    expect(texts[begin + 3]).toBe('COMMIT');
    expect(texts).not.toContain('ROLLBACK');
  });

  test('base vierge : les migrations sont appliquées dans l\'ordre des préfixes numériques', async () => {
    const { pool, calls } = fakePool();
    await migrate(pool);
    const recorded = calls.filter(c => /^INSERT INTO schema_migrations/.test(c.text)).map(c => c.params[0]);
    expect(recorded).toEqual(FILES);
  });

  test('échec d\'une migration : ROLLBACK, erreur nommant le fichier, suivantes non tentées, verrou rendu', async () => {
    const broken = FILES[2];
    const brokenSql = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'migrations', broken), 'utf8').trim();
    const { pool, client, calls } = fakePool({ failOn: text => text === brokenSql });
    await expect(migrate(pool)).rejects.toThrow(new RegExp(broken.replace(/\./g, '\\.')));
    const texts = calls.map(c => c.text);
    expect(texts).toContain('ROLLBACK');
    const recorded = calls.filter(c => /^INSERT INTO schema_migrations/.test(c.text)).map(c => c.params[0]);
    expect(recorded).toEqual(FILES.slice(0, 2));
    expect(texts[texts.length - 1]).toBe('SELECT pg_advisory_unlock($1)');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
