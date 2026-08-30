#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# Script de déploiement Locavac sur VPS Ubuntu 22.04 / Debian 12
# Prérequis : Node.js 20+, PostgreSQL 15+, pm2, nginx, certbot
#
# Usage (depuis votre poste) :
#   scp -r . user@VPS_IP:/var/www/locavac
#   ssh user@VPS_IP "cd /var/www/locavac && bash deploy.sh"
# ────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/var/www/locavac"
APP_NAME="locavac"
DB_NAME="locavac"
DB_USER="locavac"

echo "═══════════════════════════════════════════"
echo "  Déploiement Locavac $(date '+%Y-%m-%d %H:%M')"
echo "═══════════════════════════════════════════"

# ── 1. Dépendances système ───────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "→ Installation Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pm2 &>/dev/null; then
  echo "→ Installation pm2..."
  sudo npm install -g pm2
fi

# ── 2. Dépendances Node ──────────────────────────────────────────
echo "→ npm install --omit=dev..."
cd "$APP_DIR"
npm install --omit=dev

# ── 3. Fichier .env ──────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  echo "⚠️  Fichier .env manquant — copier .env.production → .env et remplir les valeurs"
  exit 1
fi

# ── 4. Base de données ───────────────────────────────────────────
echo "→ Création de la base (si inexistante)..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "→ Application du schéma..."
sudo -u postgres psql -d "$DB_NAME" -f "$APP_DIR/server/schema.sql"

# ── 5. Dossier logs ──────────────────────────────────────────────
mkdir -p "$APP_DIR/logs"

# ── 6. Lancement / rechargement pm2 ─────────────────────────────
if pm2 list | grep -q "$APP_NAME"; then
  echo "→ Rechargement pm2 (zero-downtime)..."
  pm2 reload "$APP_NAME" --env production
else
  echo "→ Démarrage pm2..."
  pm2 start "$APP_DIR/ecosystem.config.js" --env production
fi

pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true

echo ""
echo "✅ Déploiement terminé !"
echo "   Vérifier : pm2 status && pm2 logs $APP_NAME --lines 20"
