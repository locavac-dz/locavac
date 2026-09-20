# Guide de déploiement Locavac en production

## Configuration cible

| Élément | Choix |
|---------|-------|
| Hébergement | VPS en **France** (ex : OVH SAS, Scaleway, Hetzner FR) |
| Domaine | `locavac.dz` (NIC.dz — registre algérien) |
| SSL | Let's Encrypt (gratuit, renouvellement auto) |
| Cadre légal | **RGPD** (hébergeur France) + **loi 18-07** (données algériennes) |

---

## Lot 6 — VPS + pm2

### 1. Préparer le VPS (Ubuntu 22.04 ou 24.04)

```bash
# Première connexion (root), puis création d'un compte de déploiement sans privilèges
ssh root@IP_VPS
apt update && apt upgrade -y
adduser --disabled-password --gecos "" deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# Node.js 20 (version exigée par package.json : engines >= 20)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git curl

# pm2 (gestionnaire de process) + rotation des journaux
npm install -g pm2
pm2 install pm2-logrotate

# PostgreSQL 17 (dépôt officiel PGDG) — postgresql-client fournit pg_dump pour la sauvegarde quotidienne
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt install -y postgresql-17 postgresql-client-17
```

### 2. Créer l'utilisateur PostgreSQL

```bash
sudo -u postgres psql
CREATE USER locavac WITH PASSWORD 'MOT_DE_PASSE_FORT';
CREATE DATABASE locavac OWNER locavac;
\q
```

### 3. Premier déploiement

```bash
# Le dossier applicatif est /opt/locavac (chemin attendu par deploy.sh et par le workflow GitHub Actions)
mkdir -p /opt/locavac && chown deploy:deploy /opt/locavac
su - deploy
git clone https://github.com/locavac-dz/locavac.git /opt/locavac
cd /opt/locavac

# Configuration : partir de .env.example (.env et .env.production ne sont jamais dans Git)
cp .env.example .env && chmod 600 .env
nano .env
```

Variables à renseigner **obligatoirement** — le serveur refuse de démarrer si l'une des trois premières manque :

| Variable | Valeur en production |
|----------|----------------------|
| `JWT_SECRET` | chaîne aléatoire longue : `openssl rand -hex 48` |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGINS` | `https://locavac.dz,https://www.locavac.dz` — sans origine publique, toute écriture serait refusée |
| `NODE_ENV` | `production` (désactive le compte de démonstration, masque les erreurs internes) |
| `DATABASE_URL` | `postgresql://locavac:MOT_DE_PASSE_FORT@localhost:5432/locavac` |
| `APP_URL` | `https://locavac.dz` (liens des e-mails, retour OAuth) |
| `GOOGLE_CALLBACK_URL` | `https://locavac.dz/api/auth/google/callback` si la connexion Google est activée |
| `EMAIL_*` | identifiants SMTP (sans eux, aucun e-mail n'est envoyé) |
| `BARIDIMOB_ENABLED` | laisser `false` tant que la certification Algérie Poste n'est pas obtenue |

```bash
npm ci --omit=dev
pm2 start ecosystem.config.js --env production   # schéma et migrations appliqués au démarrage
pm2 save                                          # mémorise la liste des process
exit                                              # retour en root
pm2 startup systemd -u deploy --hp /home/deploy   # relance automatique au redémarrage du VPS
```

Les dossiers `private/identity/` (pièces d'identité, jamais servies publiquement), `public/uploads/` et `backups/` sont créés automatiquement ; ils doivent rester hors de Git et appartenir à l'utilisateur `deploy`.

### 4. Déploiements suivants

```bash
cd /opt/locavac && bash deploy.sh
```

`deploy.sh` fait `git pull --ff-only`, `npm ci --omit=dev`, `pm2 reload`, puis interroge `/api/health` pendant 30 s. Si l'installation échoue ou si l'application ne répond pas, il **revient automatiquement au commit précédent** et sort en erreur.

**Déploiement automatique (GitHub Actions)** — le workflow `.github/workflows/deploy.yml` est en déclenchement manuel tant que le VPS n'existe pas. Une fois le serveur prêt :

1. Dans GitHub → Settings → Secrets and variables → Actions, renseigner `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_PORT` et `VPS_KEY` (clé privée dont la clé publique figure dans `/home/deploy/.ssh/authorized_keys`).
2. Lancer « Deploy to VPS » à la main depuis l'onglet Actions.
3. Si le run est vert, remplacer `workflow_dispatch:` par `push: branches: [master]` dans `deploy.yml`.

### 5. Commandes pm2 utiles

```bash
pm2 status                      # État du process
pm2 logs locavac --lines 50     # Derniers logs (les jetons des URL y sont masqués)
pm2 reload locavac              # Rechargement sans coupure (arrêt propre de l'ancien process)
pm2 monit                       # Monitoring temps réel
```

Le process tourne avec **une seule instance** : les WebSockets, le rate limiting et les tâches planifiées vivent en mémoire. Ne pas passer à `instances: 'max'` sans bus partagé (Redis).

### 6. Sauvegardes et restauration

L'agent lance `pg_dump` chaque nuit à 3 h et conserve 7 jours dans `/opt/locavac/backups/locavac_AAAA-MM-JJ.dump`. Une alerte apparaît dans le panneau admin si la sauvegarde échoue (`pg_dump` introuvable → définir `PG_DUMP_PATH`).

```bash
# Restauration (écrase la base courante)
pm2 stop locavac
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" backups/locavac_AAAA-MM-JJ.dump
pm2 start locavac
```

> ⚠️ Ces sauvegardes restent **sur le même serveur** que la base : une panne de disque emporte les deux. Copier chaque nuit `backups/` **et** `private/identity/` vers un stockage distant chiffré (par exemple `rclone` vers un bucket objet) et tester une restauration complète au moins une fois avant l'ouverture au public. Ce transfert n'est pas automatisé par l'application.

### 7. Rotation des secrets et incident

- **`JWT_SECRET`** : le changer déconnecte tous les utilisateurs (leurs jetons deviennent invalides) — à faire immédiatement en cas de fuite, puis `pm2 reload locavac --update-env`.
- **Mot de passe PostgreSQL** : `ALTER USER locavac WITH PASSWORD '…'`, mettre à jour `DATABASE_URL`, recharger.
- **Compte compromis** : le bannir depuis le panneau admin — ses jetons sont refusés dès la requête HTTP suivante ; une connexion WebSocket déjà ouverte n'est coupée qu'à sa prochaine reconnexion (ou au prochain `pm2 reload`).
- **Application indisponible** : `pm2 logs locavac --err --lines 100`, puis `curl -s localhost:3000/api/health` ; `"db":"down"` désigne PostgreSQL (`systemctl status postgresql`).

---

## Lot 7 — Nom de domaine locavac.dz

### Procédure NIC.dz

1. Aller sur **https://www.nic.dz** (registre officiel algérien)
2. Vérifier la disponibilité de `locavac.dz`
3. Soumettre le dossier :
   - Registre de commerce ou N° d'immatriculation CNRC
   - Copie CNI du gérant
   - Formulaire de demande d'enregistrement
4. Paiement des frais annuels (≈ 3 500 DZD/an)
5. Délai : 2 à 5 jours ouvrables

### DNS à configurer chez NIC.dz

| Type | Nom | Valeur |
|------|-----|--------|
| A    | @   | IP_VPS |
| A    | www | IP_VPS |
| MX   | @   | mail.locavac.dz (si email hébergé) |

---

## Lot 8 — HTTPS avec Let's Encrypt

### Nginx + Certbot

```bash
# Installer Nginx et Certbot
apt install -y nginx certbot python3-certbot-nginx

# Copier la config Nginx (proxy de /api, du WebSocket /ws et des fichiers, journaux sans query string)
cp /opt/locavac/nginx.conf /etc/nginx/sites-available/locavac
ln -s /etc/nginx/sites-available/locavac /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Tester la config
nginx -t

# Activer Nginx
systemctl enable nginx && systemctl start nginx

# Obtenir le certificat SSL (remplacer IP provisoire par domaine réel)
certbot --nginx -d locavac.dz -d www.locavac.dz \
  --email admin@locavac.dz --agree-tos --non-interactive

# Renouvellement automatique (déjà configuré par certbot)
# Tester : certbot renew --dry-run
```

### Vérification

```bash
curl -s https://locavac.dz/api/health
# → {"ok":true,"db":"up","db_latency_ms":3,"uptime_s":42,"timestamp":"…"}   (503 et "db":"down" si PostgreSQL ne répond pas)
```

---

## Lot 9 — Application mobile (React Native)

> Nécessite un budget et une équipe dédiés. Estimation : 2-4 mois de développement.

### Architecture recommandée

```
locavac-mobile/
├── src/
│   ├── screens/          # HomeScreen, ListingScreen, ProfileScreen...
│   ├── components/       # ListingCard, PaymentModal, BookingForm...
│   ├── api/              # Wrapper fetch → https://locavac.dz/api
│   └── navigation/       # React Navigation (Stack + Tab)
├── android/
└── ios/
```

### Stack suggérée

- **React Native 0.74** + Expo SDK 51
- **React Navigation 6** pour le routage
- **React Native Maps** pour la carte (MapLibre ou Google Maps)
- **Stripe React Native** si paiement carte international ajouté
- **OneSignal** ou **Firebase Cloud Messaging** pour les push notifications

### Commandes de démarrage

```bash
npx create-expo-app locavac-mobile --template expo-template-blank-typescript
cd locavac-mobile
npx expo install react-navigation expo-image-picker
```

L'API backend Locavac est déjà compatible mobile — toutes les routes `/api/*` retournent du JSON et gèrent les tokens JWT via header `Authorization: Bearer <token>`.

---

## Récapitulatif production

| Élément | Coût estimé | Statut |
|---------|-------------|--------|
| VPS France — OVH Starter (2 cœurs, 4 Go RAM) | ~6 €/mois | À provisionner |
| VPS France — Scaleway DEV1-S (2 cœurs, 2 Go RAM) | ~3,99 €/mois | Alternative |
| Domaine `locavac.dz` (NIC.dz, registre algérien) | ~3 500 DZD/an | Dossier CNRC requis |
| Certificat SSL (Let's Encrypt) | Gratuit | Automatisé via certbot |
| Email SMTP (Gmail App Password ou OVH MXplan) | Gratuit/~1 €/mois | Configurer dans `.env` |
| Application mobile React Native | Budget dev | Phase suivante |

> **Note RGPD** : héberger en France implique de respecter le RGPD pour tous les utilisateurs (y compris algériens). Le DPO doit être désigné si le traitement est à grande échelle. La CNIL est l'autorité de contrôle compétente côté français.
