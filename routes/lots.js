// ─────────────────────────────────────────────────────────────
//  Lots (vols / conteneurs) et manifestes — admin
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body } = require('express-validator');
const Lot = require('../models/Lot');
const Colis = require('../models/Colis');
const Config = require('../models/Config');
const { auth, role } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { calculerSolde } = require('../utils/tarif');
const { ROLES, MODES, STATUTS, STATUTS_LOT, SENS } = require('../config/constants');
const { changerStatutMasse } = require('../services/colisService');

router.use(auth);

// Liste (agents : lecture, pour choisir le lot à charger / réceptionner)
// Un agent ne voit que les lots qui partent de son agence ou y arrivent
const filtreLotsAgent = (u) => (u.role === ROLES.ADMIN ? {} : { $or: [{ depot: u.lieu || '_' }, { destination: u.lieu || '_' }] });
router.get('/', role(ROLES.AGENT, ROLES.ADMIN), ah(async (req, res) => {
  const filtre = { ...(req.query.statut ? { statut: String(req.query.statut) } : {}), ...filtreLotsAgent(req.user) };
  const lots = await Lot.find(filtre).sort({ createdAt: -1 }).limit(100).lean();
  // Compte des colis par lot
  const comptes = await Colis.aggregate([
    { $match: { lotCode: { $in: lots.map(l => l.code) } } },
    { $group: { _id: '$lotCode', nb: { $sum: 1 }, poids: { $sum: '$poidsReel' } } },
  ]);
  const parCode = Object.fromEntries(comptes.map(c => [c._id, c]));
  res.json({ succes: true, lots: lots.map(l => ({ ...l, nbColis: parCode[l.code]?.nb || 0, poidsTotal: Math.round((parCode[l.code]?.poids || 0) * 10) / 10 })) });
}));

// Détail + manifeste
router.get('/:code', role(ROLES.AGENT, ROLES.ADMIN), ah(async (req, res) => {
  const lot = await Lot.findOne({ code: req.params.code.toUpperCase(), ...filtreLotsAgent(req.user) }).lean();
  if (!lot) return res.status(404).json({ succes: false, message: 'Lot introuvable.' });
  const config = await Config.get();
  const colis = await Colis.find({ lotCode: lot.code }).sort({ numeroSuivi: 1 });
  const manifeste = colis.map(c => {
    const s = calculerSolde(c, config);
    return {
      numeroSuivi: c.numeroSuivi, statut: c.statut, expediteur: c.expediteur, destinataire: c.destinataire,
      guichet: c.guichet, poids: c.poidsReel, nbCartons: c.nbCartons, typeColis: c.typeColis,
      description: c.description, valeurDeclaree: c.valeurDeclaree, soldeGnf: s.soldeGnf, soldeEur: s.soldeEur,
    };
  });
  const scannesArrivee = colis.filter(c => [STATUTS.ARRIVE, STATUTS.PRET, STATUTS.REMIS].includes(c.statut)).length;
  res.json({ succes: true, lot, manifeste, stats: { nb: colis.length, scannesArrivee, poids: Math.round(colis.reduce((s, c) => s + (c.poidsReel || 0), 0) * 10) / 10 } });
}));

// Créer un lot
router.post('/', role(ROLES.ADMIN), [
  body('mode').isIn(Object.values(MODES)).withMessage('Mode invalide'),
  body('sens').optional().isIn(SENS.map(s => s.key)).withMessage('Sens invalide'),
  body('dateDepartPrevue').optional({ values: 'falsy' }).isISO8601(),
  body('dateArriveePrevue').optional({ values: 'falsy' }).isISO8601(),
], valider, ah(async (req, res) => {
  const { mode, reference, transporteur, dateDepartPrevue, dateArriveePrevue, notes } = req.body;
  const sens = SENS.find(s => s.key === (req.body.sens || 'FR-GN'));
  const [depart, arrivee] = await Promise.all([Config.plateforme(sens.depart), Config.plateforme(sens.arrivee)]);
  const lot = await Lot.create({
    sens: sens.key, depot: depart?.code, destination: arrivee?.code,
    mode, reference, transporteur, notes, creePar: req.user._id,
    dateDepartPrevue: dateDepartPrevue || undefined, dateArriveePrevue: dateArriveePrevue || undefined,
  });
  res.status(201).json({ succes: true, lot });
}));

// Modifier les infos d'un lot
router.patch('/:code', role(ROLES.ADMIN), ah(async (req, res) => {
  const lot = await Lot.findOne({ code: req.params.code.toUpperCase() });
  if (!lot) return res.status(404).json({ succes: false, message: 'Lot introuvable.' });
  ['reference', 'transporteur', 'notes', 'dateDepartPrevue', 'dateArriveePrevue'].forEach(k => {
    if (req.body[k] !== undefined) lot[k] = req.body[k] || undefined;
  });
  await lot.save();
  res.json({ succes: true, lot });
}));

// Changer le statut du lot → met à jour tous ses colis d'un coup
const TRANSITIONS_LOT = {
  [STATUTS_LOT.PARTI]:   { depuis: [STATUTS_LOT.PREPARATION], colisDepuis: [STATUTS.CHARGE], colisVers: STATUTS.EN_TRANSIT, date: 'departLe' },
  [STATUTS_LOT.ARRIVE]:  { depuis: [STATUTS_LOT.PARTI], colisDepuis: [STATUTS.EN_TRANSIT], colisVers: STATUTS.ARRIVE, date: 'arriveLe' },
  [STATUTS_LOT.CLOTURE]: { depuis: [STATUTS_LOT.ARRIVE], colisDepuis: [], colisVers: null },
  // Lot marqué « parti » par erreur : on revient en préparation (colis en route → chargés)
  [STATUTS_LOT.PREPARATION]: { depuis: [STATUTS_LOT.PARTI], colisDepuis: [STATUTS.EN_TRANSIT], colisVers: STATUTS.CHARGE, date: null, annulation: true },
};

router.post('/:code/statut', role(ROLES.ADMIN), [
  body('statut').isIn(Object.keys(TRANSITIONS_LOT)).withMessage('Statut invalide'),
], valider, ah(async (req, res) => {
  const lot = await Lot.findOne({ code: req.params.code.toUpperCase() });
  if (!lot) return res.status(404).json({ succes: false, message: 'Lot introuvable.' });
  const t = TRANSITIONS_LOT[req.body.statut];
  if (!t.depuis.includes(lot.statut)) return res.status(409).json({ succes: false, message: `Impossible depuis « ${lot.statut} ».` });

  let resultats = [];
  if (t.colisVers) {
    const numeros = (await Colis.find({ lotCode: lot.code, statut: { $in: t.colisDepuis } }).select('numeroSuivi').lean()).map(c => c.numeroSuivi);
    if (req.body.statut === STATUTS_LOT.PARTI && !numeros.length) {
      return res.status(409).json({ succes: false, message: 'Aucun colis chargé dans ce lot.' });
    }
    resultats = await changerStatutMasse(numeros, t.colisVers, req.user);
  }
  lot.statut = req.body.statut;
  if (t.date) lot[t.date] = new Date();
  if (req.body.statut === STATUTS_LOT.PARTI) {
    const push = require('../utils/push');
    const arrivee = String(lot.sens || 'FR-GN').split('-')[1];
    const nb = resultats.filter(r => r.ok).length;
    push.sansAttendre(push.auxAgencesDuPays(arrivee, { titre: `Lot ${lot.code} en route`, corps: `${nb} colis ${lot.mode === 'mer' ? 'par bateau' : lot.mode === 'express' ? 'en express' : 'par avion'}${lot.reference ? ` (${lot.reference})` : ''}. Préparez la réception.`, chemin: '/#/jour', etiquette: lot.code }));
  }
  if (t.annulation) lot.departLe = undefined;
  await lot.save();
  res.json({ succes: true, lot, colisMisAJour: resultats.filter(r => r.ok).length });
}));

// Retirer un colis d'un lot (erreur de chargement)
router.delete('/:code/colis/:numero', role(ROLES.ADMIN), ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase(), lotCode: req.params.code.toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis absent de ce lot.' });
  if (colis.statut !== STATUTS.CHARGE) return res.status(409).json({ succes: false, message: 'Le lot est déjà parti.' });
  colis.lot = undefined; colis.lotCode = undefined;
  colis.ajouterEvenement(STATUTS.DEPOSE, `Retiré du lot ${req.params.code.toUpperCase()}`, { agent: req.user._id });
  await colis.save();
  res.json({ succes: true });
}));

module.exports = router;
