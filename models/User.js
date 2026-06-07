const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema({
  telephone:   { type: String, required: true, unique: true, trim: true },
  prenom:      { type: String, required: true, trim: true },
  nom:         { type: String, required: true, trim: true },
  email:       { type: String, trim: true, lowercase: true },
  adresse:     { type: String, trim: true },
  ville:       { type: String, trim: true },
  codePostal:  { type: String, trim: true },
  pays:        { type: String, default: 'FR' },
  role:        { type: String, enum: Object.values(ROLES), default: ROLES.CLIENT },
  actif:       { type: Boolean, default: true },
  verifie:     { type: Boolean, default: false },
  otp: {
    code:      String,
    expireAt:  Date,
  },
  stripeId:    { type: String },
  note:        { type: Number, default: 5.0, min: 1, max: 5 },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, obj) => {
      delete obj.otp;
      delete obj.__v;
      delete obj.stripeId;
      return obj;
    }
  }
});

// Nom complet
userSchema.virtual('nomComplet').get(function () {
  const p = this.prenom || '';
  const n = this.nom || '';
  return `${p} ${n}`.trim();
});

// Initiales
userSchema.virtual('initiales').get(function () {
  const p = this.prenom?.[0] || '?';
  const n = this.nom?.[0] || '?';
  return `${p}${n}`.toUpperCase();
});

// Générer OTP 6 chiffres valable 10 minutes
userSchema.methods.genererOTP = function () {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = {
    code,
    expireAt: new Date(Date.now() + 10 * 60 * 1000),
  };
  return code;
};

// Vérifier OTP
userSchema.methods.verifierOTP = function (code) {
  if (!this.otp?.code) return false;
  if (new Date() > this.otp.expireAt) return false;
  return this.otp.code === code;
};

module.exports = mongoose.model('User', userSchema);
