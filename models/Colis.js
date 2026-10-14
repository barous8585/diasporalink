const mongoose = require('mongoose');
const crypto = require('crypto');
const Compteur = require('./Compteur');
const {
  STATUTS, STATUTS_LABELS, TYPES_COLIS, MODES, METHODES_PAIEMENT, DEVISES, SENS,
} = require('../config/constants');

const personneSchema = new mongoose.Schema({
  nom:       { type: String, required: true, trim: true },
  telephone: { type: String, required: true, trim: true },
}, { _id: false });

const paiementSchema = new mongoose.Schema({
  montant:  { type: Number, required: true, min: 0 },
  devise:   { type: String, enum: DEVISES, required: true },
  methode:  { type: String, enum: METHODES_PAIEMENT.map(m => m.key), required: true },
  objet:    { type: String, enum: ['transport', 'douane', 'magasinage', 'global'], default: 'global' },
  lieu:     { type: String },          // code de l'agence
  agent:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reference:{ type: String },          // ref. Orange Money, Stripe…
  opId:     { type: String },          // idempotence (hors-ligne)
  le:       { type: Date, default: Date.now },
}, { _id: true });

const evenementSchema = new mongoose.Schema({
  statut: { type: String },
  label:  { type: String, required: true },
  detail: { type: String },
  lieu:   { type: String },
  agent:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  le:     { type: Date, default: Date.now },
}, { _id: false });

const colisSchema = new mongoose.Schema({
  numeroSuivi: { type: String, unique: true, index: true },

  // Compte client qui a réservé (absent si déposé directement en agence)
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  expediteur:   { type: personneSchema, required: true },
  destinataire: { type: personneSchema, required: true },
  tiersAutorise:{ nom: String, telephone: String, autoriseLe: Date },

  // Circuit
  sens:        { type: String, enum: SENS.map(s => s.key), default: 'FR-GN', index: true },
  mode:        { type: String, enum: Object.values(MODES), required: true },
  depot:       { type: String, default: 'PARIS' },     // code de l'agence de départ
  guichet:     { type: String, required: true },       // code de l'agence de retrait
  lot:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lot' },
  lotCode:     { type: String, index: true },
  emplacement: { type: String },                        // étagère à l'agence de retrait

  // Contenu
  typeColis:      { type: String, enum: TYPES_COLIS.map(t => t.key), required: true },
  description:    { type: String, trim: true },
  nbCartons:      { type: Number, default: 1, min: 1 },
  poidsEstime:    { type: Number, min: 0 },
  poidsReel:      { type: Number, min: 0 },
  valeurDeclaree: { type: Number, default: 0 },
  assurance:      { type: Boolean, default: false },

  // Prix (taux EUR/GNF figé au moment de la pesée)
  tarif: {
    sens: String, devise: String, total: Number, mode: String, prixKg: Number, poidsFacture: Number, transport: Number,
    surcharge: Number, assurance: Number, totalEur: Number, taux: Number, totalGnf: Number,
    estime: { type: Boolean, default: true },
  },
  fraisDouaneGnf: { type: Number, default: 0 },
  payeurArrivee:  { type: Boolean, default: false }, // le destinataire paie à Conakry
  paiements:      [paiementSchema],

  // Statut
  statut:     { type: String, enum: Object.values(STATUTS), default: STATUTS.RESERVE, index: true },
  historique: [evenementSchema],
  arriveGuichetLe: { type: Date },

  // Retrait
  codeRetrait:      { type: String, select: false },
  codeEssais:       { type: Number, default: 0, select: false },
  remise: {
    le:           Date,
    agent:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    retirePar:    { type: String, enum: ['destinataire', 'tiers'] },
    nomRetrait:   String,
    pieceVerifiee:Boolean,
    signature:    String, // image PNG en data URL
    opId:         String,
  },

  notesAdmin: { type: String },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, obj) => { delete obj.__v; delete obj.codeRetrait; delete obj.codeEssais; return obj; },
  },
});

// Les anciens colis DiasporaLink (avant TMS) n'ont pas d'expéditeur : on les ignore
// partout (recherche, comptes, statistiques) sans les supprimer de la base.
const FILTRE_ACTUELS = { expediteur: { $exists: true } };
colisSchema.pre(/^(find|count)/, function () {
  if (!this.getOptions().inclureAnciens) this.where(FILTRE_ACTUELS);
});
colisSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: FILTRE_ACTUELS });
});

colisSchema.index({ 'destinataire.telephone': 1 });
colisSchema.index({ 'expediteur.telephone': 1 });

colisSchema.virtual('statutLabel').get(function () {
  return STATUTS_LABELS[this.statut] || this.statut;
});

// Numéro de suivi : TMS-26-00001 (préfixe, année, séquence)
colisSchema.pre('validate', async function (next) {
  try {
    if (!this.numeroSuivi) {
      const n = await Compteur.suivant('colis');
      const an = String(new Date().getFullYear()).slice(-2);
      const prefixe = (process.env.PREFIXE_SUIVI || 'TMS').toUpperCase();
      this.numeroSuivi = `${prefixe}-${an}-${String(n).padStart(5, '0')}`;
    }
    next();
  } catch (e) { next(e); }
});

colisSchema.methods.ajouterEvenement = function (statut, detail, { lieu, agent, label } = {}) {
  if (statut) this.statut = statut;
  this.historique.push({
    statut,
    label: label || STATUTS_LABELS[statut] || statut,
    detail, lieu, agent, le: new Date(),
  });
};

colisSchema.methods.genererCodeRetrait = function () {
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  this.codeRetrait = code;
  this.codeEssais = 0;
  return code;
};

// Empreinte du code : permet à l'app agent de vérifier un code hors-ligne
// (même calcul côté navigateur avec crypto.subtle). Seuls les agents la reçoivent.
colisSchema.statics.empreinteCode = (numero, code) =>
  crypto.createHash('sha256').update(`${numero}:${code}`).digest('hex');

module.exports = mongoose.model('Colis', colisSchema);
