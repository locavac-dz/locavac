'use strict';
const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BACKUPS_DIR = path.join(__dirname, '..', 'backups');
const BACKUP_RE   = /^locavac_\d{4}-\d{2}-\d{2}\.dump$/;
// pg_dump recopie l'URL de connexion dans ses erreurs : le mot de passe ne doit jamais atteindre les alertes
const redactDbUrl = s => String(s).replace(/(postgres(?:ql)?:\/\/[^:\/\s@]+:)[^@\s]+@/gi, '$1***@');
const MAX_ALERTS  = 60;
const KEEP_DAYS   = 7;

const state = {
  startedAt:  new Date().toISOString(),
  lastBackup: null,
  lastReport: null,
  lastCheck:  null,
  checks:     0,
  alerts:     [],
};

let _alertId  = 1;
let _lastDay  = '';
let _lastWeek = '';

// ── Helpers ──────────────────────────────────────────────────
function isoWeek(d) {
  const t = new Date(d); t.setHours(0,0,0,0);
  t.setDate(t.getDate() + 3 - (t.getDay()+6)%7);
  const w = new Date(t.getFullYear(),0,4);
  return `${t.getFullYear()}-W${Math.round(((t-w)/86400000+w.getDay()+5)/7)}`;
}

function addAlert(level, category, message) {
  if (state.alerts.find(a => !a.dismissed && a.category === category && a.message === message)) return;
  const a = { id: _alertId++, level, category, message, ts: new Date().toISOString(), dismissed: false };
  state.alerts.unshift(a);
  if (state.alerts.length > MAX_ALERTS) state.alerts.pop();
  const prefix = { error:'🔴', warning:'🟡', info:'🟢' }[level] || '⚪';
  console.log(`[Agent] ${prefix} [${category}] ${message}`);
  return a;
}

// ── Backup quotidien PostgreSQL ──────────────────────────────
// pg_dump au format custom (restauration : pg_restore --dbname=$DATABASE_URL fichier.dump).
// execFile sans shell : l'URL de connexion est un argument, jamais interprétée par un interpréteur.
function doBackup() {
  return new Promise(resolve => {
    const url = process.env.DATABASE_URL;
    if (!url) { addAlert('error', 'backup', 'Échec de la sauvegarde : DATABASE_URL absent.'); return resolve(false); }
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = `locavac_${date}.dump`;
    const dest = path.join(BACKUPS_DIR, file);
    const bin  = process.env.PG_DUMP_PATH || 'pg_dump';
    execFile(bin, ['--dbname', url, '--format=custom', '--no-owner', '--file', dest], { timeout: 10 * 60 * 1000 }, (err, _stdout, stderr) => {
      if (err) {
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
        const why = err.code === 'ENOENT'
          ? `binaire « ${bin} » introuvable (installez postgresql-client ou définissez PG_DUMP_PATH)`
          : redactDbUrl(stderr || err.message).trim();
        addAlert('error', 'backup', `Échec de la sauvegarde : ${why}`);
        return resolve(false);
      }
      state.lastBackup = new Date().toISOString();
      const files = fs.readdirSync(BACKUPS_DIR).filter(f => BACKUP_RE.test(f)).sort();
      while (files.length > KEEP_DAYS) fs.unlinkSync(path.join(BACKUPS_DIR, files.shift()));
      addAlert('info', 'backup', `Sauvegarde créée : ${file}`);
      resolve(true);
    });
  });
}

// ── Analyse de sécurité ──────────────────────────────────────
async function checkSecurity() {
  const db   = require('./db');
  const pool = db.pool;
  state.checks++;

  // 1. Prix suspects
  const listings = await db.listings.search({});
  listings.forEach(l => {
    if (l.price <= 0)     addAlert('warning', `annonce#${l.id}`, `Prix nul/négatif sur "${l.title}" : ${l.price} DZD`);
    if (l.price > 500000) addAlert('warning', `annonce#${l.id}`, `Prix anormalement élevé sur "${l.title}" : ${Number(l.price).toLocaleString('fr-DZ')} DZD`);
  });

  // 2. Comptes récents (< 24h) avec >= 3 annonces = spam potentiel
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
  const recentUsers = await pool.query(
    `SELECT u.id, u.name, u.email,
            (SELECT COUNT(*) FROM listings WHERE host_id = u.id) AS listing_count
     FROM users u
     WHERE NOT u.is_admin AND u.created_at > $1
       AND (SELECT COUNT(*) FROM listings WHERE host_id = u.id) >= 3`,
    [oneDayAgo]
  );
  recentUsers.rows.forEach(u => {
    addAlert('warning', `user#${u.id}`, `Nouveau compte "${u.name}" (${u.email}) a créé ${u.listing_count} annonces en moins de 24h`);
  });

  // 3. Annonces orphelines (hôte supprimé)
  const orphaned = await pool.query(
    `SELECT l.id, l.title, l.host_id FROM listings l
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.host_id)`
  );
  orphaned.rows.forEach(l => {
    addAlert('error', `annonce#${l.id}`, `Annonce orpheline "${l.title}" — hôte #${l.host_id} introuvable`);
  });

  state.lastCheck = new Date().toISOString();
}

// ── Rapport hebdomadaire ─────────────────────────────────────
async function sendWeeklyReport() {
  const db   = require('./db');
  const pool = db.pool;
  const mailer = require('./mailer');

  // Trouver le premier admin
  const adminRow = await pool.query(`SELECT id, email FROM users WHERE is_admin = true LIMIT 1`);
  const admin = adminRow.rows[0];
  if (!admin?.email) return;

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const [uStats, lStats, rStats, pStats] = await Promise.all([
    pool.query(`SELECT COUNT(*) total, SUM(CASE WHEN created_at > $1 THEN 1 ELSE 0 END) new_this_week FROM users`, [weekAgo]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE available) active FROM listings`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE created_at > $1) new_this_week FROM reservations`, [weekAgo]),
    pool.query(`SELECT COALESCE(SUM(amount), 0) revenue FROM payments WHERE status = 'success'`),
  ]);

  const users    = uStats.rows[0];
  const listings = lStats.rows[0];
  const resas    = rStats.rows[0];
  const pay      = pStats.rows[0];
  const revenue  = parseFloat(pay.revenue);

  const openAlerts = state.alerts.filter(a => !a.dismissed && a.level !== 'info');
  const alertRows  = openAlerts.slice(0, 5).map(a =>
    // Les alertes citent des titres d'annonces, des noms et des e-mails saisis par les utilisateurs
    `<tr><td style="padding:6px 10px">${a.level==='error'?'🔴':'🟡'}</td><td style="padding:6px 10px">${mailer.esc(a.category)}</td><td style="padding:6px 10px">${mailer.esc(a.message)}</td></tr>`
  ).join('');

  await mailer.sendMail({
    to: admin.email,
    subject: `📊 Rapport hebdomadaire Locavac — ${new Date().toLocaleDateString('fr-DZ')}`,
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f9f9f9;padding:0;margin:0">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)">
  <div style="background:#E8261A;padding:24px 32px;color:#fff">
    <h1 style="margin:0;font-size:22px">🤖 Locavac — Rapport Hebdomadaire</h1>
    <p style="margin:4px 0 0;opacity:.85;font-size:13px">Généré le ${new Date().toLocaleString('fr-DZ')}</p>
  </div>
  <div style="padding:28px 32px">
    <h2 style="color:#222;margin-top:0">Résumé de la semaine</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <tr style="background:#f9f9f9"><td style="padding:10px 14px;font-weight:700">👥 Utilisateurs total</td><td style="padding:10px 14px;text-align:right">${users.total}</td></tr>
      <tr><td style="padding:10px 14px;font-weight:700">🆕 Nouveaux cette semaine</td><td style="padding:10px 14px;text-align:right;color:#047857">+${users.new_this_week}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:10px 14px;font-weight:700">🏠 Annonces actives</td><td style="padding:10px 14px;text-align:right">${listings.active}</td></tr>
      <tr><td style="padding:10px 14px;font-weight:700">📅 Nouvelles réservations</td><td style="padding:10px 14px;text-align:right;color:#047857">+${resas.new_this_week}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:10px 14px;font-weight:700">💰 Chiffre d'affaires total</td><td style="padding:10px 14px;text-align:right">${revenue.toLocaleString('fr-DZ')} DZD</td></tr>
      <tr><td style="padding:10px 14px;font-weight:700">🚨 Alertes actives</td><td style="padding:10px 14px;text-align:right;color:${openAlerts.length>0?'#dc2626':'#047857'}">${openAlerts.length}</td></tr>
    </table>
    ${alertRows ? `<h3 style="color:#dc2626;margin-top:0">⚠️ Alertes à traiter</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #fca5a5;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <thead><tr style="background:#fff5f4"><th style="padding:8px 10px;text-align:left">Niv.</th><th style="padding:8px 10px;text-align:left">Catégorie</th><th style="padding:8px 10px;text-align:left">Message</th></tr></thead>
      <tbody>${alertRows}</tbody>
    </table>` : '<p style="color:#047857">✅ Aucune alerte active cette semaine.</p>'}
    <div style="text-align:center">
      <a href="https://locavac.dz" style="display:inline-block;background:#E8261A;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">Ouvrir le Panel Admin →</a>
    </div>
  </div>
  <div style="background:#f1f1f1;padding:16px 32px;font-size:12px;color:#999;text-align:center">© 2026 Locavac · Rapport automatique par l'Agent IA de surveillance</div>
</div></body></html>`,
  });

  state.lastReport = new Date().toISOString();
  addAlert('info', 'rapport', `Rapport hebdomadaire envoyé à ${admin.email}`);
}

// ── Scheduler ────────────────────────────────────────────────
async function tick() {
  const now     = new Date();
  const hour    = now.getHours();
  const day     = now.getDay();
  const dateStr = now.toISOString().slice(0, 10);
  const weekStr = isoWeek(now);
  if (hour === 3 && _lastDay !== dateStr)               { _lastDay = dateStr;  await doBackup(); }
  if (day === 1 && hour === 8 && _lastWeek !== weekStr) { _lastWeek = weekStr; await sendWeeklyReport(); }
  await checkSecurity();
}

// ── Démarrage ────────────────────────────────────────────────
function start() {
  console.log('🤖 Agent IA de surveillance Locavac démarré');
  const today     = new Date().toISOString().slice(0, 10);
  const todayFile = path.join(BACKUPS_DIR, `locavac_${today}.dump`);
  if (!fs.existsSync(todayFile)) { _lastDay = today; doBackup(); }
  else state.lastBackup = new Date().toISOString();
  checkSecurity().catch(e => console.error('[Agent] checkSecurity:', e.message));
  setInterval(() => tick().catch(e => console.error('[Agent] tick:', e.message)), 5 * 60 * 1000);
}

module.exports = { start, state, doBackup, addAlert };
