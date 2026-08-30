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

### 1. Préparer le VPS (Ubuntu 22.04)

```bash
# Connexion SSH
ssh root@IP_VPS

# Mise à jour système
apt update && apt upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# pm2 (gestionnaire de process)
npm install -g pm2

# PostgreSQL 15
apt install -y postgresql postgresql-contrib
```

### 2. Créer l'utilisateur PostgreSQL

```bash
sudo -u postgres psql
CREATE USER locavac WITH PASSWORD 'MOT_DE_PASSE_FORT';
CREATE DATABASE locavac OWNER locavac;
\q
```

### 3. Déployer le code

```bash
# Depuis votre poste (Windows → VPS)
scp -r C:\Users\33633\locavac user@IP_VPS:/var/www/locavac

# Sur le VPS
cd /var/www/locavac
cp .env.production .env
nano .env                # Remplir les valeurs (JWT_SECRET, DATABASE_URL, EMAIL_*)

bash deploy.sh           # Lance pm2 en cluster
```

### 4. Commandes pm2 utiles

```bash
pm2 status                      # État des workers
pm2 logs locavac --lines 50     # Derniers logs
pm2 reload locavac              # Rechargement sans downtime
pm2 monit                       # Monitoring temps réel
```

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

# Copier la config Nginx
cp /var/www/locavac/nginx.conf /etc/nginx/sites-available/locavac
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
curl -I https://locavac.dz/api/health
# → HTTP/2 200  {"ok":true,"message":"Locavac API opérationnelle 🇩🇿"}
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
