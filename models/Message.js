const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  colis:    { type: mongoose.Schema.Types.ObjectId, ref: 'Colis', required: true },
  expediteur: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:     { type: String, enum: ['client', 'livreur', 'systeme'], required: true },
  texte:    { type: String, required: true, maxlength: 1000 },
  lu:       { type: Boolean, default: false },
  luLe:     { type: Date },
}, {
  timestamps: true,
  toJSON: { transform: (_, obj) => { delete obj.__v; return obj; } }
});

module.exports = mongoose.model('Message', messageSchema);
