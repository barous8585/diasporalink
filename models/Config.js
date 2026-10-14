const mongoose = require('mongoose');
const { CONFIG_DEFAUT, PAYS } = require('../config/constants');

// Une agence TMS (France ou Guinée)
const agenceSchema = new mongoose.Schema({
  code:       { type: String, required: true, uppercase: true, trim: true },
  nom:        { type: String, required: true, trim: true },
  pays:       { type: String, enum: Object.keys(PAYS), required: true },
  ville:      { type: String, trim: true, default: '' },
  commune:    { type: String, trim: true, default: '' },
  adresse:    { type: String, trim: true, default: '' },
  telephone:  { type: String, trim: true, default: '' },
  horaires:   { type: String, trim: true, default: '' },
  plateforme: { type: Boolean, default: false }, // les lots arrivent ici dans ce pays
  actif:      { type: Boolean, default: true },
}, { _id: false });

// Un seul document de configuration pour toute la plateforme.
const configSchema = new mongoose.Schema({
  // { 'FR-GN': { devise, air: { prixKg, poidsMin }, mer: {…} }, 'GN-FR': {…} }
  tarifs:        { type: mongoose.Schema.Types.Mixed, default: {} },
  surcharges:    { type: mongoose.Schema.Types.Mixed, default: {} },
  tauxAssurance: { type: Number },
  tauxEurGnf:    { type: Number },
  tauxMisAJourLe: { type: Date },
  magasinage: {
    joursGratuits: Number,
    fraisJourGnf:  Number,
    fraisJourEur:  Number,
  },
  agences: [agenceSchema],
}, { timestamps: true, minimize: false });

let cache = null;
let cacheAt = 0;

configSchema.statics.get = async function () {
  if (cache && Date.now() - cacheAt < 30000) return cache;
  let config = await this.findOne().lean();
  if (!config) {
    config = (await this.create({ ...CONFIG_DEFAUT, tauxMisAJourLe: new Date() })).toObject();
  }
  // Complète une config créée avant l'arrivée des agences / des deux sens
  if (!config.agences?.length) config.agences = CONFIG_DEFAUT.agences;
  if (!config.tarifs?.['FR-GN']) config.tarifs = CONFIG_DEFAUT.tarifs;
  if (config.magasinage && config.magasinage.fraisJourEur === undefined) config.magasinage.fraisJourEur = CONFIG_DEFAUT.magasinage.fraisJourEur;
  cache = config;
  cacheAt = Date.now();
  return config;
};

configSchema.statics.invalider = function () { cache = null; };

configSchema.statics.lieu = async function (code) {
  const c = await this.get();
  return (c.agences || []).find(a => a.code === code) || null;
};

// Plateforme d'arrivée d'un pays (première agence marquée « plateforme »)
configSchema.statics.plateforme = async function (pays) {
  const c = await this.get();
  const liste = (c.agences || []).filter(a => a.pays === pays && a.actif !== false);
  return liste.find(a => a.plateforme) || liste[0] || null;
};

module.exports = mongoose.model('Config', configSchema);
