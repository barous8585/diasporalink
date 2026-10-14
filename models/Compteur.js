const mongoose = require('mongoose');

// Compteurs atomiques (numéros de suivi, numéros de lot) — évite les doublons
// que produisait l'ancien countDocuments() quand deux colis arrivaient en même temps.
const compteurSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

compteurSchema.statics.suivant = async function (nom, depart = 0) {
  const doc = await this.findOneAndUpdate(
    { _id: nom },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq + depart;
};

module.exports = mongoose.model('Compteur', compteurSchema);
