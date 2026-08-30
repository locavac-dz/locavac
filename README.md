# Locavac 🏠

**Plateforme de location de vacances en Algérie**

Locavac connecte les voyageurs algériens avec des hôtes locaux pour des séjours authentiques — des plages de la Méditerranée au désert du Sahara.

---

## Fonctionnalités

- **Recherche et réservation** — filtres par destination, dates, voyageurs et catégorie (Plages, Sahara, Montagnes, Villas, Riads…)
- **5 modes de paiement** — CIB, Edahabia, BaridiMob, Virement bancaire, Espèces à l'arrivée
- **Vérification d'identité** — CNI algérienne vérifiée automatiquement à l'upload
- **Politiques d'annulation** — Flexible, Modérée, Stricte avec calcul automatique du remboursement
- **Espace hôte** — tableau de bord des gains, commission unique de 10 %, calendrier de disponibilité
- **Avis post-séjour** — notation ★ uniquement après la date de départ
- **Notifications email** — confirmation de réservation, rappels, alertes hôte
- **Interface bilingue** — Français / Arabe
- **Pages légales** — CGU, Politique de confidentialité, Mentions légales (RGPD + loi 18-07)

---

## Stack technique

| Couche | Technologie |
|--------|------------|
| Backend | Node.js 20 + Express |
| Base de données | PostgreSQL 17 |
| Authentification | JWT (jsonwebtoken + bcryptjs) |
| Upload | multer |
| Email | nodemailer |
| Frontend | HTML/CSS/JS vanilla (SPA) |
| Production | pm2 cluster + Nginx + Let's Encrypt |

---

## Démarrage local

### Prérequis

- Node.js 20+
- PostgreSQL 17 (port 5433)

### Installation

```bash
git clone https://github.com/locavac-dz/locavac.git
cd locavac
npm install
```

### Configuration

```bash
cp .env.example .env
# Remplir les variables dans .env
```

Variables requises dans `.env` :

```env
JWT_SECRET=votre_secret_jwt
DATABASE_URL=postgresql://locavac:motdepasse@localhost:5433/locavac
PORT=3000
# Email (optionnel — silencieux si absent)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=noreply@locavac.dz
EMAIL_PASS=motdepasse
```

### Lancement

```bash
# Windows
demarrer.bat

# Linux / macOS
node server/index.js
```

Ouvrir [http://localhost:3000](http://localhost:3000)

---

## Déploiement en production

Voir [DEPLOIEMENT.md](DEPLOIEMENT.md) pour le guide complet :

- **Lot 6** — VPS Ubuntu + pm2 cluster
- **Lot 7** — Domaine `locavac.dz` via NIC.dz
- **Lot 8** — HTTPS avec Nginx + Let's Encrypt (certbot)
- **Lot 9** — Application mobile React Native (roadmap)

---

## Structure du projet

```
locavac/
├── server/
│   ├── index.js          # Point d'entrée Express
│   ├── db.js             # Couche d'accès PostgreSQL
│   ├── schema.sql        # Schéma de base de données
│   ├── middleware/
│   │   └── auth.js       # Middleware JWT
│   └── routes/
│       ├── listings.js   # Annonces + avis
│       ├── reservations.js
│       ├── admin.js
│       ├── upload.js     # Photos + CNI
│       └── ...
├── public/
│   ├── index.html        # SPA principale
│   └── uploads/          # Fichiers uploadés
├── ecosystem.config.js   # Config pm2
├── nginx.conf            # Config Nginx
├── deploy.sh             # Script de déploiement
└── DEPLOIEMENT.md        # Guide de mise en production
```

---

## Cadre légal

- Hébergement : **France** (VPS OVH / Scaleway / Hetzner FR)
- Réglementation : **RGPD** (UE) + **loi 18-07** (Algérie)
- Autorités compétentes : **CNIL** (France) + **ANPDP** (Algérie)

---

## Licence

Projet propriétaire — tous droits réservés © 2026 Locavac.
