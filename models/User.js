const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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
  // Connexion par mot de passe (tant qu'il n'y a pas de fournisseur SMS)
  motDePasse:   { type: String, select: false },          // empreinte bcrypt
  essaisMdp:    { type: Number, default: 0, select: false },
  bloqueJusqua: { type: Date, select: false },
  jetonVersion: { type: Number, default: 0 },             // +1 = déconnecte partout
  stripeId:    { type: String },
  googleId:    { type: String, index: { unique: true, sparse: true } }, // compte Google relié (connexion « avec Google »)
  demo:        { type: Boolean, index: true },              // personne fictive (simulation), sans mot de passe
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, obj) => {
      delete obj.otp;
      delete obj.motDePasse;
      delete obj.essaisMdp;
      delete obj.bloqueJusqua;
      delete obj.__v;
      delete obj.stripeId;
      obj.google = !!obj.googleId; // on dit seulement si Google est relié
      delete obj.googleId;
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

// ── Mot de passe ─────────────────────────
const MDP_ESSAIS_MAX = 8;
const MDP_BLOCAGE_MIN = 15;

userSchema.statics.mdpValide = (mdp) => typeof mdp === 'string' && mdp.length >= 8 && mdp.length <= 100;

userSchema.methods.definirMotDePasse = async function (mdp) {
  if (!userSchema.statics.mdpValide(mdp)) { const e = new Error('Mot de passe : 8 caractères minimum.'); e.status = 400; throw e; }
  this.motDePasse = await bcrypt.hash(mdp, 10);
  this.essaisMdp = 0;
  this.bloqueJusqua = undefined;
  this.jetonVersion = (this.jetonVersion || 0) + 1; // les anciennes sessions sont fermées
};

// Renvoie 'ok', 'faux' ou 'bloque' (et met à jour le compteur ; sauvegarder ensuite)
userSchema.methods.verifierMotDePasse = async function (mdp) {
  if (this.bloqueJusqua && this.bloqueJusqua > new Date()) return 'bloque';
  if (!this.motDePasse || !(await bcrypt.compare(String(mdp || ''), this.motDePasse))) {
    this.essaisMdp = (this.essaisMdp || 0) + 1;
    if (this.essaisMdp >= MDP_ESSAIS_MAX) {
      this.bloqueJusqua = new Date(Date.now() + MDP_BLOCAGE_MIN * 60000);
      this.essaisMdp = 0;
    }
    return 'faux';
  }
  this.essaisMdp = 0;
  this.bloqueJusqua = undefined;
  return 'ok';
};

// OTP 6 chiffres, 10 minutes, 5 essais max (connexion par SMS, si un fournisseur est branché)
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
