const fs   = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', '..', 'server');

// Colonnes réelles d'une table (schema.sql + ADD COLUMN des migrations). Les tests tournent sur un mock
// de la base : sans ce contrôle, une écriture vers une colonne inexistante ne se verrait qu'en production.
function tableColumns(table) {
  const schema = fs.readFileSync(path.join(SERVER_DIR, 'schema.sql'), 'utf8');
  const block  = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
  const cols   = block ? block[1].split('\n').map(l => l.trim().split(/\s+/)[0]).filter(c => /^[a-z_]+$/.test(c)) : [];
  const migDir = path.join(SERVER_DIR, 'migrations');
  for (const f of fs.readdirSync(migDir).filter(f => f.endsWith('.sql'))) {
    for (const stmt of fs.readFileSync(path.join(migDir, f), 'utf8').split(';')) {
      if (!new RegExp(`ALTER TABLE\\s+${table}\\b`, 'i').test(stmt)) continue;
      for (const m of stmt.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_]+)/gi)) cols.push(m[1].toLowerCase());
    }
  }
  return new Set(cols);
}

module.exports = { tableColumns };
