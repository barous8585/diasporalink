// ─────────────────────────────────────────────────────────────
//  Réclamations (litiges) : le client signale, TMS instruit et décide.
//  Décision : refus, avoir (on rembourse ou annule tout ou partie des frais)
//  ou indemnisation (valeur du contenu perdu / abîmé), sortie de caisse notée.
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body } = require('express-validator');
const Reclamation = require('../models/Reclamation');
const { MOTIFS } = require('../models/Reclamation');
const Colis = require('../models/Colis');
const Photo = require('../models/Photo');
const Facture = require('../models/Facture');
const Config = require('../models/Config');
const { Mouvement } = require('../models/Mouvement');
const { auth, role } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { ROLES, METHODES_PAIEMENT } = require('../config/constants');
const svc = require('../services/colisService');
const fact = require('../services/factureService');
const { notifier } = require('../utils/sms');
const { APP_NOM_COURT } = require('../config/constants');

router.use(auth);
const estEquipe = (u) => [ROLES.ADMIN, ROLES.AGENT].includes(u.role);

// Vue client : sans notes internes
const vueClient = (r) => {
  const o = r.toObject ? r.toObject() : r;
  return { ...o, suivi: (o.suivi || []).filter(s => !s.interne) };
};

// Plafond d'indemnisation indicatif : valeur déclarée si assuré, sinon € par kg
async function plafond(colis) {
  const config = await Config.get();
  const taux = colis.tarif?.taux || config.tauxEurGnf;
  if (colis.assurance && colis.valeurDeclaree) {
    const dev = colis.tarif?.devise || 'EUR';
    return { montantEur: dev === 'EUR' ? colis.valeurDeclaree : Math.round(colis.valeurDeclaree / taux * 100) / 100, base: 'valeur déclarée (assuré)' };
  }
  const kg = colis.poidsReel || colis.poidsEstime || 0;
  const parKg = config.litiges?.indemnisationKgEur || 0;
  return { montantEur: Math.round(kg * parKg * 100) / 100, base: `${parKg} € par kg × ${kg} kg (non assuré)` };
}

// ── POST /api/reclamations ── { numero, motif, description, montantDemande, deviseDemande, photos: [dataUrl] }
router.post('/', [
  body('numero').trim().notEmpty().withMessage('Numéro de suivi requis'),
  body('motif').isIn(MOTIFS.map(m => m.key)).withMessage('Choisissez le problème'),
  body('description').trim().isLength({ min: 10, max: 3000 }).withMessage('Décrivez le problème (10 caractères minimum)'),
  body('photos').optional().isArray({ max: 4 }).withMessage('4 photos maximum'),
], valider, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.body.numero.trim().toUpperCase() });
  if (!colis || !(await svc.lieAuCompte(colis, req.user, { strict: false }))) return res.status(404).json({ succes: false, message: 'Colis introuvable sur votre compte.' });
  if (colis.statut === 'reserve' || colis.statut === 'annule') return res.status(409).json({ succes: false, message: 'Ce colis n\'a pas encore été confié à TMS.' });
  const ouverte = await Reclamation.findOne({ colis: colis._id, statut: { $in: ['ouverte', 'en_cours'] } });
  if (ouverte) return res.status(409).json({ succes: false, message: `Une réclamation est déjà en cours (${ouverte.numero}).` });

  const config = await Config.get();
  const l = config.litiges || {};
  const jours = colis.remise?.le ? (Date.now() - new Date(colis.remise.le)) / 86400000 : 0;
  const horsDelai = ['abime', 'incomplet'].includes(req.body.motif) && colis.remise?.le ? jours > (l.delaiAbimeJours ?? 3) : false;
  const tel = req.user.telephone;
  const role = estEquipe(req.user) ? 'équipe TMS'
    : tel === colis.destinataire?.telephone ? 'destinataire' : 'expéditeur';

  const r = new Reclamation({
    colis: colis._id, numeroSuivi: colis.numeroSuivi, motif: req.body.motif, description: req.body.description,
    montantDemande: parseFloat(req.body.montantDemande) > 0 ? parseFloat(req.body.montantDemande) : undefined,
    deviseDemande: ['EUR', 'GNF'].includes(req.body.deviseDemande) ? req.body.deviseDemande : undefined,
    demandeur: { user: req.user._id, nom: `${req.user.prenom} ${req.user.nom}`, telephone: tel, role },
    horsDelai,
    suivi: [{ auteur: 'client', nom: req.user.prenom, texte: req.body.description }],
  });
  for (const dataUrl of req.body.photos || []) {
    const p = await Photo.depuisDataUrl(dataUrl, { type: 'reclamation', colis, reclamation: r._id, par: req.user._id });
    r.photos.push(p._id);
  }
  await r.save();
  colis.historique.push({ label: 'Réclamation ouverte', detail: `${r.numero} · ${MOTIFS.find(m => m.key === r.motif).label}`, le: new Date() });
  await colis.save();
  const push = require('../utils/push');
  push.sansAttendre(push.auxAdmins({ titre: 'Nouvelle réclamation', corps: `${r.numero} · ${r.numeroSuivi} : ${String(r.description || '').slice(0, 90)}`, chemin: `/#/reclamations/${r.numero}`, etiquette: r.numero }));
  res.status(201).json({ succes: true, reclamation: vueClient(r) });
}));

// ── GET /api/reclamations ── mes réclamations (admin : toutes, filtre ?statut=)
router.get('/', ah(async (req, res) => {
  const filtre = {};
  if (req.user.role === ROLES.ADMIN) { if (req.query.statut) filtre.statut = req.query.statut; }
  else filtre['demandeur.user'] = req.user._id;
  const liste = await Reclamation.find(filtre).sort({ updatedAt: -1 }).limit(300);
  res.json({ succes: true, reclamations: req.user.role === ROLES.ADMIN ? liste : liste.map(vueClient), motifs: MOTIFS });
}));

// ── GET /api/reclamations/:numero
router.get('/:numero', ah(async (req, res) => {
  const r = await Reclamation.findOne({ numero: req.params.numero.toUpperCase() });
  if (!r) return res.status(404).json({ succes: false, message: 'Réclamation introuvable.' });
  const admin = req.user.role === ROLES.ADMIN;
  if (!admin && String(r.demandeur?.user) !== String(req.user._id)) return res.status(404).json({ succes: false, message: 'Réclamation introuvable.' });
  if (!admin) return res.json({ succes: true, reclamation: vueClient(r) });
  const colis = await Colis.findById(r.colis).populate('historique.agent', 'prenom nom');
  res.json({
    succes: true, reclamation: r,
    colis: colis ? await svc.vueComplete(colis) : null,
    factures: colis ? await fact.facturesDuColis(colis) : [],
    plafond: colis ? await plafond(colis) : null,
  });
}));

// ── POST /api/reclamations/:numero/message ── { texte, interne }
router.post('/:numero/message', [body('texte').trim().isLength({ min: 1, max: 2000 }).withMessage('Message vide')], valider, ah(async (req, res) => {
  const r = await Reclamation.findOne({ numero: req.params.numero.toUpperCase() });
  const admin = req.user.role === ROLES.ADMIN;
  if (!r || (!admin && String(r.demandeur?.user) !== String(req.user._id))) return res.status(404).json({ succes: false, message: 'Réclamation introuvable.' });
  r.suivi.push({ auteur: admin ? 'tms' : 'client', nom: req.user.prenom, texte: req.body.texte, interne: admin && !!req.body.interne });
  { const push = require('../utils/push');
    if (!admin) push.sansAttendre(push.auxAdmins({ titre: `Réclamation ${r.numero}`, corps: `Le client a écrit : ${String(req.body.texte).slice(0, 100)}`, chemin: `/#/reclamations/${r.numero}`, etiquette: r.numero }));
    else if (!req.body.interne && r.demandeur?.user) push.sansAttendre(push.aLUtilisateur(r.demandeur.user, { titre: `Réclamation ${r.numero}`, corps: `TMS vous a répondu : ${String(req.body.texte).slice(0, 100)}`, chemin: `/#/reclamation/${r.numero}` })); }
  if (admin && r.statut === 'ouverte') r.statut = 'en_cours';
  await r.save();
  if (admin && !req.body.interne && r.demandeur?.telephone) notifier(r.demandeur.telephone, `${APP_NOM_COURT} : réponse à votre réclamation ${r.numero}. Consultez-la dans « Mes colis ».`);
  res.json({ succes: true, reclamation: admin ? r : vueClient(r) });
}));

// ── POST /api/reclamations/:numero/decision (admin)
// { decision: 'refus'|'avoir'|'indemnisation', montant, devise, motif, methode, reference, facture }
router.post('/:numero/decision', role(ROLES.ADMIN), [
  body('decision').isIn(['refus', 'avoir', 'indemnisation']).withMessage('Décision invalide'),
  body('motif').trim().isLength({ min: 3 }).withMessage('Expliquez la décision au client'),
], valider, ah(async (req, res) => {
  const r = await Reclamation.findOne({ numero: req.params.numero.toUpperCase() });
  if (!r) return res.status(404).json({ succes: false, message: 'Réclamation introuvable.' });
  if (['acceptee', 'refusee', 'close'].includes(r.statut)) return res.status(409).json({ succes: false, message: 'Décision déjà prise.' });
  const colis = await Colis.findById(r.colis);
  const b = req.body;
  const decision = { type: b.decision, motif: b.motif, le: new Date(), par: req.user._id };

  if (b.decision !== 'refus') {
    const montant = parseFloat(b.montant);
    if (!(montant > 0)) return res.status(400).json({ succes: false, message: 'Montant requis.' });
    let devise = b.devise === 'GNF' ? 'GNF' : 'EUR';
    if (b.decision === 'avoir') {
      // Avoir sur une facture du colis (par défaut celle du transport)
      const factures = await Facture.find({ colis: colis._id, type: 'facture' }).sort({ date: 1 });
      const f = factures.find(x => x.numero === b.facture) || factures.find(x => x.lignes.some(l => l.cle === 'transport')) || factures[0];
      if (!f) return res.status(409).json({ succes: false, message: 'Aucune facture sur ce colis : rien à rembourser par avoir.' });
      const avoir = await fact.emettreAvoir(f, montant, `Réclamation ${r.numero} : ${b.motif}`, req.user);
      colis.avoirsGnf = (colis.avoirsGnf || 0) + avoir.totalGnf;
      decision.avoir = avoir.numero;
      devise = f.devise;
      decision.montant = avoir.totalTTC;
    } else decision.montant = montant;
    decision.devise = devise;
    // Argent rendu au client : sortie de la caisse de l'admin (montant négatif)
    if (b.methode && METHODES_PAIEMENT.some(m => m.key === b.methode)) {
      await Mouvement.create({
        agent: req.user._id, lieu: req.user.lieu || 'SIEGE', colis: colis._id, numeroSuivi: colis.numeroSuivi,
        montant: -decision.montant, devise, methode: b.methode, objet: b.decision === 'avoir' ? 'remboursement' : 'indemnisation', reference: b.reference,
      });
      decision.versement = { methode: b.methode, reference: b.reference, le: new Date() };
    }
  }
  r.decision = decision;
  r.statut = b.decision === 'refus' ? 'refusee' : 'acceptee';
  const texte = b.decision === 'refus' ? `Réclamation refusée : ${b.motif}`
    : `Réclamation acceptée : ${b.decision === 'avoir' ? 'remboursement' : 'indemnisation'} de ${decision.montant.toLocaleString('fr-FR')} ${decision.devise === 'EUR' ? '€' : 'GNF'}. ${b.motif}`;
  r.suivi.push({ auteur: 'tms', nom: req.user.prenom, texte });
  await r.save();
  colis.historique.push({ label: b.decision === 'refus' ? 'Réclamation refusée' : 'Réclamation acceptée', detail: r.numero, agent: req.user._id, le: new Date() });
  await colis.save();
  if (r.demandeur?.telephone) notifier(r.demandeur.telephone, `${APP_NOM_COURT} : décision sur votre réclamation ${r.numero}. Consultez-la dans « Mes colis ».`);
  res.json({ succes: true, reclamation: r });
}));

// ── POST /api/reclamations/:numero/clore (admin)
router.post('/:numero/clore', role(ROLES.ADMIN), ah(async (req, res) => {
  const r = await Reclamation.findOneAndUpdate({ numero: req.params.numero.toUpperCase() }, { statut: 'close' }, { new: true });
  if (!r) return res.status(404).json({ succes: false, message: 'Réclamation introuvable.' });
  res.json({ succes: true, reclamation: r });
}));

module.exports = router;
module.exports.plafond = plafond;
