const mongoose = require('mongoose');
const Compteur = require('./Compteur');

// Réclamation sur un colis : perdu, abîmé, incomplet, en retard…
const MOTIFS = [
  { key: 'perdu',     label: 'Colis perdu' },
  { key: 'abime',     label: 'Colis abîmé' },
  { key: 'incomplet', label: 'Contenu manquant' },
  { key: 'retard',    label: 'Retard important' },
  { key: 'autre',     label: 'Autre problème' },
];
const STATUTS = ['ouverte', 'en_cours', 'acceptee', 'refusee', 'close'];

const reclamationSchema = new mongoose.Schema({
  numero:  { type: String, unique: true },
  colis:   { type: mongoose.Schema.Types.ObjectId, ref: 'Colis', required: true, index: true },
  numeroSuivi: { type: String, index: true },
  motif:   { type: String, enum: MOTIFS.map(m => m.key), required: true },
  description: { type: String, trim: true, maxlength: 3000 },
  montantDemande: Number,
  deviseDemande: { type: String, enum: ['EUR', 'GNF'] },
  demandeur: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    nom: String, telephone: String, role: String, // expéditeur | destinataire
  },
  photos:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Photo' }],
  horsDelai: Boolean,
  statut:  { type: String, enum: STATUTS, default: 'ouverte', index: true },
  // Échanges : le client ne voit pas les notes internes
  suivi: [{
    auteur: { type: String, enum: ['client', 'tms'] }, nom: String, texte: String,
    interne: Boolean, le: { type: Date, default: Date.now }, _id: false,
  }],
  decision: {
    type: { type: String, enum: ['indemnisation', 'avoir', 'refus'] },
    montant: Number, devise: String, motif: String, le: Date,
    par: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    avoir: String,                    // numéro de l'avoir émis
    versement: { methode: String, reference: String, le: Date },
  },
}, { timestamps: true });

reclamationSchema.pre('validate', async function (next) {
  try {
    if (!this.numero) {
      const an = new Date().getFullYear();
      this.numero = `R-${an}-${String(await Compteur.suivant(`R-${an}`)).padStart(4, '0')}`;
    }
    next();
  } catch (e) { next(e); }
});

module.exports = mongoose.model('Reclamation', reclamationSchema);
module.exports.MOTIFS = MOTIFS;
module.exports.STATUTS = STATUTS;
