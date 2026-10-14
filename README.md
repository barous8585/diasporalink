# Talib Multi Services (TMS) : expédition de colis Europe → Guinée

Plateforme d'envoi de colis **France ⇄ Guinée**, pensée pour le terrain : **agence de départ → lot (avion ou bateau) → plateforme d'arrivée → (redistribution vers l'agence d'une autre ville) → remise au destinataire avec un code**.

- **Deux sens** : France → Guinée et Guinée → France, chacun avec sa grille de prix (en € ou en GNF).
- **Réseau d'agences** dans les deux pays (ville, commune, horaires). Chaque agence reçoit les colis à envoyer, remet les colis arrivés et encaisse. Dans chaque pays, une agence est la **plateforme** où arrivent les lots ; de là, les colis repartent vers les autres agences (statut « En route vers l'agence »).

Nom affiché : `APP_NOM` (Talib Multi Services), nom court pour les SMS : `APP_NOM_COURT` (TMS), préfixe des numéros : `PREFIXE_SUIVI` (TMS). Mentions légales : `config/constants.js → ENTREPRISE`.

## Les 3 apps

| Dossier | Pour qui | Ce qu'on y fait |
|---|---|---|
| `frontend/` | Clients (expéditeurs et destinataires) | Suivi par numéro (même hors-ligne), estimation du prix, réservation, code de retrait, autoriser quelqu'un à retirer, paiement carte |
| `agent/` | Agents des agences | Pesée + prix final + étiquettes QR, scanner (chargement, arrivée, envoi vers une autre agence, mise en rayon), remise par code avec encaissement et signature, caisse du jour |
| `admin/` | Administrateur | Tableau de bord, lots et manifestes, changement de statut en masse, recherche de colis, caisses, tarifs/taux/guichets, équipe |

## Les règles du terrain intégrées

- **Prix fixé à la pesée.** Le client voit une estimation ; l'agent pèse, le prix est recalculé, l'écart de poids est signalé.
- **Taux EUR/GNF figé par colis.** L'admin met à jour le taux ; chaque colis garde le taux du jour de sa pesée.
- **Espèces = moyen de paiement à part entière.** Chaque encaissement est rattaché à l'agent, puis clôturé le soir avec l'écart de caisse.
- **Paiement à l'arrivée possible.** Le destinataire paie à Conakry (transport + douane + frais de garde).
- **Connexion par mot de passe** (pas de fournisseur SMS pour l'instant). Les clients créent leur compte ; l'admin crée les comptes agents et peut réinitialiser un mot de passe. Changer un mot de passe ferme les sessions ouvertes. 8 essais faux → compte bloqué 15 minutes.
- **Code de retrait à 4 chiffres** créé quand le colis est en agence : visible dans le compte de la personne qui a réservé, et dans celui du destinataire si son numéro a été vérifié en agence (sinon n'importe qui pourrait créer un compte avec son numéro). Il partira aussi par SMS quand un fournisseur sera branché. 5 codes faux → colis bloqué, déblocage par l'admin.
- **Tiers autorisé.** L'expéditeur ou le destinataire peut désigner la personne qui vient retirer ; elle reçoit le code.
- **Frais de garde.** Gratuit X jours, puis frais par jour (réglable). Relance SMS en un clic.
- **Hors-ligne.** L'app agent enregistre les scans et les remises sur le téléphone et les envoie au retour du réseau, sans doublon (chaque opération a un identifiant unique). Un colis scanné hors du lot attendu est signalé immédiatement, même sans réseau. L'app client affiche le dernier suivi connu avec son heure.
- **Destinataires reconnus par leur téléphone.** Un destinataire qui se connecte avec son numéro voit les colis qui lui sont envoyés, avec le code.
- **Douchette.** Une douchette USB/Bluetooth marche directement dans le champ de saisie (elle tape le numéro + Entrée).

## Ramassage et livraison à domicile

- **Facultatif, au choix du client** : « On vient chercher » au départ, « Livraison à domicile » à l'arrivée. Au comptoir, l'agent peut aussi cocher la livraison.
- **Prix au kilomètre** : base + prix par km × distance entre l'agence et le client (vol d'oiseau + 30 % pour les routes), arrondi au millier de GNF ou au demi-euro, plafond et distance maximum facultatifs. Réglable par pays dans *Tarifs & agences*. Valeurs de départ : Guinée 10 000 GNF + 2 000 GNF/km, France 8 € + 1 €/km.
- **Adresse** : quartier, point de repère, téléphone sur place, et position GPS (bouton « Je suis sur place » ou lien de localisation WhatsApp / Google Maps collé). Chaque agence doit avoir sa position GPS pour proposer le service.
- **Position du destinataire** : si l'expéditeur ne l'a pas, le destinataire l'envoie lui-même depuis la page de suivi (vérifié par son numéro). Il peut aussi y demander ou annuler la livraison.
- **Livreurs dédiés** (rôle « Livreur » dans *Équipe*) : ils se connectent à l'app agent et ne voient que « Courses » et « Caisse ». Ils prennent les courses de leur agence ou l'admin les assigne (*Courses à domicile*).
- **Ramassage** : « Colis ramassé » → le livreur le rapporte à l'agence, où il est pesé ; le prix du ramassage s'ajoute au prix à payer.
- **Livraison** : « Je pars livrer » à l'agence → chez le destinataire : code de retrait (vérifié même hors-ligne), encaissement du solde, signature. En cas d'échec, le colis revient en rayon.
- **Contrôle** : la position du téléphone du livreur est notée quand il valide ; l'admin voit l'écart avec l'adresse (alerte au-delà de 500 m).

## Démarrer en local

```bash
npm install
cp .env.example .env       # renseigner MONGODB_URI, JWT_SECRET, ADMIN_TELEPHONES
npm run sync-apps          # copie shared/ et utils/tarif.js dans chaque app
npm run dev                # API + les 3 apps sur http://localhost:5000
```

- Client : http://localhost:5000/
- Agent : http://localhost:5000/agent/
- Back-office : http://localhost:5000/admin/

En développement, les SMS qui partiraient sont écrits dans la console.

**Premier lancement :** connectez-vous au back-office avec un numéro listé dans `ADMIN_TELEPHONES` et le mot de passe `ADMIN_MOT_DE_PASSE` (l'app demande aussitôt d'en choisir un nouveau), puis :
1. *Tarifs & agences* : taux EUR/GNF, prix au kilo par sens, liste des agences (France et Guinée) avec la plateforme d'arrivée de chaque pays.
2. *Équipe* : ajoutez les agents avec leur agence.
3. *Lots* : créez un lot (sens + avion/bateau) ; les agents de l'agence de départ y chargent les colis en les scannant.

## Tests

```bash
npm test                   # règles de prix, garde, solde
npm run test:parcours      # parcours complet sur une base MongoDB (MONGODB_URI)
```

Le test de parcours couvre : réservation, pesée, paiement, scans rejoués hors-ligne, lot parti/arrivé, mise en rayon, suivi public sans données sensibles, code de retrait, tiers autorisé, remise refusée si le solde n'est pas payé, caisse et clôture.

## Déploiement

- **API** : Render (ou équivalent), `npm start`, variables de `.env.example`. Indispensables : `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV=production`, `ADMIN_TELEPHONES`, `ADMIN_MOT_DE_PASSE`, `FRONTEND_URL`.
- **Paiement par carte (Stripe)** : `STRIPE_SECRET_KEY` (Stripe → Développeurs → Clés API) et `STRIPE_WEBHOOK_SECRET` (Stripe → Développeurs → Webhooks → endpoint `https://<api>/api/paiements/webhook`, évènement `checkout.session.completed`).
- **Apps** : 3 sites Netlify, dossiers `frontend/`, `agent/`, `admin/`. Lancer `npm run sync-apps` avant chaque publication (les fichiers communs sont copiés dans `commun/`).
- L'adresse de l'API est définie dans `shared/kolis.js` (`API_URL`) ; on peut aussi la fixer avec `window.KOLIS_API_URL`.

## Organisation du code

```
server.js                 point d'entrée Express
config/constants.js       statuts, modes, types, valeurs par défaut
models/                   Colis, Lot, Mouvement/Cloture (caisse), Config, User, Compteur, OperationSync
services/colisService.js  règles métier : dépôt, scans, remise, encaissement
utils/tarif.js            calcul du prix, de la garde et du solde (partagé avec les apps)
routes/                   auth, config, colis (client), agent, lots, caisse, admin, utilisateurs, paiements
shared/                   styles et outils communs aux 3 apps
```

## À brancher en v2

- **Orange Money / MTN MoMo** : `POST /api/paiements/mobile-money` répond « bientôt disponible ». Brancher un agrégateur local.
- **SMS** : aucun fournisseur (Twilio retiré). Brancher un fournisseur dans `utils/sms.js → envoyerViaFournisseur`, définir `SMS_FOURNISSEUR`, et éventuellement repasser la connexion en `AUTH_MODE=sms`.
- **WhatsApp** : `utils/sms.js → envoyerWhatsApp` est prêt à recevoir la WhatsApp Business Cloud API (Meta).
- **Audio en langues locales** (pular, soussou, malinké) pour les messages de statut.
- Icônes de l'app : `*/icons/` contient des icônes provisoires.
