const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { envoyerOTP } = require('../utils/sms');
const { ROLES } = require('../config/constants');

// Générer un JWT
const genererToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// ── POST /api/auth/envoyer-otp ────────────
const envoyerOtpCtrl = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ succes: false, erreurs: errors.array() });
  }
  try {
    const { telephone, prenom, nom, interface: interfaceOrigine } = req.body;
    let user = await User.findOne({ telephone });

    if (!user) {
      if (!prenom || !nom) {
        return res.status(200).json({
          succes: true,
          message: "Prénom et nom requis pour l'inscription.",
          nouvelUtilisateur: true,
        });
      }

      // Si la requête vient de l'app livreur, on assigne directement le rôle livreur
      const role = interfaceOrigine === 'livreur' ? ROLES.LIVREUR : ROLES.CLIENT;

      user = new User({ telephone, prenom, nom, role });
    }

    const code = user.genererOTP();
    await user.save();
    await envoyerOTP(telephone, code);

    res.json({
      succes: true,
      message: 'Code envoyé par SMS.',
      nouvelUtilisateur: !user.verifie,
      // Code visible en développement uniquement
      ...(process.env.NODE_ENV !== 'production' && { debugCode: code }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── POST /api/auth/verifier-otp ───────────
const verifierOtpCtrl = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ succes: false, erreurs: errors.array() });
  }
  try {
    const { telephone, code } = req.body;
    const user = await User.findOne({ telephone });
    if (!user) {
      return res.status(404).json({ succes: false, message: 'Utilisateur introuvable.' });
    }
    if (!user.verifierOTP(code)) {
      return res.status(401).json({ succes: false, message: 'Code invalide ou expiré.' });
    }
    user.verifie = true;
    user.otp = undefined;
    await user.save();
    const token = genererToken(user._id);
    res.json({
      succes: true,
      token,
      utilisateur: user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/auth/moi ─────────────────────
const moiCtrl = async (req, res) => {
  res.json({ succes: true, utilisateur: req.user });
};

module.exports = { envoyerOtpCtrl, verifierOtpCtrl, moiCtrl };
