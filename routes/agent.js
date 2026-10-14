// ─────────────────────────────────────────────────────────────
//  Routes agent (dépôt & guichet)
//  Les opérations portent un opId : l'app peut les renvoyer après une coupure
//  réseau sans créer de doublon.
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body } = require('express-validator');
const Colis = require('../models/Colis');
const Lot = require('../models/Lot');
const Config = require('../models/Config');
const { auth, role } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { ROLES, STATUTS, STATUTS_LOT, TYPES_COLIS, MODES, SENS } = require('../config/constants');
const { enGnf } = require('../utils/tarif');
const svc = require('../services/colisService');

router.use(auth, role(ROLES.AGENT, ROLES.ADMIN));

// ── GET /api/agent/contexte ── infos de démarrage + cache hors-ligne
router.get('/contexte', ah(async (req, res) => {
  const config = await Config.get();
  const lieu = await Config.lieu(req.user.lieu);
  const pays = lieu?.pays || null; // admin sans agence : tout
  // Lots qui partent de mon pays / qui arrivent dans mon pays
  const sensDepart = SENS.filter(s => !pays || s.depart === pays).map(s => s.key);
  const sensArrivee = SENS.filter(s => !pays || s.arrivee === pays).map(s => s.key);
  const filtreSens = (liste) => ({ $or: [{ sens: { $in: liste } }, ...(liste.includes('FR-GN') ? [{ sens: { $exists: false } }] : [])] });
  const [lotsPreparation, lotsEnRoute, colisPrets, aAcheminer] = await Promise.all([
    Lot.find({ statut: STATUTS_LOT.PREPARATION, ...filtreSens(sensDepart) }).sort({ createdAt: -1 }).lean(),
    Lot.find({ statut: { $in: [STATUTS_LOT.PARTI, STATUTS_LOT.ARRIVE] }, ...filtreSens(sensArrivee) }).sort({ createdAt: -1 }).limit(20).lean(),
    lieu ? svc.colisDuGuichet(lieu.code) : [],
    // Colis arrivés dans mon pays qui doivent repartir vers une autre agence
    lieu ? Colis.countDocuments({ statut: STATUTS.ARRIVE, sens: { $in: sensArrivee }, guichet: { $ne: lieu.code } }) : 0,
  ]);
  res.json({
    succes: true,
    agent: req.user, lieu, pays,
    estGuichet: !!lieu, // conservé pour les anciennes versions de l'app
    lotsPreparation, lotsEnRoute, colisPrets, aAcheminer,
    majLe: new Date(),
  });
}));

// ── GET /api/agent/colis/:numero ── fiche complète (remise, contrôle)
router.get('/colis/:numero', ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.trim().toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  res.json({ succes: true, colis: await svc.vueComplete(colis) });
}));

// ── GET /api/agent/reservations?q= ── retrouver une réservation au comptoir
router.get('/reservations', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ succes: true, colis: [] });
  const tel = svc.normTel(q);
  const liste = await Colis.find({
    statut: STATUTS.RESERVE,
    $or: [{ numeroSuivi: q.toUpperCase() }, { 'expediteur.telephone': tel }, { 'destinataire.telephone': tel }],
  }).limit(20);
  res.json({ succes: true, colis: liste.map(c => c.toJSON()) });
}));

// ── POST /api/agent/depot ── pesée et enregistrement au dépôt
router.post('/depot', [
  body('poidsReel').isFloat({ min: 0.1, max: 2000 }).withMessage('Poids pesé invalide'),
  body('mode').optional().isIn(Object.values(MODES)),
  body('typeColis').optional().isIn(TYPES_COLIS.map(t => t.key)),
  body('expediteur.nom').if(body('numeroSuivi').not().exists()).trim().notEmpty().withMessage('Nom de l\'expéditeur requis'),
  body('expediteur.telephone').if(body('numeroSuivi').not().exists()).trim().notEmpty().withMessage('Téléphone de l\'expéditeur requis'),
  body('destinataire.nom').if(body('numeroSuivi').not().exists()).trim().notEmpty().withMessage('Nom du destinataire requis'),
  body('destinataire.telephone').if(body('numeroSuivi').not().exists()).trim().notEmpty().withMessage('Téléphone du destinataire requis'),
], valider, ah(async (req, res) => {
  const resultat = await svc.avecOperation(req.body.opId, req.user, 'depot', () => svc.deposer(req.user, req.body));
  res.status(201).json({ succes: true, ...resultat });
}));

// ── POST /api/agent/scans ── lot de scans (envoyés dès que le réseau revient)
// body: { scans: [{ opId, numero, action: 'charger'|'arrivee'|'guichet', lot, emplacement, scanneLe }] }
router.post('/scans', ah(async (req, res) => {
  const scans = Array.isArray(req.body.scans) ? req.body.scans.slice(0, 500) : [];
  const resultats = [];
  for (const scan of scans) {
    try {
      const r = await svc.avecOperation(scan.opId, req.user, 'scan', () => svc.appliquerScan(req.user, scan));
      resultats.push({ opId: scan.opId, ...r });
    } catch (e) {
      console.error('[scan]', e);
      resultats.push({ opId: scan.opId, numero: scan.numero, ok: false, erreur: 'Erreur serveur, réessayez.' , temporaire: true });
    }
  }
  res.json({ succes: true, resultats });
}));

// ── POST /api/agent/remise ── remise au destinataire
router.post('/remise', [
  body('numero').trim().notEmpty(),
  body('code').trim().isLength({ min: 4, max: 4 }).withMessage('Code à 4 chiffres'),
], valider, ah(async (req, res) => {
  const resultat = await svc.avecOperation(req.body.opId, req.user, 'remise', () => svc.remettre(req.user, { ...req.body, aDomicile: false }));
  res.json({ succes: true, ...resultat });
}));

// ── POST /api/agent/encaisser ── paiement sans remise (ex. complément au dépôt, douane)
router.post('/encaisser', [
  body('numero').trim().notEmpty(),
  body('paiement.montant').isFloat({ min: 1 }).withMessage('Montant invalide'),
], valider, ah(async (req, res) => {
  const resultat = await svc.avecOperation(req.body.opId, req.user, 'encaisser', async () => {
    const colis = await Colis.findOne({ numeroSuivi: req.body.numero.trim().toUpperCase() });
    if (!colis) throw new svc.ErreurMetier('Colis introuvable.', 404);
    await svc.encaisser(colis, req.user, req.body.paiement, { opId: req.body.opId });
    colis.historique.push({ label: 'Paiement reçu', detail: `${req.body.paiement.montant} ${req.body.paiement.devise}`, lieu: req.user.lieu, le: new Date() });
    await colis.save();
    return { colis: await svc.vueComplete(colis) };
  });
  res.json({ succes: true, ...resultat });
}));

// ── PATCH /api/agent/colis/:numero/douane ── saisir les droits de douane
// body : { montant, devise: 'GNF'|'EUR' } (ou l'ancien { fraisDouaneGnf })
router.patch('/colis/:numero/douane', [
  body('montant').optional().isFloat({ min: 0 }).withMessage('Montant invalide'),
  body('devise').optional().isIn(['EUR', 'GNF']),
  body('fraisDouaneGnf').optional().isFloat({ min: 0 }).withMessage('Montant invalide'),
], valider, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  if (colis.statut === STATUTS.REMIS) return res.status(409).json({ succes: false, message: 'Colis déjà remis.' });
  const config = await Config.get();
  const taux = colis.tarif?.taux || config.tauxEurGnf;
  const montant = parseFloat(req.body.montant ?? req.body.fraisDouaneGnf) || 0;
  const devise = req.body.montant !== undefined ? (req.body.devise || 'GNF') : 'GNF';
  colis.fraisDouaneGnf = enGnf(montant, devise, taux);
  colis.historique.push({ label: 'Dédouané', detail: `Droits : ${devise === 'EUR' ? `${montant.toLocaleString('fr-FR')} €` : `${colis.fraisDouaneGnf.toLocaleString('fr-FR')} GNF`}`, lieu: req.user.lieu, le: new Date() });
  await colis.save();
  res.json({ succes: true, colis: await svc.vueComplete(colis) });
}));

module.exports = router;
