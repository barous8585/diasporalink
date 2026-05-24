const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  phone:        { type: String, required: true, unique: true, trim: true },
  firstName:    { type: String, required: true, trim: true },
  lastName:     { type: String, required: true, trim: true },
  email:        { type: String, trim: true, lowercase: true },
  address:      { type: String, trim: true },
  city:         { type: String, trim: true },
  country:      { type: String, default: 'FR' },
  rating:       { type: Number, default: 5.0, min: 1, max: 5 },
  pushTokens:   [{ type: String }],
  isVerified:   { type: Boolean, default: false },
  isActive:     { type: Boolean, default: true },
  otp:          { code: String, expiresAt: Date },
  stripeCustomerId: { type: String }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, obj) => { delete obj.otp; delete obj.__v; return obj; }
  }
});

userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual('initials').get(function () {
  return `${this.firstName[0]}${this.lastName[0]}`.toUpperCase();
});

userSchema.methods.generateOTP = function () {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = { code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
  return code;
};

userSchema.methods.verifyOTP = function (code) {
  if (!this.otp || !this.otp.code) return false;
  if (new Date() > this.otp.expiresAt) return false;
  return this.otp.code === code;
};

module.exports = mongoose.model('User', userSchema);
