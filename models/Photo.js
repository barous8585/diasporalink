const mongoose = require('mongoose');

// Photos (colis au dépôt, preuves d'une réclamation). Gardées dans la base, en JPEG
// déjà réduit par le téléphone : quelques dizaines de Ko chacune.
const TAILLE_MAX = 600 * 1024;

const photoSchema = new mongoose.Schema({
  type:   { type: String, enum: ['depot', 'reclamation'], required: true },
  colis:  { type: mongoose.Schema.Types.ObjectId, ref: 'Colis', index: true },
  numeroSuivi: String,
  reclamation: { type: mongoose.Schema.Types.ObjectId, ref: 'Reclamation', index: true },
  mime:   { type: String, default: 'image/jpeg' },
  donnees:{ type: Buffer, required: true, select: false },
  taille: Number,
  par:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

photoSchema.statics.depuisDataUrl = async function (dataUrl, { type, colis, reclamation, par }) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) { const e = new Error('Photo illisible.'); e.status = 400; throw e; }
  const donnees = Buffer.from(m[2], 'base64');
  if (donnees.length > TAILLE_MAX) { const e = new Error('Photo trop lourde (600 Ko maximum).'); e.status = 400; throw e; }
  return this.create({ type, colis: colis?._id, numeroSuivi: colis?.numeroSuivi, reclamation, mime: m[1], donnees, taille: donnees.length, par });
};

module.exports = mongoose.model('Photo', photoSchema);
