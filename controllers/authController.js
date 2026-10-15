const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { envoyerOTP, smsDisponible } = require('../utils/sms');
const { ROLES } = require('../config/constants');
const { normTel } = require('../services/colisService');

// Mode de connexion : 'motdepasse' (par défaut) ou 'sms' (code par SMS, quand un fournisseur est branché)
const modeAuth = () => (process.env.AUTH_MODE === 'sms' && smsDisponible() ? 'sms' : 'motdepasse');

const genererToken = (user) => jwt.sign(
  { id: user._id, v: user.jetonVersion || 0 },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
);

// Numéros promus admin (ex. ADMIN_TELEPHONES=+33600000000,+224620000000)
const telephonesAdmin = () => (process.env.ADMIN_TELEPHONES || '')
  .split(',').map(t => normTel(t.trim())).filter(Boolean);

const egalSur = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const MSG_IDENTIFIANTS = 'Numéro ou mot de passe incorrect.';

// ── POST /api/auth/connexion ── { telephone, motDePasse }
const connexionCtrl = async (req, res) => {
  const telephone = normTel(req.body.telephone);
  const motDePasse = String(req.body.motDePasse || '');
  let user = await User.findOne({ telephone }).select('+motDePasse +essaisMdp +bloqueJusqua');

  // Premier accès de l'administrateur : numéro listé dans ADMIN_TELEPHONES
  // + mot de passe initial ADMIN_MOT_DE_PASSE (à changer ensuite dans l'app).
  const initial = process.env.ADMIN_MOT_DE_PASSE;
  if (initial && telephonesAdmin().includes(telephone) && (!user || !user.motDePasse) && egalSur(motDePasse, initial)) {
    if (!user) user = new User({ telephone, prenom: 'Admin', nom: 'TMS' });
    user.role = ROLES.ADMIN;
    user.verifie = true;
    user.actif = true;
    await user.definirMotDePasse(motDePasse);
    await user.save();
    return res.json({ succes: true, token: genererToken(user), utilisateur: user, doitChangerMotDePasse: true });
  }

  if (!user || !user.motDePasse) {
    // même réponse que pour un mauvais mot de passe : on ne révèle pas quels numéros existent
    return res.status(401).json({ succes: false, message: MSG_IDENTIFIANTS });
  }
  if (!user.actif) return res.status(403).json({ succes: false, message: 'Compte désactivé.' });

  const verdict = await user.verifierMotDePasse(motDePasse);
  await user.save();
  if (verdict === 'bloque') return res.status(423).json({ succes: false, message: 'Trop d\'essais. Réessayez dans 15 minutes.' });
  if (verdict !== 'ok') return res.status(401).json({ succes: false, message: MSG_IDENTIFIANTS });

  res.json({ succes: true, token: genererToken(user), utilisateur: user });
};

// ── POST /api/auth/inscription ── clients uniquement { telephone, prenom, nom, motDePasse }
const inscriptionCtrl = async (req, res) => {
  const telephone = normTel(req.body.telephone);
  const { prenom, nom, motDePasse } = req.body;
  if (!User.mdpValide(motDePasse)) return res.status(400).json({ succes: false, message: 'Mot de passe : 8 caractères minimum.' });
  // Un numéro administrateur ne s'inscrit jamais comme client (il deviendrait admin)
  if (telephonesAdmin().includes(telephone)) return res.status(403).json({ succes: false, message: 'Ce numéro ne peut pas créer de compte client.' });
  const existant = await User.findOne({ telephone });
  if (existant) {
    return res.status(409).json({ succes: false, message: 'Un compte existe déjà avec ce numéro. Connectez-vous, ou demandez à l\'agence de réinitialiser votre mot de passe.' });
  }
  // Sans SMS, le numéro n'est pas vérifié : le compte voit ses propres envois,
  // mais pas les codes de retrait des colis adressés à ce numéro.
  const user = new User({ telephone, prenom, nom, role: ROLES.CLIENT, verifie: false });
  await user.definirMotDePasse(motDePasse);
  await user.save();
  res.status(201).json({ succes: true, token: genererToken(user), utilisateur: user });
};

// ── PATCH /api/auth/mot-de-passe ── { actuel, nouveau }
const changerMotDePasseCtrl = async (req, res) => {
  const user = await User.findById(req.user._id).select('+motDePasse +essaisMdp +bloqueJusqua');
  const verdict = await user.verifierMotDePasse(req.body.actuel);
  if (verdict !== 'ok') { await user.save(); return res.status(401).json({ succes: false, message: verdict === 'bloque' ? 'Trop d\'essais. Réessayez dans 15 minutes.' : 'Mot de passe actuel incorrect.' }); }
  if (!User.mdpValide(req.body.nouveau)) return res.status(400).json({ succes: false, message: 'Nouveau mot de passe : 8 caractères minimum.' });
  await user.definirMotDePasse(req.body.nouveau);
  await user.save();
  res.json({ succes: true, token: genererToken(user), message: 'Mot de passe modifié.' });
};

// ── POST /api/auth/envoyer-otp ── (mode SMS seulement)
const envoyerOtpCtrl = async (req, res) => {
  if (modeAuth() !== 'sms') return res.status(410).json({ succes: false, message: 'Connexion par SMS indisponible. Utilisez votre mot de passe.' });
  const telephone = normTel(req.body.telephone);
  const { prenom, nom } = req.body;
  let user = await User.findOne({ telephone });
  if (!user) {
    if (!prenom || !nom) return res.json({ succes: true, nouvelUtilisateur: true, message: 'Prénom et nom requis pour créer le compte.' });
    user = new User({ telephone, prenom, nom, role: ROLES.CLIENT });
  }
  if (!user.actif) return res.status(403).json({ succes: false, message: 'Compte désactivé.' });
  if (telephonesAdmin().includes(telephone)) user.role = ROLES.ADMIN;
  const code = user.genererOTP();
  await user.save();
  await envoyerOTP(telephone, code);
  res.json({
    succes: true, message: 'Code envoyé par SMS.', nouvelUtilisateur: false,
    ...(process.env.NODE_ENV !== 'production' && { debugCode: code }),
  });
};

// ── POST /api/auth/verifier-otp ── (mode SMS seulement)
const verifierOtpCtrl = async (req, res) => {
  if (modeAuth() !== 'sms') return res.status(410).json({ succes: false, message: 'Connexion par SMS indisponible. Utilisez votre mot de passe.' });
  const telephone = normTel(req.body.telephone);
  const user = await User.findOne({ telephone });
  if (!user) return res.status(404).json({ succes: false, message: 'Numéro inconnu.' });
  if (!user.verifierOTP(String(req.body.code))) {
    await user.save();
    return res.status(401).json({ succes: false, message: 'Code invalide ou expiré.' });
  }
  user.verifie = true;
  user.otp = undefined;
  await user.save();
  res.json({ succes: true, token: genererToken(user), utilisateur: user });
};

const moiCtrl = (req, res) => res.json({ succes: true, utilisateur: req.user });

module.exports = { connexionCtrl, inscriptionCtrl, changerMotDePasseCtrl, envoyerOtpCtrl, verifierOtpCtrl, moiCtrl, modeAuth, genererToken };
