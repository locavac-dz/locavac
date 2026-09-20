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
  if [ -d "$_dir" ]; then export PATH="$_dir:$PATH"; fi
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

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/api/health}"
PREV_COMMIT="$(git rev-parse HEAD)"

# Attend jusqu'à ~30 s que l'application réponde 200 sur /api/health (PostgreSQL compris)
health_ok() {
  for _ in $(seq 1 15); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# Retour à la version précédente : code, dépendances, puis rechargement
rollback() {
  echo "↩  Retour à la version précédente ($PREV_COMMIT)…" >&2
  git reset --hard "$PREV_COMMIT"
  npm ci --omit=dev
  pm2 reload "$PM2_APP" --update-env
  if health_ok; then echo "✅  Version précédente rétablie et saine." >&2
  else echo "🚨  La version précédente ne répond pas non plus — intervention manuelle requise." >&2; fi
}

# ── 1. Récupération du code ──────────────────────────────────
# --ff-only : jamais de fusion implicite sur le serveur ; échoue proprement si l'historique a divergé
echo "⬇  git pull --ff-only origin master…"
git pull --ff-only origin master
NEW_COMMIT="$(git rev-parse HEAD)"
if [ "$NEW_COMMIT" = "$PREV_COMMIT" ]; then
  echo "ℹ  Déjà à jour ($PREV_COMMIT) — rien à déployer."
  exit 0
fi
echo "   $PREV_COMMIT → $NEW_COMMIT"

# ── 2. Dépendances ──────────────────────────────────────────
# npm ci vide node_modules avant d'installer : en cas d'échec (réseau, registre), on rétablit tout de suite
# l'état précédent pour qu'un redémarrage automatique de pm2 ne tombe pas sur une installation incomplète.
echo "📦  npm ci --omit=dev…"
if ! npm ci --omit=dev; then
  echo "❌  npm ci a échoué." >&2
  rollback
  exit 1
fi

# ── 3. Rechargement sans coupure (zero-downtime) ────────────
echo "🔄  pm2 reload $PM2_APP --update-env…"
pm2 reload "$PM2_APP" --update-env

# Les migrations DB sont appliquées automatiquement au démarrage
# du serveur via server/migrate.js → aucune commande psql manuelle.

# ── 4. Contrôle de santé, sinon retour arrière ──────────────
echo "🩺  Contrôle de santé : $HEALTH_URL…"
if ! health_ok; then
  echo "❌  L'application ne répond pas après le déploiement." >&2
  rollback
  exit 1
fi

echo ""
echo "✅  Déploiement terminé et vérifié — $(date '+%H:%M:%S')"
echo ""
