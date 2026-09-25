const mongoose = require('mongoose');
const Compteur = require('./Compteur');
const { MODES, MODES_INFO, STATUTS_LOT } = require('../config/constants');

// Un lot = un vol ou un conteneur. Les colis y sont affectés au chargement.
const lotSchema = new mongoose.Schema({
  code:     { type: String, unique: true, index: true },   // AIR-0001, MER-0001
  mode:     { type: String, enum: Object.values(MODES), required: true },
  depot:    { type: String, default: 'PARIS' },
  destination: { type: String, default: 'Conakry' },
  reference: { type: String, trim: true },   // n° de vol, n° de conteneur, LTA…
  transporteur: { type: String, trim: true },
  dateDepartPrevue:  { type: Date },
  dateArriveePrevue: { type: Date },
  departLe:  { type: Date },
  arriveLe:  { type: Date },
  statut:   { type: String, enum: Object.values(STATUTS_LOT), default: STATUTS_LOT.PREPARATION },
  notes:    { type: String },
  creePar:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { transform: (_, o) => { delete o.__v; return o; } } });

lotSchema.pre('validate', async function (next) {
  try {
    if (!this.code) {
      const info = MODES_INFO.find(m => m.key === this.mode);
      const n = await Compteur.suivant(`lot-${this.mode}`);
      this.code = `${info?.prefixeLot || 'LOT'}-${String(n).padStart(4, '0')}`;
    }
    next();
  } catch (e) { next(e); }
});

module.exports = mongoose.model('Lot', lotSchema);
