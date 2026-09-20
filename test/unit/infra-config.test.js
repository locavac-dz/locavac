const fs   = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '..', '..');
const read   = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const listJs = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? listJs(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

describe('nginx.conf', () => {
  const conf = read('nginx.conf');
  // Isole le contenu d'un bloc location par son préfixe exact
  const block = loc => (conf.match(new RegExp(`location\\s+${loc.replace(/[/=]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`)) || [])[1];

  test('le WebSocket /ws est proxifié avec les en-têtes Upgrade (sinon handshake impossible)', () => {
    const ws = block('= /ws');
    expect(ws).toBeDefined();
    expect(ws).toMatch(/proxy_http_version 1\.1/);
    expect(ws).toMatch(/Upgrade\s+\$http_upgrade/);
    expect(ws).toMatch(/Connection\s+"upgrade"/);
    expect(ws).toMatch(/proxy_read_timeout\s+\d+s/);
    expect(ws).toMatch(/proxy_pass\s+http:\/\/127\.0\.0\.1:3000/);
  });

  test('le chemin proxifié correspond à celui du serveur WebSocket', () => {
    expect(read('server/ws.js')).toMatch(/path:\s*'\/ws'/);
  });

  test('/api/ transmet X-Forwarded-For (nécessaire au rate limiting par IP)', () => {
    expect(block('/api/')).toMatch(/X-Forwarded-For\s+\$proxy_add_x_forwarded_for/);
  });
});

describe('Schéma et migrations', () => {
  const migDir = path.join(ROOT, 'server', 'migrations');
  const files  = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();

  test('préfixes numériques uniques et strictement croissants', () => {
    const nums = files.map(f => Number(f.slice(0, 3)));
    expect(nums.every(n => Number.isInteger(n))).toBe(true);
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThan(nums[i - 1]);
  });

  test('payments.reservation_id : ON DELETE SET NULL dans le schéma de base et dans une migration', () => {
    expect(read('server/schema.sql')).toMatch(/reservation_id\s+INTEGER REFERENCES reservations\(id\) ON DELETE SET NULL/);
    const mig = files.map(f => fs.readFileSync(path.join(migDir, f), 'utf8')).find(sql => /payments_reservation_id_fkey/.test(sql));
    expect(mig).toBeDefined();
    expect(mig).toMatch(/DROP CONSTRAINT IF EXISTS payments_reservation_id_fkey/);
    expect(mig).toMatch(/FOREIGN KEY \(reservation_id\) REFERENCES reservations\(id\) ON DELETE SET NULL/);
  });
});

describe('.env.example ↔ variables réellement lues', () => {
  const used = new Set();
  for (const f of [...listJs('server'), 'ecosystem.config.js'])
    for (const m of read(f).matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) used.add(m[1]);
  const documented = new Set([...read('.env.example').matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map(m => m[1]));

  test('garde-fou : les deux listes sont non triviales', () => {
    expect(used.size).toBeGreaterThan(10);
    expect(documented.size).toBeGreaterThan(10);
  });

  test('toute variable lue par le serveur est documentée dans .env.example (règle CLAUDE.md)', () => {
    expect([...used].filter(v => !documented.has(v)).sort()).toEqual([]);
  });

  test('aucune variable morte dans .env.example', () => {
    expect([...documented].filter(v => !used.has(v)).sort()).toEqual([]);
  });

  test('CORS_ORIGINS et PG_DUMP_PATH sont bien présents', () => {
    expect(documented).toContain('CORS_ORIGINS');
    expect(documented).toContain('PG_DUMP_PATH');
  });
});

describe('Déploiement et exploitation', () => {
  const deploy = read('deploy.sh');

  test('deploy.sh : avance rapide uniquement, contrôle de santé, retour arrière', () => {
    expect(deploy).toMatch(/set -euo pipefail/);
    expect(deploy).toMatch(/git pull --ff-only origin master/);
    expect(deploy).toMatch(/PREV_COMMIT="\$\(git rev-parse HEAD\)"/);
    expect(deploy).toMatch(/health_ok\(\)/);
    expect(deploy).toMatch(/\/api\/health/);
    expect(deploy).toMatch(/rollback\(\)/);
    expect(deploy).toMatch(/git reset --hard "\$PREV_COMMIT"/);
  });

  test('deploy.sh : un échec de npm ci ou du contrôle de santé déclenche le retour arrière et un code d\'erreur', () => {
    expect(deploy).toMatch(/if ! npm ci --omit=dev; then[\s\S]*?rollback\s+exit 1/);
    expect(deploy).toMatch(/if ! health_ok; then[\s\S]*?rollback\s+exit 1/);
  });

  test('pm2 : attend le signal ready et laisse le temps à l\'arrêt propre', () => {
    const eco = require(path.join(ROOT, 'ecosystem.config.js')).apps[0];
    expect(eco.wait_ready).toBe(true);
    expect(eco.listen_timeout).toBeGreaterThanOrEqual(10000);
    expect(eco.kill_timeout).toBeGreaterThan(8000); // délai d'arrêt propre de server/lifecycle.js
    expect(read('server/index.js')).toMatch(/process\.send\('ready'\)/);
    expect(read('server/index.js')).toMatch(/installGracefulShutdown\(/);
  });

  test('package.json déclare la version de Node attendue', () => {
    expect(require(path.join(ROOT, 'package.json')).engines).toEqual({ node: '>=20' });
  });
});

describe('Fichiers privés et dépôt Git', () => {
  test('.gitignore exclut private/ (pièces d\'identité), backups/, .env et uploads', () => {
    const ignore = read('.gitignore').split(/\r?\n/).map(l => l.trim());
    for (const entry of ['private/', 'backups/', '.env', '.env.production', 'locavac.json', 'public/uploads/*'])
      expect(ignore).toContain(entry);
  });

  test('les pièces d\'identité sont stockées hors de public/', () => {
    const upload = read('server/routes/upload.js');
    expect(upload).toMatch(/IDENTITY_DIR\s*=\s*path\.join\(__dirname, '\.\.', '\.\.', 'private', 'identity'\)/);
    expect(upload).not.toMatch(/'\/uploads\/' \+ req\.file\.filename;\s*\n\s*\/\/ Soumettre/);
  });
});
