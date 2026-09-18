# LocaVac — Plateforme de location de vacances (Algérie)

Dossier `dzstay`, package npm `locavac`. Domaine cible : locavac.dz.

## Stack

- Node.js 20 + Express 4 — point d'entrée `server/index.js`
- PostgreSQL 17 (port **5432** en local)
- Auth JWT (`jsonwebtoken` + `bcryptjs`)
- Frontend HTML/CSS/JS vanilla en SPA, servi depuis `public/`
- Upload `multer`, email `nodemailer`, tâches planifiées `node-cron`, temps réel `ws`
- Production : pm2 cluster (`ecosystem.config.js`) + Nginx (`nginx.conf`) + Let's Encrypt

## Commandes

```bash
npm run dev      # nodemon
npm start        # node server/index.js
./deploy.sh      # déploiement serveur
```

Windows : `Lancer Locavac.bat` ou `demarrer.bat`.

## Structure

- `server/` — API Express
- `public/` — front SPA ; `public/uploads/` est ignoré par Git
- `backups/` — sauvegardes locales, hors Git
- `locavac.json` — configuration locale, hors Git

## Règles métier à respecter

- Commission hôte fixe : **10 %**
- 5 modes de paiement : CIB, Edahabia, BaridiMob, virement, espèces à l'arrivée
- Trois politiques d'annulation (Flexible / Modérée / Stricte) avec calcul automatique du remboursement
- Avis possibles **uniquement après la date de départ**
- Vérification d'identité par CNI algérienne à l'upload
- Interface bilingue FR / AR — toute nouvelle chaîne doit exister dans les deux langues
- Conformité RGPD + loi algérienne 18-07 (pages CGU, confidentialité, mentions légales)

## Consignes

- Ne jamais committer `.env`, `.env.production` ni `locavac.json` — ils sont dans `.gitignore`, ne pas l'assouplir.
- Toute variable de configuration nouvelle doit être ajoutée à `.env.example`.
- Les montants sont en DZD.
- Répondre et commenter le code en français.
