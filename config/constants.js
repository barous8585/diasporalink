// ─────────────────────────────────────────────────────────────
//  Constantes métier — expédition Europe → Guinée
//  Circuit : dépôt (Paris) → lot (avion / bateau) → arrivée Conakry
//            → guichet → remise au destinataire avec code
//  Les valeurs chiffrées ci-dessous ne sont que des valeurs de départ :
//  l'admin les modifie dans le back-office (collection Config).
// ─────────────────────────────────────────────────────────────

const APP_NOM = process.env.APP_NOM || 'Kolis';

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

// ── CONFIG PAR DÉFAUT (modifiable par l'admin) ──
const CONFIG_DEFAUT = {
  tarifs: {
    air: { prixKg: 12, poidsMin: 1 },
    mer: { prixKg: 4,  poidsMin: 10 },
  },
  surcharges: Object.fromEntries(TYPES_COLIS.map(t => [t.key, t.surcharge])),
  tauxAssurance: 0.023,      // 2,3 % de la valeur déclarée (optionnel)
  tauxEurGnf: 10000,         // 1 € = X GNF — À METTRE À JOUR par l'admin
  magasinage: {
    joursGratuits: 10,       // jours gratuits au guichet
    fraisJourGnf: 5000,      // frais par jour au-delà
  },
  depots: [
    { code: 'PARIS', nom: 'Dépôt Paris', ville: 'Paris', pays: 'FR', adresse: '', telephone: '', horaires: '' },
  ],
  guichets: [
    { code: 'KALOUM', nom: 'Guichet Kaloum', ville: 'Conakry', pays: 'GN', adresse: '', telephone: '', horaires: '' },
    { code: 'MATOTO', nom: 'Guichet Matoto', ville: 'Conakry', pays: 'GN', adresse: '', telephone: '', horaires: '' },
  ],
};

// ── STATUTS COLIS (ordre du circuit) ──────
const STATUTS = {
  RESERVE:    'reserve',     // réservé en ligne, pas encore déposé
  DEPOSE:     'depose',      // pesé et enregistré au dépôt
  CHARGE:     'charge',      // mis dans un lot, attend le départ
  EN_TRANSIT: 'en_transit',  // lot parti
  ARRIVE:     'arrive',      // arrivé en Guinée (aéroport / port)
  PRET:       'pret',        // disponible au guichet, code envoyé
  REMIS:      'remis',       // remis au destinataire
  ANNULE:     'annule',
};

const STATUTS_LABELS = {
  reserve:    'Réservé — à déposer',
  depose:     'Déposé au dépôt',
  charge:     'Chargé, en attente de départ',
  en_transit: 'En route',
  arrive:     'Arrivé en Guinée',
  pret:       'Prêt au guichet',
  remis:      'Remis au destinataire',
  annule:     'Annulé',
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
  ADMIN:  'admin',
};

// ── SÉCURITÉ CODE DE RETRAIT ──────────────
const CODE_RETRAIT_ESSAIS_MAX = 5;

module.exports = {
  APP_NOM,
  MODES,
  MODES_INFO,
  TYPES_COLIS,
  CONFIG_DEFAUT,
  STATUTS,
  STATUTS_LABELS,
  STATUTS_LOT,
  METHODES_PAIEMENT,
  DEVISES,
  ROLES,
  CODE_RETRAIT_ESSAIS_MAX,
};
