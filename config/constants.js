// ─────────────────────────────────────────────────────────────
//  Constantes métier — Talib Multi Services, France ⇄ Guinée
//  Circuit : agence de départ → lot (avion / bateau) → plateforme d'arrivée
//            → (redistribution) → agence de retrait → remise avec code
//  Les valeurs chiffrées ci-dessous ne sont que des valeurs de départ :
//  l'admin les modifie dans le back-office (collection Config).
// ─────────────────────────────────────────────────────────────

// Nom affiché dans les apps, les étiquettes et les documents
const APP_NOM = process.env.APP_NOM || 'Talib Multi Services';
// Nom court : SMS (un SMS au-delà de 160 caractères coûte double), icônes
const APP_NOM_COURT = process.env.APP_NOM_COURT || 'TMS';

// Mentions légales
const ENTREPRISE = {
  raisonSociale: 'TALIB MULTI SERVICES',
  nomCommercial: 'Talib Multi Services - TMS',
  forme: 'SAS',
  siren: '105005409',
  siret: '10500540900013',
  tva: 'FR09105005409',
  rcs: 'RCS Paris 105 005 409',
  adresse: '108 rue de Clignancourt, 75018 Paris',
};

// ── MODES DE TRANSPORT ────────────────────
const MODES = {
  AIR: 'air',
  MER: 'mer',
};

const MODES_INFO = [
  { key: 'air', label: 'Avion',  delai: '5 à 8 jours',     prefixeLot: 'AIR' },
  { key: 'mer', label: 'Bateau', delai: '4 à 6 semaines',  prefixeLot: 'MER' },
];

// ── TYPES DE COLIS (surcharge en % du transport) ──
const TYPES_COLIS = [
  { key: 'vetements',    label: 'Vêtements',    surcharge: 0 },
  { key: 'alimentaire',  label: 'Alimentaire',  surcharge: 0 },
  { key: 'documents',    label: 'Documents',    surcharge: 0 },
  { key: 'mixte',        label: 'Mixte',        surcharge: 0 },
  { key: 'fragile',      label: 'Fragile',      surcharge: 0.10 },
  { key: 'electronique', label: 'Électronique', surcharge: 0.15 },
];

// ── PAYS ET SENS D'ENVOI ──────────────────
const PAYS = {
  FR: { code: 'FR', nom: 'France', devise: 'EUR', indicatif: '+33' },
  GN: { code: 'GN', nom: 'Guinée', devise: 'GNF', indicatif: '+224' },
};
const SENS = [
  { key: 'FR-GN', depart: 'FR', arrivee: 'GN', label: 'France → Guinée' },
  { key: 'GN-FR', depart: 'GN', arrivee: 'FR', label: 'Guinée → France' },
];
const sensEntre = (paysDepart, paysArrivee) => SENS.find(s => s.depart === paysDepart && s.arrivee === paysArrivee) || null;

// ── CONFIG PAR DÉFAUT (modifiable par l'admin) ──
// Les montants sont des valeurs de départ, à remplacer par les vrais tarifs TMS.
const CONFIG_DEFAUT = {
  // Prix au kilo par sens, dans la devise du pays de départ
  tarifs: {
    'FR-GN': { devise: 'EUR', air: { prixKg: 12, poidsMin: 1 }, mer: { prixKg: 4, poidsMin: 10 } },
    'GN-FR': { devise: 'GNF', air: { prixKg: 120000, poidsMin: 1 }, mer: { prixKg: 40000, poidsMin: 10 } },
  },
  surcharges: Object.fromEntries(TYPES_COLIS.map(t => [t.key, t.surcharge])),
  tauxAssurance: 0.023,      // 2,3 % de la valeur déclarée (optionnel)
  tauxEurGnf: 10000,         // 1 € = X GNF — À METTRE À JOUR par l'admin
  magasinage: {
    joursGratuits: 10,       // jours gratuits à l'agence de retrait
    fraisJourGnf: 5000,      // frais par jour au-delà, agences en Guinée
    fraisJourEur: 1,         // frais par jour au-delà, agences en France
  },
  // Agences TMS : chacune reçoit les colis à envoyer, remet les colis arrivés et encaisse.
  // « plateforme » = l'agence où arrivent les lots dans ce pays, d'où les colis
  // sont redistribués vers les autres agences.
  agences: [
    { code: 'PARIS', nom: 'Agence Paris 18e', pays: 'FR', ville: 'Paris', commune: '18e', adresse: '108 rue de Clignancourt, 75018 Paris', telephone: '', horaires: '', plateforme: true },
    { code: 'KALOUM', nom: 'Agence Kaloum', pays: 'GN', ville: 'Conakry', commune: 'Kaloum', adresse: '', telephone: '', horaires: '', plateforme: true },
    { code: 'MATOTO', nom: 'Agence Matoto', pays: 'GN', ville: 'Conakry', commune: 'Matoto', adresse: '', telephone: '', horaires: '', plateforme: false },
  ],
  // Ramassage chez l'expéditeur et livraison chez le destinataire, par des livreurs TMS.
  // Prix = base + prix par km × distance (vol d'oiseau × majoration, pour suivre les routes)
  // entre l'agence et l'adresse du client. Dans la devise du pays où se fait la course.
  domicile: {
    majoration: 1.3,
    FR: { actif: true, base: 8,     parKm: 1,    plafond: 0, rayonMaxKm: 60 },
    GN: { actif: true, base: 10000, parKm: 2000, plafond: 0, rayonMaxKm: 40 },
  },
  // Facturation : complète les mentions légales (ENTREPRISE). Prix affichés TTC.
  // La TVA dépend du pays de l'agence qui encaisse — À FAIRE VALIDER PAR L'EXPERT-COMPTABLE.
  facturation: {
    capital: '',              // ex. « 1 000 € » (mention obligatoire pour une SAS)
    email: '',
    telephone: '',
    site: '',
    tva: {
      FR: { taux: 0.20, mention: '' },
      GN: { taux: 0, mention: 'TVA non applicable' },
    },
    conditionsPaiement: 'Payable comptant au dépôt ou à la remise du colis. Pas d\'escompte pour paiement anticipé.',
  },
  // Litiges
  litiges: {
    indemnisationKgEur: 20,   // plafond par kg sans assurance (€)
    delaiAbimeJours: 3,       // réclamation pour colis abîmé / incomplet, après la remise
    delaiPerduJours: 30,      // réclamation pour colis perdu ou en retard
  },
};

// Version des conditions générales : changer la date quand le texte change
const CGV_VERSION = '2026-10-14';

// ── STATUTS COLIS (ordre du circuit) ──────
const STATUTS = {
  RESERVE:      'reserve',      // réservé en ligne, pas encore déposé
  DEPOSE:       'depose',       // pesé et enregistré à l'agence de départ
  CHARGE:       'charge',       // mis dans un lot, attend le départ
  EN_TRANSIT:   'en_transit',   // lot parti
  ARRIVE:       'arrive',       // arrivé dans le pays de destination (plateforme)
  ACHEMINEMENT: 'acheminement', // en route vers l'agence de retrait
  PRET:         'pret',         // disponible à l'agence de retrait, code envoyé
  EN_LIVRAISON: 'en_livraison', // parti avec le livreur vers le destinataire
  REMIS:        'remis',        // remis au destinataire
  ANNULE:       'annule',
};

const STATUTS_LABELS = {
  reserve:      'Réservé — à déposer',
  depose:       'Déposé en agence',
  charge:       'Chargé, en attente de départ',
  en_transit:   'En route',
  arrive:       'Arrivé à destination',
  acheminement: 'En route vers l\'agence',
  pret:         'Prêt à l\'agence',
  en_livraison: 'En cours de livraison',
  remis:        'Remis au destinataire',
  annule:       'Annulé',
};

// ── STATUTS LOT ───────────────────────────
const STATUTS_LOT = {
  PREPARATION: 'preparation',
  PARTI:       'parti',
  ARRIVE:      'arrive',
  CLOTURE:     'cloture',
};

// ── PAIEMENT ──────────────────────────────
const METHODES_PAIEMENT = [
  { key: 'especes',      label: 'Espèces' },
  { key: 'orange_money', label: 'Orange Money' },
  { key: 'mtn_momo',     label: 'MTN MoMo' },
  { key: 'carte',        label: 'Carte bancaire' },
  { key: 'virement',     label: 'Virement' },
];
const DEVISES = ['EUR', 'GNF'];

// ── RÔLES ─────────────────────────────────
const ROLES = {
  CLIENT: 'client',
  AGENT:  'agent',
  LIVREUR:'livreur',
  ADMIN:  'admin',
};

// ── COURSES À DOMICILE ────────────────────
const TYPES_COURSE = ['ramassage', 'livraison'];
const STATUTS_COURSE = {
  A_PLANIFIER: 'a_planifier', // demandée, pas encore de livreur
  ASSIGNEE:    'assignee',    // un livreur s'en charge
  EN_ROUTE:    'en_route',    // livraison : le colis est parti avec le livreur
  FAITE:       'faite',
  ANNULEE:     'annulee',
};
const MOMENTS = [
  { key: 'matin', label: 'Matin (8 h – 12 h)' },
  { key: 'apres_midi', label: 'Après-midi (12 h – 17 h)' },
  { key: 'soir', label: 'Soir (17 h – 20 h)' },
];

// ── SÉCURITÉ CODE DE RETRAIT ──────────────
const CODE_RETRAIT_ESSAIS_MAX = 5;

module.exports = {
  APP_NOM,
  APP_NOM_COURT,
  ENTREPRISE,
  MODES,
  MODES_INFO,
  TYPES_COLIS,
  CONFIG_DEFAUT,
  PAYS,
  SENS,
  sensEntre,
  STATUTS,
  STATUTS_LABELS,
  STATUTS_LOT,
  METHODES_PAIEMENT,
  DEVISES,
  ROLES,
  TYPES_COURSE,
  STATUTS_COURSE,
  MOMENTS,
  CODE_RETRAIT_ESSAIS_MAX,
  CGV_VERSION,
};
