'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_FILE   = path.join(__dirname, '..', 'locavac.json');
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');
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
  // Dédoublonner les alertes non dismissées
  if (state.alerts.find(a => !a.dismissed && a.category === category && a.message === message)) return;
  const a = { id: _alertId++, level, category, message, ts: new Date().toISOString(), dismissed: false };
  state.alerts.unshift(a);
  if (state.alerts.length > MAX_ALERTS) state.alerts.pop();
  const prefix = { error:'🔴', warning:'🟡', info:'🟢' }[level] || '⚪';
  console.log(`[Agent] ${prefix} [${category}] ${message}`);
  return a;
}

// ── Backup quotidien ─────────────────────────────────────────
function doBackup() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const dest = path.join(BACKUPS_DIR, `dzstay_${date}.json`);
    fs.copyFileSync(DATA_FILE, dest);
    state.lastBackup = new Date().toISOString();

    // Garder seulement les KEEP_DAYS derniers fichiers
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => /^dzstay_\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    while (files.length > KEEP_DAYS) fs.unlinkSync(path.join(BACKUPS_DIR, files.shift()));

    addAlert('info', 'backup', `Sauvegarde créée : dzstay_${date}.json`);
  } catch (e) {
    addAlert('error', 'backup', `Échec de la sauvegarde : ${e.message}`);
  }
}

// ── Analyse de sécurité ──────────────────────────────────────
async function checkSecurity() {
  const db = require('./db');
  state.checks++;

  // 1. Prix suspects
  const listings = await db.listings.find(l => l.available);
  listings.forEach(l => {
    if (l.price <= 0)     addAlert('warning', `annonce#${l.id}`, `Prix nul/négatif sur "${l.title}" : ${l.price} DZD`);
    if (l.price > 500000) addAlert('warning', `annonce#${l.id}`, `Prix anormalement élevé sur "${l.title}" : ${Number(l.price).toLocaleString('fr-DZ')} DZD`);
  });

  // 2. Comptes récents (< 24h) avec >= 3 annonces = spam potentiel
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
  const recentUsers = await db.users.find(u => !u.is_admin && String(u.created_at) > oneDayAgo);
  for (const u of recentUsers) {
    const n = await db.listings.count(l => l.host_id === u.id);
    if (n >= 3) addAlert('warning', `user#${u.id}`, `Nouveau compte "${u.name}" (${u.email}) a créé ${n} annonces en moins de 24h`);
  }

  // 3. Annonces orphelines (hôte supprimé)
  const allUsers   = await db.users.find();
  const allListings = await db.listings.find();
  const userIds = new Set(allUsers.map(u => u.id));
  allListings.forEach(l => {
    if (!userIds.has(l.host_id))
      addAlert('error', `annonce#${l.id}`, `Annonce orpheline "${l.title}" — hôte #${l.host_id} introuvable`);
  });

  state.lastCheck = new Date().toISOString();
}

// ── Rapport hebdomadaire ─────────────────────────────────────
async function sendWeeklyReport() {
  const db     = require('./db');
  const mailer = require('./mailer');
  const admin  = await db.users.findOne(u => u.is_admin);
  if (!admin?.email) return;

  const weekAgo    = new Date(Date.now() - 7*86400000).toISOString();
  const users      = await db.users.find();
  const listings   = await db.listings.find();
  const resas      = await db.reservations.find();
  const payments   = await db.payments.find(p => p.status === 'success');
  const revenue    = payments.reduce((s,p) => s+(Number(p.amount)||0), 0);
  const newUsers   = users.filter(u => String(u.created_at) > weekAgo).length;
  const newResas   = resas.filter(r => String(r.created_at) > weekAgo).length;
  const openAlerts = state.alerts.filter(a => !a.dismissed && a.level !== 'info');
  const alertRows  = openAlerts.slice(0, 5).map(a =>
    `<tr><td style="padding:6px 10px">${a.level==='error'?'🔴':'🟡'}</td><td style="padding:6px 10px">${a.category}</td><td style="padding:6px 10px">${a.message}</td></tr>`
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
      <tr style="background:#f9f9f9"><td style="padding:10px 14px;font-weight:700">👥 Utilisateurs total</td><td style="padding:10px 14px;text-align:right">${users.length}</td></tr>
      <tr><td style="padding:10px 14px;font-weight:700">🆕 Nouveaux cette semaine</td><td style="padding:10px 14px;text-align:right;color:#047857">+${newUsers}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:10px 14px;font-weight:700">🏠 Annonces actives</td><td style="padding:10px 14px;text-align:right">${listings.filter(l=>l.available).length}</td></tr>
      <tr><td style="padding:10px 14px;font-weight:700">📅 Nouvelles réservations</td><td style="padding:10px 14px;text-align:right;color:#047857">+${newResas}</td></tr>
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
  if (hour === 3 && _lastDay !== dateStr)               { _lastDay = dateStr;  doBackup(); }
  if (day === 1 && hour === 8 && _lastWeek !== weekStr) { _lastWeek = weekStr; await sendWeeklyReport(); }
  await checkSecurity();
}

// ── Démarrage ────────────────────────────────────────────────
function start() {
  console.log('🤖 Agent IA de surveillance Locavac démarré');
  const today     = new Date().toISOString().slice(0, 10);
  const todayFile = path.join(BACKUPS_DIR, `locavac_${today}.json`);
  if (!fs.existsSync(todayFile)) { _lastDay = today; doBackup(); }
  else state.lastBackup = new Date().toISOString();
  checkSecurity().catch(e => console.error('[Agent] checkSecurity:', e.message));
  setInterval(() => tick().catch(e => console.error('[Agent] tick:', e.message)), 5 * 60 * 1000);
}

module.exports = { start, state, doBackup, addAlert };
