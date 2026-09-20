const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
// Clé arbitraire mais stable du verrou consultatif PostgreSQL réservé aux migrations Locavac
const MIGRATION_LOCK_KEY = 727001;

async function migrate(pool) {
  // Une seule connexion pour tout : BEGIN/COMMIT envoyés via pool.query pouvaient partir sur des connexions
  // différentes (transaction non atomique). Le verrou sérialise deux processus qui démarrent ensemble
  // (pm2 reload, plusieurs workers).
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          SERIAL PRIMARY KEY,
        filename    TEXT UNIQUE NOT NULL,
        applied_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();
    if (!files.length) return;

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied   = new Set(rows.map(r => r.filename));

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] ✅ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`[migrate] ❌ ${file} — ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

module.exports = migrate;
module.exports.MIGRATION_LOCK_KEY = MIGRATION_LOCK_KEY;
