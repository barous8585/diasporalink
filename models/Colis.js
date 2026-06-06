const mongoose = require('mongoose');
const { STATUTS, CRENEAUX, TYPES_COLIS } = require('../config/constants');

const etapeSchema = new mongoose.Schema({
  label:       { type: String, required: true },
  detail:      { type: String },
  statut:      { type: String, enum: ['fait', 'en_cours', 'attente'], default: 'attente' },
  completeLe:  { type: Date },
}, { _id: false });

const colisSchema = new mongoose.Schema({
  // Identifiant de suivi
  numeroSuivi: { type: String, unique: true },

  // Client
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Collecte
  adresseCollecte: { type: String, required: true },
  villeCollecte:   { type: String, required: true },
  dateCollecte:    { type: Date, required: true },
  creneau:         { type: String, enum: CRENEAUX.map(c => c.key), required: true },

  // Destination
  paysDestination:  { type: String, required: true },
  villeDestination: { type: String, required: true },
  nomDestinataire:  { type: String, required: true },
  telDestinataire:  { type: String, required: true },

  // Colis
  typeColis:     { type: String, enum: TYPES_COLIS.map(t => t.key), required: true },
  poidsKg:       { type: Number, required: true, min: 0.1 },
  valeurDeclare: { type: Number, default: 0 },
  description:   { type: String },

  // Tarification
  tarif: {
    fraisCollecte:  { type: Number, required: true },
    fraisTransport: { type: Number, required: true },
    fraisAssurance: { type: Number, default: 0 },
    total:          { type: Number, required: true },
  },

  // Statut
  statut: {
    type: String,
    enum: Object.values(STATUTS),
    default: STATUTS.EN_ATTENTE,
  },

  // Étapes de suivi
  etapes: [etapeSchema],

  // Livreur assigné
  livreur: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  livreurNom:  { type: String },
  livreurTel:  { type: String },

  // Paiement
  paiementId:     { type: String },
  paiementStatut: { type: String, enum: ['en_attente', 'paye', 'rembourse'], default: 'en_attente' },
  paiementMethode: { type: String },

  // Notes
  notesAdmin: { type: String },

}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, obj) => { delete obj.__v; return obj; }
  }
});

// Générer numéro de suivi automatiquement
colisSchema.pre('save', async function (next) {
  if (!this.numeroSuivi) {
    const count = await mongoose.model('Colis').countDocuments();
    const numero = String(count + 1000).padStart(4, '0');
    this.numeroSuivi = `DL-${numero}`;
  }
  next();
});

// Étapes par défaut
colisSchema.methods.initEtapes = function () {
  this.etapes = [
    { label: 'Commande confirmée',       detail: 'Votre commande a été enregistrée',    statut: 'attente' },
    { label: 'Colis collecté',           detail: 'Le livreur a récupéré votre colis',   statut: 'attente' },
    { label: 'En transit',               detail: 'Votre colis est en route',             statut: 'attente' },
    { label: "Arrivée à destination",    detail: 'Le colis est arrivé dans le pays',     statut: 'attente' },
    { label: 'Livré au destinataire',    detail: 'Le destinataire a reçu le colis',      statut: 'attente' },
  ];
};

// Libellé du statut
colisSchema.virtual('statutLabel').get(function () {
  const labels = {
    en_attente:  'En attente',
    confirme:    'Confirmé',
    collecte:    'Collecté',
    en_transit:  'En transit',
    arrive:      'Arrivé',
    livre:       'Livré',
    annule:      'Annulé',
  };
  return labels[this.statut] || this.statut;
});

module.exports = mongoose.model('Colis', colisSchema);
