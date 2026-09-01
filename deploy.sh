#!/usr/bin/env bash
# deploy.sh — Déploiement Locavac sur VPS
# Usage : bash deploy.sh
# Prérequis côté serveur : Node.js 20+, PM2, PostgreSQL 15+, Nginx
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/locavac}"
PM2_APP="${PM2_APP:-locavac}"

echo ""
echo "🚀 Déploiement Locavac — $(date '+%Y-%m-%d %H:%M:%S')"
echo "   Répertoire : $APP_DIR"
echo "   PM2 app    : $PM2_APP"
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
