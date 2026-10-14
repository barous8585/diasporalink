const mongoose = require('mongoose');

// Un téléphone (ou ordinateur) qui a accepté les notifications dans une des apps.
const pushAbonnementSchema = new mongoose.Schema({
  endpoint:  { type: String, required: true, unique: true },
  cles:      { p256dh: String, auth: String },
  app:       { type: String, enum: ['client', 'agent', 'admin'], required: true, index: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  telephone: { type: String, index: true },   // clients : messages liés à leurs colis
  role:      { type: String },
  lieu:      { type: String, index: true },   // agents et livreurs : alertes de leur agence
  appareil:  { type: String },
  echecs:    { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('PushAbonnement', pushAbonnementSchema);
