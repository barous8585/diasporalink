// ── TARIFS PAR PAYS (€/kg) ────────────────
const PRIX_KG = {
  SN: 7.5,   // Sénégal
  CI: 8.0,   // Côte d'Ivoire
  CM: 7.8,   // Cameroun
  GN: 8.5,   // Guinée
  ML: 8.2,   // Mali
  BF: 8.3,   // Burkina Faso
  CD: 9.0,   // RD Congo
  MR: 8.6,   // Mauritanie
  TG: 8.1,   // Togo
  BJ: 8.0,   // Bénin
  SL: 8.8,   // Sierra Leone
  GH: 8.4,   // Ghana
};

// ── FRAIS FIXES ───────────────────────────
const FRAIS_PICKUP    = 5.0;   // Collecte à domicile
const TAUX_ASSURANCE  = 0.023; // 2.3% de la valeur déclarée
const POIDS_MIN       = 0.5;   // kg minimum

// ── PAYS DESSERVIS ────────────────────────
const PAYS = [
  { code: 'SN', nom: 'Sénégal',       drapeau: '🇸🇳', villes: ['Dakar', 'Saint-Louis', 'Thiès', 'Ziguinchor', 'Kaolack'] },
  { code: 'CI', nom: "Côte d'Ivoire", drapeau: '🇨🇮', villes: ['Abidjan', 'Bouaké', 'San-Pédro', 'Yamoussoukro'] },
  { code: 'CM', nom: 'Cameroun',      drapeau: '🇨🇲', villes: ['Douala', 'Yaoundé', 'Bafoussam', 'Garoua'] },
  { code: 'GN', nom: 'Guinée',        drapeau: '🇬🇳', villes: ['Conakry', 'Kankan', 'Labé', 'Nzérékoré'] },
  { code: 'ML', nom: 'Mali',          drapeau: '🇲🇱', villes: ['Bamako', 'Sikasso', 'Mopti', 'Gao'] },
  { code: 'BF', nom: 'Burkina Faso',  drapeau: '🇧🇫', villes: ['Ouagadougou', 'Bobo-Dioulasso', 'Koudougou'] },
  { code: 'CD', nom: 'RD Congo',      drapeau: '🇨🇩', villes: ['Kinshasa', 'Lubumbashi', 'Goma', 'Bukavu'] },
  { code: 'MR', nom: 'Mauritanie',    drapeau: '🇲🇷', villes: ['Nouakchott', 'Nouadhibou'] },
  { code: 'TG', nom: 'Togo',          drapeau: '🇹🇬', villes: ['Lomé', 'Sokodé', 'Kara'] },
  { code: 'BJ', nom: 'Bénin',         drapeau: '🇧🇯', villes: ['Cotonou', 'Porto-Novo', 'Parakou'] },
  { code: 'GH', nom: 'Ghana',         drapeau: '🇬🇭', villes: ['Accra', 'Kumasi', 'Tamale'] },
];

// ── CRÉNEAUX HORAIRES ─────────────────────
const CRENEAUX = [
  { key: 'matin',      label: 'Matin (8h – 12h)' },
  { key: 'apresmidi',  label: 'Après-midi (13h – 17h)' },
  { key: 'soir',       label: 'Soir (17h – 20h)' },
];

// ── TYPES DE COLIS ────────────────────────
const TYPES_COLIS = [
  { key: 'vetements',    label: 'Vêtements' },
  { key: 'electronique', label: 'Électronique' },
  { key: 'medicaments',  label: 'Médicaments' },
  { key: 'documents',    label: 'Documents' },
  { key: 'alimentaire',  label: 'Alimentaire' },
  { key: 'mixte',        label: 'Mixte' },
];

// ── STATUTS COLIS ─────────────────────────
const STATUTS = {
  EN_ATTENTE:    'en_attente',
  CONFIRME:      'confirme',
  COLLECTE:      'collecte',
  EN_TRANSIT:    'en_transit',
  ARRIVE:        'arrive',
  LIVRE:         'livre',
  ANNULE:        'annule',
};

// ── ROLES UTILISATEURS ────────────────────
const ROLES = {
  CLIENT:   'client',
  LIVREUR:  'livreur',
  ADMIN:    'admin',
};

module.exports = {
  PRIX_KG,
  FRAIS_PICKUP,
  TAUX_ASSURANCE,
  POIDS_MIN,
  PAYS,
  CRENEAUX,
  TYPES_COLIS,
  STATUTS,
  ROLES,
};
