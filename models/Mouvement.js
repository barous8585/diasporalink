const mongoose = require('mongoose');
const { METHODES_PAIEMENT, DEVISES } = require('../config/constants');

// Chaque encaissement fait par un agent. Sert à la caisse du jour et à la clôture.
const mouvementSchema = new mongoose.Schema({
  agent:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  lieu:    { type: String, required: true },
  colis:   { type: mongoose.Schema.Types.ObjectId, ref: 'Colis' },
  numeroSuivi: { type: String },
  montant: { type: Number, required: true },
  devise:  { type: String, enum: DEVISES, required: true },
  methode: { type: String, enum: METHODES_PAIEMENT.map(m => m.key), required: true },
  objet:   { type: String },
  reference: { type: String },
  cloture: { type: mongoose.Schema.Types.ObjectId, ref: 'Cloture', default: null, index: true },
  le:      { type: Date, default: Date.now },
}, { timestamps: true });

const clotureSchema = new mongoose.Schema({
  agent:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lieu:   { type: String, required: true },
  // totaux[devise][methode] = montant
  totaux: { type: mongoose.Schema.Types.Mixed, default: {} },
  especesComptees: { EUR: Number, GNF: Number },
  ecart:           { EUR: Number, GNF: Number },
  nbMouvements: Number,
  commentaire: String,
}, { timestamps: true, minimize: false });

module.exports = {
  Mouvement: mongoose.model('Mouvement', mouvementSchema),
  Cloture:   mongoose.model('Cloture', clotureSchema),
};
