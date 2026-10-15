// ─────────────────────────────────────────────────────────────
//  Routes livreur : courses à domicile (ramassages et livraisons)
//  Le livreur voit les courses de son agence, en prend une, la fait.
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body } = require('express-validator');
const Config = require('../models/Config');
const { auth, role } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { ROLES } = require('../config/constants');
const svc = require('../services/colisService');
const dom = require('../services/domicileService');

router.use(auth, role(ROLES.LIVREUR, ROLES.AGENT, ROLES.ADMIN));
// Un livreur n'agit que sur les courses de son agence
router.use(ah(async (req, res, next) => {
  const numero = String(req.body?.numero || '').trim().toUpperCase();
  if (req.method !== 'POST' || !numero) return next();
  const colis = await require('../models/Colis').findOne({ numeroSuivi: numero }).select('depot guichet sens');
  if (colis && !(await require('../services/colisService').agentVoitColis(colis, req.user))) return res.status(404).json({ succes: false, message: 'Cette course ne concerne pas votre agence.' });
  next();
}));

const typeValide = body('type').isIn(dom.COURSES).withMessage('Type de course inconnu');

// ── GET /api/livreur/courses ── courses ouvertes de mon agence (+ les miennes en tête)
router.get('/courses', ah(async (req, res) => {
  const lieu = await Config.lieu(req.user.lieu);
  const courses = await dom.coursesOuvertes({ agence: req.user.role === ROLES.ADMIN && !lieu ? undefined : req.user.lieu });
  res.json({ succes: true, livreur: req.user, lieu, courses, majLe: new Date() });
}));

// ── POST /api/livreur/prendre ── { numero, type } : je m'en charge
router.post('/prendre', [body('numero').trim().notEmpty(), typeValide], valider, ah(async (req, res) => {
  const colis = await dom.assigner(req.body.numero, req.body.type, req.user);
  res.json({ succes: true, course: await dom.vueCourse(colis, req.body.type, await Config.get()) });
}));

// ── POST /api/livreur/lacher ── { numero, type } : je ne peux pas la faire
router.post('/lacher', [body('numero').trim().notEmpty(), typeValide], valider, ah(async (req, res) => {
  const colis = await dom.assigner(req.body.numero, req.body.type, null, { par: req.user });
  res.json({ succes: true, course: await dom.vueCourse(colis, req.body.type, await Config.get()) });
}));

// ── POST /api/livreur/ramasse ── { numero, position, opId }
router.post('/ramasse', [body('numero').trim().notEmpty()], valider, ah(async (req, res) => {
  const r = await svc.avecOperation(req.body.opId, req.user, 'ramasse', async () => {
    const { colis } = await dom.ramasser(req.body.numero, req.user, req.body);
    return { course: await dom.vueCourse(colis, 'ramassage', await Config.get()) };
  });
  res.json({ succes: true, ...r });
}));

// ── POST /api/livreur/depart ── { numero } : je pars livrer (colis sorti de l'agence)
router.post('/depart', [body('numero').trim().notEmpty()], valider, ah(async (req, res) => {
  const { colis } = await dom.partirLivrer(req.body.numero, req.user);
  res.json({ succes: true, course: await dom.vueCourse(colis, 'livraison', await Config.get()) });
}));

// ── POST /api/livreur/livre ── { numero, code, signature, paiement, position, opId }
router.post('/livre', [
  body('numero').trim().notEmpty(),
  body('code').trim().isLength({ min: 4, max: 4 }).withMessage('Code à 4 chiffres'),
], valider, ah(async (req, res) => {
  const { avantSauvegarde, ...data } = req.body; // jamais de fonction venue du client
  const r = await svc.avecOperation(req.body.opId, req.user, 'livre', () => dom.livrer(req.user, data));
  res.json({ succes: true, ...r });
}));

// ── POST /api/livreur/echec ── { numero, type, motif }
router.post('/echec', [body('numero').trim().notEmpty(), typeValide, body('motif').trim().notEmpty().withMessage('Dites ce qui s\'est passé')], valider, ah(async (req, res) => {
  const colis = await dom.echec(req.body.numero, req.body.type, req.user, req.body.motif);
  res.json({ succes: true, course: await dom.vueCourse(colis, req.body.type, await Config.get()) });
}));

module.exports = router;
