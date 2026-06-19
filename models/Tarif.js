const mongoose = require('mongoose');

const tarifSchema = new mongoose.Schema({
  prixKg: {
    type: Map,
    of: Number,
    default: {},
  },
  fraisPickup:   { type: Number, default: 5.0 },
  tauxAssurance: { type: Number, default: 0.023 },
  poidsMin:      { type: Number, default: 0.5 },
}, { timestamps: true });

// Un seul document de config dans toute la base
tarifSchema.statics.getConfig = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({
      prixKg: new Map([
        ['SN', 7.5],
        ['CI', 8.0],
        ['CM', 7.8],
        ['GN', 8.5],
        ['ML', 8.2],
        ['BF', 8.3],
        ['CD', 9.0],
        ['MR', 8.6],
        ['TG', 8.1],
        ['BJ', 8.0],
        ['SL', 8.8],
        ['GH', 8.4],
      ]),
      fraisPickup:   5.0,
      tauxAssurance: 0.023,
      poidsMin:      0.5,
    });
  }
  return config;
};

module.exports = mongoose.model('Tarif', tarifSchema);
