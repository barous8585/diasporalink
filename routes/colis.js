// ─────────────────────────────────────────────────────────────
//  Routes client : estimation, suivi public, réservation, mes colis
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Colis = require('../models/Colis');
const Config = require('../models/Config');
const { auth } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { calculerTarif } = require('../utils/tarif');
const { notifier, MESSAGES } = require('../utils/sms');
const { STATUTS, MODES, TYPES_COLIS, ROLES, SENS, CGV_VERSION, libMode } = require('../config/constants');
const { normTel, vuePublique, vueComplete, sensDepuisAgences, nettoyerArticles } = require('../services/colisService');
const dom = require('../services/domicileService');

// Limite le « balayage » des numéros de suivi
const suiviLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { succes: false, message: 'Trop de recherches, patientez une minute.' } });

// ── GET /api/colis/tarif?sens=FR-GN&mode=air&poids=5&type=vetements&valeur=0&assurance=0
router.get('/tarif', ah(async (req, res) => {
  const { mode, poids, type, valeur, assurance } = req.query;
  const sens = req.query.sens || 'FR-GN';
  if (!Object.values(MODES).includes(mode)) return res.status(400).json({ succes: false, message: 'Mode invalide.' });
  if (!SENS.some(s => s.key === sens)) return res.status(400).json({ succes: false, message: 'Sens invalide.' });
  const config = await Config.get();
  const tarif = calculerTarif(config, {
    sens, mode, poidsKg: poids, typeColis: type || 'vetements', valeurDeclaree: valeur, assurance: assurance === '1' || assurance === 'true',
  });
  res.json({ succes: true, tarif });
}));

// ── GET /api/colis/suivi/:numero ── public, sans données sensibles
router.get('/suivi/:numero', suiviLimiter, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.trim().toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Numéro de suivi introuvable.' });
  res.json({ succes: true, colis: await vuePublique(colis) });
}));

// Filtre : colis que l'utilisateur envoie OU reçoit (par son numéro de téléphone)
const filtreUtilisateur = (user) => ({
  $or: [
    { client: user._id },
    { 'expediteur.telephone': user.telephone },
    { 'destinataire.telephone': user.telephone },
    { 'tiersAutorise.telephone': user.telephone },
  ],
});

// ── GET /api/colis ── mes colis (envoyés et reçus)
router.get('/', auth, ah(async (req, res) => {
  const liste = await Colis.find(filtreUtilisateur(req.user)).select('+codeRetrait').sort({ updatedAt: -1 }).limit(100);
  const colis = await Promise.all(liste.map(c => vueComplete(c, { avecCode: estAutorisePourCode(c, req.user) })));
  res.json({ succes: true, colis });
}));

// Le code de retrait n'est montré qu'au compte qui a réservé, et à l'expéditeur, au
// destinataire ou au tiers autorisé SI leur numéro a été vérifié (par SMS ou par l'agence).
// Sans vérification, n'importe qui pourrait créer un compte avec le numéro d'un autre.
function estAutorisePourCode(colis, user) {
  if (String(colis.client) === String(user._id)) return true;
  if (!user.verifie) return false;
  return [colis.destinataire?.telephone, colis.expediteur?.telephone, colis.tiersAutorise?.telephone].includes(user.telephone);
}

// ── GET /api/colis/:numero
router.get('/:numero', auth, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase(), ...filtreUtilisateur(req.user) }).select('+codeRetrait');
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  res.json({ succes: true, colis: await vueComplete(colis, { avecCode: estAutorisePourCode(colis, req.user) }) });
}));

// ── POST /api/colis ── réservation en ligne (le prix définitif est fixé à la pesée)
router.post('/', auth, [
  body('mode').isIn(Object.values(MODES)).withMessage('Choisissez express, avion ou bateau'),
  body('typeColis').isIn(TYPES_COLIS.map(t => t.key)).withMessage('Type de colis invalide'),
  body('poidsEstime').isFloat({ min: 0.1, max: 2000 }).withMessage('Indiquez le poids, ou ajoutez au moins un article à la pièce'),
  body('articles').optional().isArray({ max: 40 }),
  body('depot').trim().notEmpty().withMessage('Choisissez l\'agence où vous déposez le colis'),
  body('guichet').trim().notEmpty().withMessage('Choisissez l\'agence de retrait'),
  body('destinataire.nom').trim().notEmpty().withMessage('Nom du destinataire requis'),
  body('destinataire.telephone').trim().notEmpty().withMessage('Téléphone du destinataire requis'),
  body('nbCartons').optional().isInt({ min: 1, max: 50 }),
  body('valeurDeclaree').optional().isFloat({ min: 0 }),
  body('cgvAcceptees').equals('true').withMessage('Acceptez les conditions générales et confirmez qu\'aucun objet interdit n\'est dans le colis'),
], valider, ah(async (req, res) => {
  const config = await Config.get();
  const b = req.body;
  const sens = await sensDepuisAgences(b.depot, b.guichet);
  const articles = nettoyerArticles(config, b.articles);

  const colis = new Colis({
    client: req.user._id,
    expediteur: { nom: `${req.user.prenom} ${req.user.nom}`, telephone: req.user.telephone },
    destinataire: { nom: b.destinataire.nom, telephone: normTel(b.destinataire.telephone) },
    sens, mode: b.mode, typeColis: b.typeColis, depot: b.depot, guichet: b.guichet,
    description: b.description, nbCartons: b.nbCartons || 1, articles,
    poidsEstime: parseFloat(b.poidsEstime),
    valeurDeclaree: b.valeurDeclaree || 0, assurance: !!b.assurance,
    payeurArrivee: !!b.payeurArrivee,
    cgv: { version: CGV_VERSION, accepteesLe: new Date(), par: 'en_ligne' },
  });
  colis.tarif = { ...calculerTarif(config, {
    sens, mode: b.mode, poidsKg: b.poidsEstime, typeColis: b.typeColis, valeurDeclaree: b.valeurDeclaree, assurance: b.assurance, articles,
  }), estime: true };
  colis.ajouterEvenement(STATUTS.RESERVE, 'Réservation en ligne');
  if (b.ramassage?.demande) await dom.demanderCourse(colis, 'ramassage', b.ramassage);
  if (b.livraison?.demande) await dom.demanderCourse(colis, 'livraison', b.livraison);
  await colis.save();
  const push = require('../utils/push');
  push.sansAttendre(push.aLAgence(colis.depot, { titre: 'Nouvelle réservation', corps: `${colis.expediteur.nom} : ${colis.numeroSuivi}, ${colis.poidsEstime} kg ${libMode(colis.mode)}${colis.ramassage?.demande ? ', ramassage à domicile' : ', viendra déposer'}.`, chemin: '/#/jour' }));
  if (colis.ramassage?.demande) push.sansAttendre(push.aLAgence(colis.depot, { titre: 'Nouveau ramassage', corps: `${colis.expediteur.nom}${colis.ramassage.adresse?.quartier ? ` à ${colis.ramassage.adresse.quartier}` : ''}.`, chemin: '/#/courses' }, { roles: ['livreur'] }));
  res.status(201).json({ succes: true, colis: await vueComplete(colis) });
}));

// ── POST /api/colis/:numero/livraison ── demander, préciser ou annuler la livraison à domicile.
// Ouvert sans compte : le destinataire prouve qui il est avec son numéro de téléphone
// (le même que sur le colis). Il peut ainsi envoyer sa position depuis la page de suivi.
const livraisonLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { succes: false, message: 'Trop d\'essais, patientez un peu.' } });
router.post('/:numero/livraison', livraisonLimiter, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.trim().toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const tel = normTel(req.body.telephone);
  const autorise = tel && [colis.destinataire?.telephone, colis.expediteur?.telephone, colis.tiersAutorise?.telephone].includes(tel);
  if (!autorise) return res.status(403).json({ succes: false, message: 'Ce numéro ne correspond pas à ce colis.' });
  if ([STATUTS.REMIS, STATUTS.ANNULE, STATUTS.EN_LIVRAISON].includes(colis.statut)) {
    return res.status(409).json({ succes: false, message: colis.statut === STATUTS.EN_LIVRAISON ? 'Le livreur est déjà en route.' : 'Ce colis n\'est plus modifiable.' });
  }
  await dom.demanderCourse(colis, 'livraison', req.body.demande === false ? { demande: false } : { ...req.body, demande: true });
  colis.markModified('livraison');
  await colis.save();
  res.json({ succes: true, colis: await vuePublique(colis) });
}));

// ── PATCH /api/colis/:numero/tiers ── autoriser quelqu'un d'autre à retirer
router.patch('/:numero/tiers', auth, [
  body('nom').trim().notEmpty().withMessage('Nom requis'),
  body('telephone').trim().notEmpty().withMessage('Téléphone requis'),
], valider, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() }).select('+codeRetrait');
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const autorise = String(colis.client) === String(req.user._id) || req.user.role === ROLES.ADMIN
    || (req.user.verifie && [colis.destinataire.telephone, colis.expediteur.telephone].includes(req.user.telephone));
  if (!autorise) return res.status(403).json({ succes: false, message: 'Seuls l\'expéditeur et le destinataire peuvent faire cela.' });
  if ([STATUTS.REMIS, STATUTS.ANNULE].includes(colis.statut)) return res.status(409).json({ succes: false, message: 'Colis déjà remis.' });

  colis.tiersAutorise = { nom: req.body.nom, telephone: normTel(req.body.telephone), autoriseLe: new Date() };
  colis.historique.push({ label: 'Personne autorisée à retirer', detail: req.body.nom, le: new Date() });
  await colis.save();
  const msg = MESSAGES.tiers(colis, req.body.nom);
  notifier(colis.destinataire.telephone, msg);
  if (colis.statut === STATUTS.PRET && colis.codeRetrait) {
    notifier(colis.tiersAutorise.telephone, `${msg} Code de retrait : ${colis.codeRetrait}.`);
  }
  res.json({ succes: true, colis: await vueComplete(colis, { avecCode: estAutorisePourCode(colis, req.user) }) });
}));

// ── DELETE /api/colis/:numero ── annuler une réservation pas encore déposée
router.delete('/:numero', auth, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase(), client: req.user._id });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  if (colis.statut !== STATUTS.RESERVE) return res.status(409).json({ succes: false, message: 'Le colis est déjà déposé.' });
  colis.ajouterEvenement(STATUTS.ANNULE, 'Annulé par le client');
  await colis.save();
  res.json({ succes: true });
}));

module.exports = router;
