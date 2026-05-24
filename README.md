# DiasporaLink 📦

> Application PWA d'envoi de colis pour la diaspora africaine.
> Pick-up à domicile · Suivi en temps réel · Paiement sécurisé

```
diasporalink/
├── frontend/               ← Déployé sur Netlify
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js               (Service Worker)
│   ├── css/app.css
│   └── js/
│       ├── store.js        (State management)
│       ├── router.js       (Navigation)
│       ├── screens.js      (6 écrans)
│       └── app.js          (Bootstrap)
│
├── backend/                ← Déployé sur Railway / Render
│   ├── server.js
│   ├── package.json
│   ├── .env.example        (⚠ copier en .env et remplir)
│   ├── config/db.js
│   ├── middleware/auth.js
│   ├── models/
│   │   ├── User.js
│   │   ├── Pickup.js
│   │   └── Message.js
│   └── routes/
│       ├── auth.js         (OTP SMS)
│       ├── pickups.js      (CRUD colis)
│       ├── payments.js     (Stripe)
│       ├── tracking.js
│       ├── messages.js
│       ├── notifications.js (Web Push)
│       └── users.js
│
├── netlify.toml            ← Config déploiement Netlify
└── .gitignore
```

---

## 🚀 Déploiement rapide

### 1. GitHub — Push du code

```bash
git init
git add .
git commit -m "feat: initial DiasporaLink PWA"
git branch -M main
git remote add origin https://github.com/VOTRE_USER/diasporalink.git
git push -u origin main
```

---

### 2. Frontend → Netlify

1. Aller sur [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
2. Sélectionner votre repo GitHub
3. Paramètres de build :
   - **Base directory** : `frontend`
   - **Publish directory** : `frontend`
   - **Build command** : *(laisser vide)*
4. Ajouter la variable d'environnement :
   - `VITE_API_URL` = `https://votre-api.railway.app`
5. Cliquer **Deploy site** ✅

> Le fichier `netlify.toml` configure automatiquement les redirections SPA et les headers de cache.

---

### 3. Backend → Railway

1. Aller sur [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Sélectionner votre repo, pointer sur le dossier `backend`
3. Ajouter un plugin **MongoDB** (ou utiliser [MongoDB Atlas](https://cloud.mongodb.com))
4. Renseigner toutes les variables d'environnement depuis `.env.example` :

| Variable               | Description                          |
|------------------------|--------------------------------------|
| `MONGODB_URI`          | URI de connexion MongoDB             |
| `JWT_SECRET`           | Clé secrète JWT (chaîne aléatoire)   |
| `TWILIO_ACCOUNT_SID`   | Compte Twilio (envoi SMS OTP)        |
| `TWILIO_AUTH_TOKEN`    | Token Twilio                         |
| `TWILIO_PHONE_NUMBER`  | Numéro Twilio                        |
| `STRIPE_SECRET_KEY`    | Clé secrète Stripe                   |
| `STRIPE_WEBHOOK_SECRET`| Secret webhook Stripe                |
| `VAPID_PUBLIC_KEY`     | Clé publique Web Push                |
| `VAPID_PRIVATE_KEY`    | Clé privée Web Push                  |
| `VAPID_EMAIL`          | Email contact VAPID                  |
| `FRONTEND_URL`         | URL Netlify (pour CORS)              |

5. Railway détecte automatiquement Node.js et lance `npm start` ✅

---

### 4. Connecter le frontend au backend

Dans `frontend/js/app.js`, définir l'URL de l'API :

```js
// Remplacer la ligne de config par :
const API_URL = 'https://votre-api.railway.app/api';
```

Ou via une variable Netlify en injectant dans le build.

---

## 🛠 Développement local

### Backend
```bash
cd backend
cp .env.example .env    # remplir les vraies clés
npm install
npm run dev             # nodemon sur http://localhost:5000
```

### Frontend
```bash
cd frontend
python3 -m http.server 3000
# → http://localhost:3000
```

### Tester l'API
```bash
# Health check
curl http://localhost:5000/api/health

# Envoyer un OTP (dev: code affiché dans la console)
curl -X POST http://localhost:5000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+33612345678","firstName":"Aminata","lastName":"Konaté"}'
```

---

## 📋 API — Routes disponibles

| Méthode | Route                              | Auth | Description                  |
|---------|------------------------------------|------|------------------------------|
| POST    | `/api/auth/send-otp`               | ✗    | Envoi OTP par SMS            |
| POST    | `/api/auth/verify-otp`             | ✗    | Vérification OTP → JWT       |
| GET     | `/api/auth/me`                     | ✓    | Profil utilisateur connecté  |
| GET     | `/api/users/me`                    | ✓    | Profil + stats               |
| PATCH   | `/api/users/me`                    | ✓    | Mettre à jour le profil      |
| POST    | `/api/pickups`                     | ✓    | Créer un pick-up             |
| GET     | `/api/pickups`                     | ✓    | Mes pick-ups                 |
| GET     | `/api/pickups/:id`                 | ✓    | Détail d'un pick-up          |
| GET     | `/api/pickups/track/:trackingId`   | ✗    | Suivi public                 |
| PATCH   | `/api/pickups/:id/status`          | ✓    | Mettre à jour le statut      |
| POST    | `/api/payments/intent`             | ✓    | Créer un PaymentIntent Stripe|
| GET     | `/api/payments/history`            | ✓    | Historique des paiements     |
| POST    | `/api/payments/webhook`            | ✗    | Webhook Stripe               |
| GET     | `/api/tracking`                    | ✓    | Tous mes colis               |
| GET     | `/api/tracking/:trackingId`        | ✓    | Suivi d'un colis             |
| GET     | `/api/messages/:pickupId`          | ✓    | Messages d'un colis          |
| POST    | `/api/messages/:pickupId`          | ✓    | Envoyer un message           |
| POST    | `/api/notifications/subscribe`     | ✓    | Enregistrer un token push    |
| GET     | `/api/notifications/vapid-public-key` | ✗ | Clé VAPID publique          |

---

## 🔑 Générer les clés VAPID

```bash
cd backend
node -e "const webpush=require('web-push'); const keys=webpush.generateVAPIDKeys(); console.log(keys);"
```

---

## 🎨 Design

- **Typographie** : Syne (display) + DM Sans (body)
- **Couleur principale** : `#1D9E75` (vert africain)
- **Couleur accent** : `#EF9F27` (or/ambre)
- **9 destinations** : 🇸🇳 🇨🇮 🇨🇲 🇬🇳 🇲🇱 🇧🇫 🇨🇩 🇲🇷 🇹🇬

---

## 📱 Installer comme PWA

- **Android (Chrome)** → Menu ⋮ → "Ajouter à l'écran d'accueil"
- **iPhone (Safari)** → Partager → "Sur l'écran d'accueil"
- **Desktop Chrome** → Icône d'installation dans la barre d'adresse
