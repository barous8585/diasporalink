const mongoose = require('mongoose');
const crypto = require('crypto');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema({
  telephone:   { type: String, required: true, unique: true, trim: true },
  prenom:      { type: String, required: true, trim: true },
  nom:         { type: String, required: true, trim: true },
  email:       { type: String, trim: true, lowercase: true },
  pays:        { type: String, default: 'FR' },
  langue:      { type: String, default: 'fr' },
  role:        { type: String, enum: Object.values(ROLES), default: ROLES.CLIENT },
  lieu:        { type: String },   // agent : code du dépôt ou guichet où il travaille
  actif:       { type: Boolean, default: true },
  verifie:     { type: Boolean, default: false },
  otp: {
    code:      String,
    expireAt:  Date,
    essais:    { type: Number, default: 0 },
  },
  stripeId:    { type: String },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, obj) => {
      delete obj.otp;
      delete obj.__v;
      delete obj.stripeId;
      return obj;
    },
  },
});

userSchema.virtual('nomComplet').get(function () {
  return `${this.prenom || ''} ${this.nom || ''}`.trim();
});

userSchema.virtual('initiales').get(function () {
  return `${this.prenom?.[0] || '?'}${this.nom?.[0] || '?'}`.toUpperCase();
});

// OTP 6 chiffres, 10 minutes, 5 essais max
userSchema.methods.genererOTP = function () {
  const code = String(crypto.randomInt(100000, 1000000));
  this.otp = { code, expireAt: new Date(Date.now() + 10 * 60 * 1000), essais: 0 };
  return code;
};

userSchema.methods.verifierOTP = function (code) {
  if (!this.otp?.code) return false;
  if (new Date() > this.otp.expireAt) return false;
  if ((this.otp.essais || 0) >= 5) return false;
  if (this.otp.code !== code) {
    this.otp.essais = (this.otp.essais || 0) + 1;
    return false;
  }
  return true;
};

module.exports = mongoose.model('User', userSchema);
