const mongoose = require('mongoose');
const Compteur = require('./Compteur');
const { MODES, MODES_INFO, STATUTS_LOT, SENS } = require('../config/constants');

// Un lot = un vol ou un conteneur. Les colis y sont affectés au chargement.
const lotSchema = new mongoose.Schema({
  code:     { type: String, unique: true, index: true },   // AIR-0001 (France → Guinée), AIR-GF-0001 (Guinée → France)
  sens:     { type: String, enum: SENS.map(s => s.key), default: 'FR-GN' },
  mode:     { type: String, enum: Object.values(MODES), required: true },
  depot:       { type: String },   // agence plateforme de départ
  destination: { type: String },   // agence plateforme d'arrivée (où le lot est réceptionné)
  reference: { type: String, trim: true },   // n° de vol, n° de conteneur, LTA…
  transporteur: { type: String, trim: true },
  dateDepartPrevue:  { type: Date },
  dateArriveePrevue: { type: Date },
  departLe:  { type: Date },
  arriveLe:  { type: Date },
  statut:   { type: String, enum: Object.values(STATUTS_LOT), default: STATUTS_LOT.PREPARATION },
  notes:    { type: String },
  creePar:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  demo:     { type: Boolean, index: true },
}, { timestamps: true, toJSON: { transform: (_, o) => { delete o.__v; return o; } } });

lotSchema.pre('validate', async function (next) {
  try {
    if (!this.code) {
      const info = MODES_INFO.find(m => m.key === this.mode);
      // AIR-0001 (France → Guinée), AIR-GF-0001 (Guinée → France), AIR-BG-0001 (Belgique → Guinée), AIR-GB-0001 (Guinée → Belgique)
      const suffixe = SENS.find(s => s.key === (this.sens || 'FR-GN'))?.suffixeLot || '';
      const n = await Compteur.suivant(`lot-${this.mode}${suffixe.toLowerCase()}${this.demo ? '-demo' : ''}`);
      this.code = `${this.demo ? 'DEMO-' : ''}${info?.prefixeLot || 'LOT'}${suffixe}-${String(n).padStart(4, '0')}`;
    }
    next();
  } catch (e) { next(e); }
});

// Prévient les apps ouvertes (rafraîchissement automatique)
lotSchema.post('save', (doc) => require('../utils/temps-reel').lotChange(doc));
module.exports = mongoose.model('Lot', lotSchema);
