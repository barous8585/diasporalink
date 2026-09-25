const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { envoyerOTP } = require('../utils/sms');
const { ROLES } = require('../config/constants');
const { normTel } = require('../services/colisService');

const genererToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, {
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
});

// Numéros promus admin automatiquement (ex. ADMIN_TELEPHONES=+33600000000,+224620000000)
const telephonesAdmin = () => (process.env.ADMIN_TELEPHONES || '')
  .split(',').map(t => normTel(t.trim())).filter(Boolean);

// ── POST /api/auth/envoyer-otp ────────────
// Les comptes agents sont créés par l'admin : un inconnu devient toujours « client ».
const envoyerOtpCtrl = async (req, res) => {
  const telephone = normTel(req.body.telephone);
  const { prenom, nom } = req.body;
  let user = await User.findOne({ telephone });

  if (!user) {
    if (!prenom || !nom) {
      return res.json({ succes: true, nouvelUtilisateur: true, message: 'Prénom et nom requis pour créer le compte.' });
    }
    user = new User({ telephone, prenom, nom, role: ROLES.CLIENT });
  }
  if (!user.actif) return res.status(403).json({ succes: false, message: 'Compte désactivé.' });
  if (telephonesAdmin().includes(telephone)) user.role = ROLES.ADMIN;

  const code = user.genererOTP();
  await user.save();
  await envoyerOTP(telephone, code);

  res.json({
    succes: true,
    message: 'Code envoyé par SMS.',
    nouvelUtilisateur: false,
    ...(process.env.NODE_ENV !== 'production' && { debugCode: code }),
  });
};

// ── POST /api/auth/verifier-otp ───────────
const verifierOtpCtrl = async (req, res) => {
  const telephone = normTel(req.body.telephone);
  const user = await User.findOne({ telephone });
  if (!user) return res.status(404).json({ succes: false, message: 'Numéro inconnu.' });

  if (!user.verifierOTP(String(req.body.code))) {
    await user.save(); // enregistre le compteur d'essais
    return res.status(401).json({ succes: false, message: 'Code invalide ou expiré.' });
  }
  user.verifie = true;
  user.otp = undefined;
  await user.save();
  res.json({ succes: true, token: genererToken(user._id), utilisateur: user });
};

const moiCtrl = (req, res) => res.json({ succes: true, utilisateur: req.user });

module.exports = { envoyerOtpCtrl, verifierOtpCtrl, moiCtrl };
