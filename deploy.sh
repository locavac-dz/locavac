#!/usr/bin/env bash
# deploy.sh — Déploiement Locavac sur VPS
# Usage : bash deploy.sh
# Prérequis côté serveur : Node.js 20+, PM2, PostgreSQL 15+, Nginx
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/locavac}"
PM2_APP="${PM2_APP:-locavac}"

# ── Résolution du PATH pour les sessions SSH non-interactives ────────────────
# nvm (installation dans le home de l'utilisateur courant)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Chemins standards Node/PM2 selon la méthode d'installation
for _dir in \
  /usr/local/bin \
  /usr/bin \
  "$HOME/.local/bin" \
  "$HOME/bin" \
  /root/.local/bin \
  /root/bin \
  /opt/node/bin \
  /usr/local/lib/node_modules/.bin; do
  [ -d "$_dir" ] && export PATH="$_dir:$PATH"
done

# Vérifie que npm et pm2 sont bien accessibles
if ! command -v npm &>/dev/null; then
  echo "❌  npm introuvable. Installez Node.js 20 puis relancez." >&2
  exit 1
fi
if ! command -v pm2 &>/dev/null; then
  echo "❌  pm2 introuvable. Lancez : npm install -g pm2" >&2
  exit 1
fi

echo ""
echo "🚀 Déploiement Locavac — $(date '+%Y-%m-%d %H:%M:%S')"
echo "   Répertoire : $APP_DIR"
echo "   PM2 app    : $PM2_APP"
echo "   node       : $(node --version)"
echo "   npm        : $(npm --version)"
echo "   pm2        : $(pm2 --version)"
echo ""

cd "$APP_DIR"

# ── 1. Récupération du code ──────────────────────────────────
echo "⬇  git pull origin master…"
git pull origin master

# ── 2. Dépendances ──────────────────────────────────────────
echo "📦  npm ci --omit=dev…"
npm ci --omit=dev

# ── 3. Rechargement sans coupure (zero-downtime) ────────────
echo "🔄  pm2 reload $PM2_APP --update-env…"
pm2 reload "$PM2_APP" --update-env

# Les migrations DB sont appliquées automatiquement au démarrage
# du serveur via server/migrate.js → aucune commande psql manuelle.

echo ""
echo "✅  Déploiement terminé — $(date '+%H:%M:%S')"
echo ""
