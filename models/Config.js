const mongoose = require('mongoose');
const { CONFIG_DEFAUT } = require('../config/constants');

// Un seul document de configuration pour toute la plateforme.
const lieuSchema = new mongoose.Schema({
  code:      { type: String, required: true, uppercase: true, trim: true },
  nom:       { type: String, required: true, trim: true },
  ville:     { type: String, trim: true },
  pays:      { type: String, trim: true },
  adresse:   { type: String, trim: true, default: '' },
  telephone: { type: String, trim: true, default: '' },
  horaires:  { type: String, trim: true, default: '' },
}, { _id: false });

const configSchema = new mongoose.Schema({
  tarifs: {
    air: { prixKg: Number, poidsMin: Number },
    mer: { prixKg: Number, poidsMin: Number },
  },
  surcharges:    { type: mongoose.Schema.Types.Mixed, default: {} },
  tauxAssurance: { type: Number },
  tauxEurGnf:    { type: Number },
  tauxMisAJourLe: { type: Date },
  magasinage: {
    joursGratuits: Number,
    fraisJourGnf:  Number,
  },
  depots:   [lieuSchema],
  guichets: [lieuSchema],
}, { timestamps: true, minimize: false });

let cache = null;
let cacheAt = 0;

configSchema.statics.get = async function () {
  if (cache && Date.now() - cacheAt < 30000) return cache;
  let config = await this.findOne().lean();
  if (!config) {
    config = (await this.create({ ...CONFIG_DEFAUT, tauxMisAJourLe: new Date() })).toObject();
  }
  cache = config;
  cacheAt = Date.now();
  return config;
};

configSchema.statics.invalider = function () { cache = null; };

configSchema.statics.lieu = async function (code) {
  const c = await this.get();
  return [...(c.depots || []), ...(c.guichets || [])].find(l => l.code === code) || null;
};

module.exports = mongoose.model('Config', configSchema);
