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
      auxGuichets: nb.pret || 0,
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
  }
  if (b.notesAdmin !== undefined) colis.notesAdmin = b.notesAdmin;
  if (b.fraisDouaneGnf !== undefined) colis.fraisDouaneGnf = Math.max(0, Math.round(parseFloat(b.fraisDouaneGnf) || 0));
  colis.historique.push({ label: 'Modifié par l\'administration', agent: req.user._id, le: new Date() });
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
