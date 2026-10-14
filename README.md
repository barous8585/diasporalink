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
- **Code de retrait à 4 chiffres** envoyé par SMS quand le colis est au guichet. 5 codes faux → colis bloqué, déblocage par l'admin.
- **Tiers autorisé.** L'expéditeur ou le destinataire peut désigner la personne qui vient retirer ; elle reçoit le code.
- **Frais de garde.** Gratuit X jours, puis frais par jour (réglable). Relance SMS en un clic.
- **Hors-ligne.** L'app agent enregistre les scans et les remises sur le téléphone et les envoie au retour du réseau, sans doublon (chaque opération a un identifiant unique). Un colis scanné hors du lot attendu est signalé immédiatement, même sans réseau. L'app client affiche le dernier suivi connu avec son heure.
- **Destinataires reconnus par leur téléphone.** Un destinataire qui se connecte avec son numéro voit les colis qui lui sont envoyés, avec le code.
- **Douchette.** Une douchette USB/Bluetooth marche directement dans le champ de saisie (elle tape le numéro + Entrée).

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

En développement, le code SMS s'affiche à l'écran et tous les SMS sont écrits dans la console.

**Premier lancement :** connectez-vous au back-office avec un numéro listé dans `ADMIN_TELEPHONES`, puis :
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

- **API** : Render (ou équivalent), `npm start`, variables de `.env.example`.
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
- **WhatsApp** : `utils/sms.js → envoyerWhatsApp` est prêt à recevoir la WhatsApp Business Cloud API (Meta). En attendant, tout part par SMS.
- **Audio en langues locales** (pular, soussou, malinké) pour les messages de statut.
- Icônes de l'app : `*/icons/` contient des icônes provisoires.
