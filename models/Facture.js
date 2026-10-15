const mongoose = require('mongoose');
const crypto = require('crypto');
const Compteur = require('./Compteur');

// Facture ou avoir. Une fois émise, une facture ne change plus (numérotation continue,
// contenu figé) : les corrections passent par un avoir.
const ligneSchema = new mongoose.Schema({
  cle:          String,            // transport | supplement | assurance | ramassage | livraison | douane | garde | arrondi | remboursement
  designation:  { type: String, required: true },
  detail:       String,
  quantite:     { type: Number, default: 1 },
  unite:        String,            // kg, jour…
  prixUnitaire: Number,            // TTC
  montantTTC:   { type: Number, required: true },
  tauxTva:      { type: Number, default: 0 },
  debours:      Boolean,           // droits de douane refacturés à l'identique, hors TVA
}, { _id: false });

const factureSchema = new mongoose.Schema({
  numero:  { type: String, unique: true },
  type:    { type: String, enum: ['facture', 'avoir'], default: 'facture' },
  colis:   { type: mongoose.Schema.Types.ObjectId, ref: 'Colis', index: true },
  numeroSuivi: { type: String, index: true },
  jeton:   { type: String, index: true },   // lien partageable sans compte
  date:    { type: Date, default: Date.now, index: true },
  emetteur: { type: mongoose.Schema.Types.Mixed },   // mentions légales figées à l'émission
  agence:  { code: String, nom: String, adresse: String, pays: String },
  client:  { nom: String, telephone: String, role: String },
  devise:  { type: String, enum: ['EUR', 'GNF'], required: true },
  taux:    Number,                                   // 1 € = X GNF (taux figé du colis)
  lignes:  [ligneSchema],
  totalHT: Number,
  totalTVA: Number,
  totalTTC: Number,
  totalGnf: Number,                                  // pour répartir les paiements
  parTaux: [{ taux: Number, baseHT: Number, tva: Number, _id: false }],
  mentionTva: String,
  conditionsPaiement: String,
  factureOrigine: { type: String },                  // avoir : numéro de la facture corrigée
  motif:   String,
  agent:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  demo:    { type: Boolean, index: true },               // simulation : numérotation DEMO-FA-…
}, { timestamps: true });

factureSchema.pre('validate', async function (next) {
  try {
    if (!this.numero) {
      const an = new Date(this.date || Date.now()).getFullYear();
      // La numérotation légale (continue) n'est jamais touchée par la démo
      const prefixe = `${this.demo ? 'DEMO-' : ''}${this.type === 'avoir' ? 'AV' : 'FA'}`;
      const n = await Compteur.suivant(`${prefixe}-${an}`);
      this.numero = `${prefixe}-${an}-${String(n).padStart(5, '0')}`;
    }
    if (!this.jeton) this.jeton = crypto.randomBytes(12).toString('hex');
    next();
  } catch (e) { next(e); }
});

factureSchema.post('save', () => require('../utils/temps-reel').prevenir(['admins'], 'facture'));
module.exports = mongoose.model('Facture', factureSchema);
