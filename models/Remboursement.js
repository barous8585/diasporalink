const mongoose = require('mongoose');

const remboursementSchema = new mongoose.Schema({
  colis:    { type: mongoose.Schema.Types.ObjectId, ref: 'Colis', required: true },
  client:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  motif:    {
    type: String,
    enum: ['colis_perdu', 'colis_endommage', 'retard_excessif', 'annulation', 'autre'],
    required: true,
  },
  description:     { type: String, maxlength: 500 },
  montant:         { type: Number },
  statut:          { type: String, enum: ['en_attente', 'en_cours', 'approuve', 'refuse', 'rembourse'], default: 'en_attente' },
  noteAdmin:       { type: String },
  traitePar:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  traiteAt:        { type: Date },
  montantApprouve: { type: Number },
}, {
  timestamps: true,
  toJSON: { transform: (_, obj) => { delete obj.__v; return obj; } }
});

module.exports = mongoose.model('Remboursement', remboursementSchema);
