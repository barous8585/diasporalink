const mongoose = require('mongoose');

// Avis d'un client sur un envoi terminé (colis remis) : une note de 1 à 5 et un commentaire.
// Un seul avis par personne et par colis (modifiable). Tous les avis sont publiés ;
// l'équipe peut répondre publiquement, et masquer un avis seulement s'il contient des
// propos injurieux ou des données personnelles (le motif est gardé).
const avisSchema = new mongoose.Schema({
  colis:       { type: mongoose.Schema.Types.ObjectId, ref: 'Colis', required: true, index: true },
  numeroSuivi: { type: String, index: true },
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  auteur:      { type: String, trim: true, maxlength: 60 },   // « Mariama D. » : prénom et initiale seulement
  role:        { type: String, enum: ['expediteur', 'destinataire'] },
  sens:        { type: String },
  mode:        { type: String },
  note:        { type: Number, min: 1, max: 5, required: true },
  commentaire: { type: String, trim: true, maxlength: 1000 },
  statut:      { type: String, enum: ['publie', 'masque'], default: 'publie', index: true },
  motifMasque: { type: String, trim: true, maxlength: 200 },
  reponse: {
    texte: { type: String, trim: true, maxlength: 1000 },
    le:    Date,
    par:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  modifieLe:   Date,
}, { timestamps: true });

avisSchema.index({ colis: 1, user: 1 }, { unique: true });

// Avis communs à tous : toutes les apps ouvertes (clients et admin) se mettent à jour en direct
avisSchema.post('save', () => require('../utils/temps-reel').prevenir(['admins', 'avis'], 'avis'));
module.exports = mongoose.model('Avis', avisSchema);
