const router = require('express').Router();
const { body } = require('express-validator');
const User = require('../models/User');
const Config = require('../models/Config');
const { auth, role } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { ROLES } = require('../config/constants');
const { normTel } = require('../services/colisService');

router.get('/moi', auth, (req, res) => res.json({ succes: true, utilisateur: req.user }));

router.patch('/moi', auth, [
  body('prenom').optional().trim().notEmpty(),
  body('nom').optional().trim().notEmpty(),
  body('email').optional({ values: 'falsy' }).isEmail(),
  body('langue').optional().isIn(['fr', 'ff', 'sus', 'man']),
], valider, ah(async (req, res) => {
  ['prenom', 'nom', 'email', 'langue'].forEach(k => { if (req.body[k] !== undefined) req.user[k] = req.body[k]; });
  await req.user.save();
  res.json({ succes: true, utilisateur: req.user });
}));

// ── Équipe (admin) ─────────────────────────
router.get('/equipe', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  const equipe = await User.find({ role: { $in: [ROLES.AGENT, ROLES.LIVREUR, ROLES.ADMIN] } }).sort({ prenom: 1 });
  res.json({ succes: true, equipe });
}));

router.post('/equipe', auth, role(ROLES.ADMIN), [
  body('telephone').trim().notEmpty().withMessage('Téléphone requis'),
  body('prenom').trim().notEmpty().withMessage('Prénom requis'),
  body('nom').trim().notEmpty().withMessage('Nom requis'),
  body('role').isIn([ROLES.AGENT, ROLES.LIVREUR, ROLES.ADMIN]).withMessage('Rôle invalide'),
  body('lieu').trim().notEmpty().withMessage('Lieu de travail requis'),
  body('motDePasse').optional({ values: 'falsy' }).isLength({ min: 8, max: 100 }).withMessage('Mot de passe : 8 caractères minimum'),
], valider, ah(async (req, res) => {
  const lieu = await Config.lieu(req.body.lieu);
  if (!lieu) return res.status(400).json({ succes: false, message: 'Lieu inconnu.' });
  const telephone = normTel(req.body.telephone);
  let user = await User.findOne({ telephone });
  if (user) {
    Object.assign(user, { prenom: req.body.prenom, nom: req.body.nom, role: req.body.role, lieu: lieu.code, actif: true });
  } else {
    if (!req.body.motDePasse) return res.status(400).json({ succes: false, message: 'Choisissez un mot de passe pour ce compte.' });
    user = new User({ telephone, prenom: req.body.prenom, nom: req.body.nom, role: req.body.role, lieu: lieu.code });
  }
  user.verifie = true; // numéro vérifié par l'admin
  if (req.body.motDePasse) await user.definirMotDePasse(req.body.motDePasse);
  await user.save();
  res.status(201).json({ succes: true, utilisateur: user });
}));

router.patch('/equipe/:id', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ succes: false, message: 'Introuvable.' });
  if (String(user._id) === String(req.user._id) && req.body.actif === false) {
    return res.status(400).json({ succes: false, message: 'Vous ne pouvez pas désactiver votre propre compte.' });
  }
  if (req.body.lieu) {
    if (!(await Config.lieu(req.body.lieu))) return res.status(400).json({ succes: false, message: 'Lieu inconnu.' });
    user.lieu = req.body.lieu;
  }
  if (req.body.role && [ROLES.AGENT, ROLES.LIVREUR, ROLES.ADMIN, ROLES.CLIENT].includes(req.body.role)) user.role = req.body.role;
  if (typeof req.body.actif === 'boolean') {
    user.actif = req.body.actif;
    if (!user.actif) user.jetonVersion = (user.jetonVersion || 0) + 1; // coupe ses sessions ouvertes
  }
  if (req.body.motDePasse) {
    if (!User.mdpValide(req.body.motDePasse)) return res.status(400).json({ succes: false, message: 'Mot de passe : 8 caractères minimum.' });
    await user.definirMotDePasse(req.body.motDePasse);
  }
  await user.save();
  res.json({ succes: true, utilisateur: user });
}));

// ── POST /api/utilisateurs/client-mot-de-passe ── admin : (ré)initialiser le mot de passe
// d'un client venu à l'agence avec sa pièce d'identité. Marque aussi son numéro comme vérifié.
router.post('/client-mot-de-passe', auth, role(ROLES.ADMIN), [
  body('telephone').trim().notEmpty().withMessage('Téléphone requis'),
  body('motDePasse').isLength({ min: 8, max: 100 }).withMessage('Mot de passe : 8 caractères minimum'),
], valider, ah(async (req, res) => {
  const telephone = normTel(req.body.telephone);
  let user = await User.findOne({ telephone });
  if (!user) {
    if (!req.body.prenom || !req.body.nom) return res.status(404).json({ succes: false, message: 'Aucun compte avec ce numéro. Indiquez prénom et nom pour le créer.' });
    user = new User({ telephone, prenom: req.body.prenom, nom: req.body.nom, role: ROLES.CLIENT });
  }
  user.verifie = true;
  await user.definirMotDePasse(req.body.motDePasse);
  await user.save();
  res.json({ succes: true, utilisateur: user, message: 'Mot de passe défini. Le client peut se connecter.' });
}));

module.exports = router;
