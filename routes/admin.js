// ─────────────────────────────────────────────────────────────
//  Back-office : tableau de bord, recherche, statuts en masse, relances
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body } = require('express-validator');
const Colis = require('../models/Colis');
const Lot = require('../models/Lot');
const Config = require('../models/Config');
const { Mouvement } = require('../models/Mouvement');
const { auth, role } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { calculerSolde } = require('../utils/tarif');
const { notifier, MESSAGES } = require('../utils/sms');
const { ROLES, STATUTS, STATUTS_LOT } = require('../config/constants');
const svc = require('../services/colisService');

router.use(auth, role(ROLES.ADMIN));

const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── GET /api/admin/stats
router.get('/stats', ah(async (req, res) => {
  const config = await Config.get();
  const debut = new Date(); debut.setHours(0, 0, 0, 0);

  const parStatut = await Colis.aggregate([{ $group: { _id: '$statut', nb: { $sum: 1 } } }]);
  const nb = Object.fromEntries(parStatut.map(s => [s._id, s.nb]));

  const aux = await Colis.find({ statut: STATUTS.PRET }).lean();
  const seuil = config.magasinage?.joursGratuits ?? 10;
  const anciens = [];
  let impayes = 0;
  for (const c of aux) {
    const s = calculerSolde(c, config);
    if (s.magasinage.jours > seuil) anciens.push({ numeroSuivi: c.numeroSuivi, destinataire: c.destinataire, guichet: c.guichet, jours: s.magasinage.jours });
    if (s.soldeGnf > 0) impayes++;
  }

  // Écarts de pesée > 1 kg sur les 30 derniers jours
  const il30j = new Date(Date.now() - 30 * 86400000);
  const deposes = await Colis.find({ poidsEstime: { $gt: 0 }, poidsReel: { $gt: 0 }, updatedAt: { $gte: il30j } })
    .select('numeroSuivi poidsEstime poidsReel expediteur statut').lean();
  const ecartsPesee = deposes
    .map(c => ({ ...c, ecart: Math.round((c.poidsReel - c.poidsEstime) * 10) / 10 }))
    .filter(c => Math.abs(c.ecart) >= 1)
    .slice(0, 20);

  const mvtsJour = await Mouvement.find({ le: { $gte: debut } }).lean();
  const encaisseJour = { EUR: 0, GNF: 0 };
  mvtsJour.forEach(m => { encaisseJour[m.devise] = Math.round((encaisseJour[m.devise] + m.montant) * 100) / 100; });
  const caissesEnRetard = (await Mouvement.distinct('agent', { cloture: null, le: { $lt: debut } })).length;

  const lots = await Lot.find({ statut: { $in: [STATUTS_LOT.PREPARATION, STATUTS_LOT.PARTI] } }).lean();

  const jours = config.tauxMisAJourLe ? Math.floor((Date.now() - new Date(config.tauxMisAJourLe)) / 86400000) : null;

  res.json({
    succes: true,
    compteurs: {
      reserves: nb.reserve || 0,
      auDepot: (nb.depose || 0) + (nb.charge || 0),
      enRoute: (nb.en_transit || 0) + (nb.arrive || 0) + (nb.acheminement || 0),
      auxGuichets: (nb.pret || 0) + (nb.en_livraison || 0),
      anciensGuichet: anciens.length,
      impayes,
      remis: nb.remis || 0,
    },
    lotsEnCours: { preparation: lots.filter(l => l.statut === 'preparation').length, partis: lots.filter(l => l.statut === 'parti').length },
    encaisseJour,
    alertes: {
      anciens: anciens.sort((a, b) => b.jours - a.jours).slice(0, 30),
      ecartsPesee,
      caissesEnRetard,
      tauxAgeJours: jours,
    },
  });
}));

// ── GET /api/admin/colis?q=&statut=&guichet=&lot=&page=
router.get('/colis', ah(async (req, res) => {
  const { q, statut, guichet, lot } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filtre = {};
  if (statut) filtre.statut = statut;
  if (guichet) filtre.guichet = guichet;
  if (lot) filtre.lotCode = String(lot).toUpperCase();
  if (q && String(q).trim()) {
    const t = String(q).trim();
    const re = new RegExp(echapperRegex(t), 'i');
    filtre.$or = [
      { numeroSuivi: t.toUpperCase() },
      { 'expediteur.telephone': svc.normTel(t) },
      { 'destinataire.telephone': svc.normTel(t) },
      { 'expediteur.nom': re },
      { 'destinataire.nom': re },
    ];
  }
  const config = await Config.get();
  const [liste, total] = await Promise.all([
    Colis.find(filtre).sort({ updatedAt: -1 }).skip((page - 1) * 50).limit(50),
    Colis.countDocuments(filtre),
  ]);
  res.json({
    succes: true, total, page,
    colis: liste.map(c => ({ ...c.toJSON(), solde: calculerSolde(c, config) })),
  });
}));

// ── GET /api/admin/colis/:numero ── fiche avec code de retrait (support téléphonique)
router.get('/colis/:numero', ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() }).select('+codeRetrait +codeEssais')
    .populate('historique.agent', 'prenom nom');
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const vue = await svc.vueComplete(colis, { avecCode: true });
  vue.codeEssais = colis.codeEssais;
  res.json({ succes: true, colis: vue });
}));

// ── POST /api/admin/colis/statut ── { numeros: [], statut }
router.post('/colis/statut', [
  body('numeros').isArray({ min: 1, max: 500 }).withMessage('Sélection vide'),
  body('statut').isIn([STATUTS.EN_TRANSIT, STATUTS.ARRIVE, STATUTS.PRET, STATUTS.ANNULE]).withMessage('Statut non autorisé ici'),
], valider, ah(async (req, res) => {
  const resultats = await svc.changerStatutMasse(req.body.numeros.map(n => String(n).toUpperCase()), req.body.statut, req.user);
  res.json({ succes: true, resultats, nbOk: resultats.filter(r => r.ok).length });
}));

// ── POST /api/admin/colis/:numero/debloquer ── remet le compteur de codes faux à zéro, renvoie le code
router.post('/colis/:numero/debloquer', ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() }).select('+codeRetrait +codeEssais');
  if (!colis || colis.statut !== STATUTS.PRET) return res.status(404).json({ succes: false, message: 'Colis non disponible au guichet.' });
  colis.codeEssais = 0;
  await colis.save();
  res.json({ succes: true, message: 'Colis débloqué.' });
}));

// ── PATCH /api/admin/colis/:numero ── corrections (destinataire, guichet, notes, douane)
router.patch('/colis/:numero', ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const b = req.body;
  if (b.destinataire?.nom) colis.destinataire.nom = b.destinataire.nom;
  if (b.destinataire?.telephone) colis.destinataire.telephone = svc.normTel(b.destinataire.telephone);
  if (b.guichet) {
    const config = await Config.get();
    const nouvelle = config.agences.find(g => g.code === b.guichet);
    if (!nouvelle) return res.status(400).json({ succes: false, message: 'Agence inconnue.' });
    if (nouvelle.pays !== svc.paysArriveeDe(colis.sens)) return res.status(400).json({ succes: false, message: 'L\'agence de retrait doit rester dans le pays de destination.' });
    colis.guichet = b.guichet;
    if (colis.livraison?.demande && colis.livraison.statut !== 'annulee' && colis.livraison.agence !== b.guichet) {
      if (colis.statut === STATUTS.EN_LIVRAISON) return res.status(409).json({ succes: false, message: 'Le colis est en cours de livraison.' });
      colis.livraison.livreur = undefined; colis.livraison.livreurNom = undefined; colis.livraison.statut = 'a_planifier';
      await require('../services/domicileService').demanderCourse(colis, 'livraison', { demande: true, adresse: colis.livraison.adresse, jour: colis.livraison.jour, moment: colis.livraison.moment });
    }
  }
  if (b.notesAdmin !== undefined) colis.notesAdmin = b.notesAdmin;
  if (b.fraisDouaneGnf !== undefined) colis.fraisDouaneGnf = Math.max(0, Math.round(parseFloat(b.fraisDouaneGnf) || 0));
  colis.historique.push({ label: 'Modifié par l\'administration', agent: req.user._id, le: new Date() });
  await colis.save();
  res.json({ succes: true, colis: await svc.vueComplete(colis) });
}));

// ── Courses à domicile ──────────────────────────────────────
const dom = require('../services/domicileService');
const User = require('../models/User');

// GET /api/admin/courses?agence= ── courses ouvertes + livreurs pour l'assignation
router.get('/courses', ah(async (req, res) => {
  const [courses, livreurs] = await Promise.all([
    dom.coursesOuvertes({ agence: req.query.agence || undefined }),
    User.find({ role: ROLES.LIVREUR, actif: true }).select('prenom nom telephone lieu').lean(),
  ]);
  // Courses terminées récemment, avec l'écart GPS (contrôle)
  const il7j = new Date(Date.now() - 7 * 86400000);
  const config = await Config.get();
  const faites = [];
  for (const type of dom.COURSES) {
    const liste = await Colis.find({ [`${type}.statut`]: 'faite', [`${type}.faiteLe`]: { $gte: il7j } }).sort({ [`${type}.faiteLe`]: -1 }).limit(100);
    for (const c of liste) faites.push(await dom.vueCourse(c, type, config));
  }
  faites.sort((a, b) => new Date(b.faiteLe) - new Date(a.faiteLe));
  res.json({ succes: true, courses, livreurs, faites });
}));

// POST /api/admin/courses/assigner ── { numero, type, livreur: id | null }
router.post('/courses/assigner', [
  body('numero').trim().notEmpty(),
  body('type').isIn(dom.COURSES),
], valider, ah(async (req, res) => {
  let livreur = null;
  if (req.body.livreur) {
    livreur = await User.findOne({ _id: req.body.livreur, role: ROLES.LIVREUR, actif: true });
    if (!livreur) return res.status(404).json({ succes: false, message: 'Livreur introuvable.' });
  }
  // Une course à domicile se paie d'avance : on prévient avant d'envoyer un livreur
  if (livreur && !req.body.force) {
    const c0 = await Colis.findOne({ numeroSuivi: String(req.body.numero).trim().toUpperCase() });
    const v = c0?.[req.body.type] ? await dom.vueCourse(c0, req.body.type, await Config.get()) : null;
    if (v && !v.payee) return res.status(409).json({ succes: false, code: 'non_payee', message: 'Cette course n\'est pas encore payée par le client.' });
  }
  const colis = await dom.assigner(req.body.numero, req.body.type, livreur, { par: req.user });
  if (livreur) { const push = require('../utils/push'); push.sansAttendre(push.aLUtilisateur(livreur._id, { titre: 'Course pour vous', corps: `${req.body.type === 'ramassage' ? 'Ramassage' : 'Livraison'} ${colis.numeroSuivi}${colis[req.body.type]?.adresse?.quartier ? ` à ${colis[req.body.type].adresse.quartier}` : ''}.`, chemin: '/#/courses' })); }
  res.json({ succes: true, course: await dom.vueCourse(colis, req.body.type, await Config.get()) });
}));

// POST /api/admin/courses/adresse ── { numero, type, demande, adresse: {…, lien}, jour, moment }
router.post('/courses/adresse', [
  body('numero').trim().notEmpty(),
  body('type').isIn(dom.COURSES),
], valider, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.body.numero.trim().toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  if ([STATUTS.REMIS, STATUTS.ANNULE].includes(colis.statut)) return res.status(409).json({ succes: false, message: 'Colis terminé.' });
  if (req.body.type === 'ramassage' && colis.statut !== STATUTS.RESERVE) return res.status(409).json({ succes: false, message: 'Colis déjà déposé.' });
  await dom.demanderCourse(colis, req.body.type, req.body.demande === false ? { demande: false } : { ...req.body, demande: true });
  colis.markModified(req.body.type);
  colis.historique.push({ label: 'Course modifiée par l\'administration', agent: req.user._id, le: new Date() });
  await colis.save();
  res.json({ succes: true, colis: await svc.vueComplete(colis) });
}));

// ── POST /api/admin/relances ── relance des colis au guichet depuis longtemps
router.post('/relances', ah(async (req, res) => {
  const config = await Config.get();
  const seuil = config.magasinage?.joursGratuits ?? 10;
  const liste = await Colis.find({ statut: STATUTS.PRET });
  let envoyes = 0;
  for (const c of liste) {
    const s = calculerSolde(c, config);
    if (s.magasinage.jours > seuil) {
      const guichet = (await Config.lieu(c.guichet))?.nom || c.guichet;
      notifier(c.destinataire.telephone, MESSAGES.relance(c, guichet, s.magasinage.jours));
      envoyes++;
    }
  }
  res.json({ succes: true, envoyes });
}));

module.exports = router;
