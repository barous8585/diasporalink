const router = require('express').Router();
const { body } = require('express-validator');
const PushAbonnement = require('../models/PushAbonnement');
const { auth } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const push = require('../utils/push');

// ── GET /api/push/cle ── clé publique (pour s'abonner)
router.get('/cle', (req, res) => res.json({ succes: true, actif: push.actif(), cle: push.PUBLIQUE }));

// ── POST /api/push/abonner ── { abonnement: { endpoint, keys }, app }
router.post('/abonner', auth, [
  body('abonnement.endpoint').isURL({ require_tld: false }).withMessage('Abonnement invalide'),
  body('abonnement.keys.p256dh').isString().notEmpty(),
  body('abonnement.keys.auth').isString().notEmpty(),
  body('app').isIn(['client', 'agent', 'admin']),
], valider, ah(async (req, res) => {
  const u = req.user;
  const app = req.body.app;
  if (app === 'admin' && u.role !== 'admin') return res.status(403).json({ succes: false, message: 'Accès refusé.' });
  if (app === 'agent' && !['agent', 'livreur', 'admin'].includes(u.role)) return res.status(403).json({ succes: false, message: 'Accès refusé.' });
  const a = req.body.abonnement;
  // Seulement les services de notification des navigateurs (sinon le serveur enverrait des
  // requêtes vers une adresse choisie par n'importe qui)
  let hote = '';
  try { const u = new URL(a.endpoint); hote = u.protocol === 'https:' ? u.hostname : ''; } catch {}
  const SERVICES_PUSH = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com|push\.api\.chrome\.google\.com)$/i;
  if (!SERVICES_PUSH.test(hote) && process.env.NODE_ENV === 'production') return res.status(400).json({ succes: false, message: 'Abonnement invalide.' });
  await PushAbonnement.findOneAndUpdate({ endpoint: a.endpoint }, {
    endpoint: a.endpoint, cles: { p256dh: a.keys.p256dh, auth: a.keys.auth }, app,
    user: u._id, telephone: u.telephone, role: u.role, lieu: u.lieu, appareil: String(req.headers['user-agent'] || '').slice(0, 160), echecs: 0,
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  res.json({ succes: true });
}));

// ── POST /api/push/desabonner ── { endpoint }
router.post('/desabonner', auth, ah(async (req, res) => {
  await PushAbonnement.deleteOne({ endpoint: String(req.body.endpoint || ''), user: req.user._id });
  res.json({ succes: true });
}));

// ── POST /api/push/test ── notification d'essai sur mes appareils
router.post('/test', auth, ah(async (req, res) => {
  const n = await push.aLUtilisateur(req.user._id, { titre: 'TMS', corps: 'Les notifications marchent sur cet appareil.', chemin: '/' });
  res.json({ succes: true, envoyees: n, actif: push.actif() });
}));

module.exports = router;
