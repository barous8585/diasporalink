// ─────────────────────────────────────────────────────────────
//  Avis clients : les clients notent leur envoi une fois le colis remis,
//  tout le monde voit les avis publiés et les réponses de TMS.
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const Avis = require('../models/Avis');
const Colis = require('../models/Colis');
const { auth, role } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { ROLES, STATUTS } = require('../config/constants');

// Ce que tout le monde voit : jamais le téléphone ni le nom complet
const vuePublique = (a) => ({
  _id: a._id, auteur: a.auteur, role: a.role, sens: a.sens, mode: a.mode, note: a.note,
  commentaire: a.commentaire, reponse: a.reponse?.texte ? { texte: a.reponse.texte, le: a.reponse.le } : undefined,
  le: a.createdAt, modifie: !!a.modifieLe,
});

async function statistiques(filtre = { statut: 'publie' }) {
  const liste = await Avis.find(filtre).select('note').lean();
  const repartition = [1, 2, 3, 4, 5].map(n => liste.filter(a => a.note === n).length);
  const nb = liste.length;
  return { nb, moyenne: nb ? Math.round(liste.reduce((s, a) => s + a.note, 0) / nb * 10) / 10 : null, repartition };
}

// Qui peut noter ce colis ? Le compte qui a réservé, ou l'expéditeur / le destinataire
// dont le numéro a été vérifié (sinon n'importe qui pourrait noter avec le numéro d'un autre)
function roleSurColis(colis, user) {
  if (String(colis.client) === String(user._id)) return 'expediteur';
  if (!user.verifie) return null;
  if (colis.expediteur?.telephone === user.telephone) return 'expediteur';
  if (colis.destinataire?.telephone === user.telephone) return 'destinataire';
  return null;
}
const nomAffiche = (u) => `${String(u.prenom || '').trim()} ${String(u.nom || '').trim().charAt(0).toUpperCase()}${u.nom ? '.' : ''}`.trim() || 'Client';

// ── GET /api/avis ── avis publiés (les plus récents d'abord) et note moyenne
router.get('/', ah(async (req, res) => {
  const page = Math.max(1, Math.min(50, parseInt(req.query.page, 10) || 1));
  const parPage = 20;
  const filtre = { statut: 'publie' };
  const note = parseInt(req.query.note, 10);
  const [liste, stats] = await Promise.all([
    Avis.find(note >= 1 && note <= 5 ? { ...filtre, note } : filtre).sort({ createdAt: -1 }).skip((page - 1) * parPage).limit(parPage).lean(),
    statistiques(),
  ]);
  res.json({ succes: true, avis: liste.map(vuePublique), stats, page, parPage });
}));

// ── GET /api/avis/miens ── mes avis (pour savoir quels colis il reste à noter)
router.get('/miens', auth, ah(async (req, res) => {
  const liste = await Avis.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
  res.json({ succes: true, avis: liste.map(a => ({ ...vuePublique(a), numeroSuivi: a.numeroSuivi, statut: a.statut })) });
}));

// ── POST /api/avis ── { numero, note, commentaire } : donner ou modifier son avis
const limiteAvis = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { succes: false, message: 'Trop d\'avis envoyés, réessayez plus tard.' } });
router.post('/', auth, limiteAvis, [
  body('numero').isString().trim().notEmpty().withMessage('Numéro de colis requis'),
  body('note').isInt({ min: 1, max: 5 }).withMessage('Choisissez une note de 1 à 5 étoiles'),
  body('commentaire').optional({ values: 'falsy' }).isString().isLength({ max: 1000 }).withMessage('Commentaire trop long (1 000 caractères au plus)'),
], valider, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: String(req.body.numero).trim().toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const r = roleSurColis(colis, req.user);
  if (!r) return res.status(403).json({ succes: false, message: 'Seuls l\'expéditeur et le destinataire de ce colis peuvent le noter (numéro vérifié).' });
  if (colis.statut !== STATUTS.REMIS) return res.status(409).json({ succes: false, message: 'Vous pourrez donner votre avis une fois le colis remis.' });
  const commentaire = String(req.body.commentaire || '').replace(/\s+\n/g, '\n').trim().slice(0, 1000);
  let avis = await Avis.findOne({ colis: colis._id, user: req.user._id });
  if (avis) {
    if (avis.statut === 'masque') return res.status(409).json({ succes: false, message: 'Cet avis a été masqué par l\'équipe et ne peut plus être modifié.' });
    avis.note = parseInt(req.body.note, 10);
    avis.commentaire = commentaire;
    avis.modifieLe = new Date();
  } else {
    avis = new Avis({
      colis: colis._id, numeroSuivi: colis.numeroSuivi, user: req.user._id, auteur: nomAffiche(req.user), role: r,
      sens: colis.sens, mode: colis.mode, note: parseInt(req.body.note, 10), commentaire,
    });
  }
  await avis.save();
  const push = require('../utils/push');
  push.sansAttendre(push.auxAdmins({ titre: `Nouvel avis : ${'★'.repeat(avis.note)}${'☆'.repeat(5 - avis.note)}`, corps: `${avis.auteur} · ${avis.numeroSuivi}${avis.commentaire ? ` : ${avis.commentaire.slice(0, 90)}` : ''}`, chemin: '/#/avis', etiquette: `avis-${avis._id}` }));
  res.status(201).json({ succes: true, avis: { ...vuePublique(avis.toObject()), numeroSuivi: avis.numeroSuivi }, message: 'Merci pour votre avis !' });
}));

// ══ Équipe (admin) ══
// ── GET /api/avis/admin?filtre=sans_reponse|negatifs|masques ── tous les avis, avec le détail
router.get('/admin', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  const f = String(req.query.filtre || '');
  const filtre = f === 'sans_reponse' ? { statut: 'publie', 'reponse.texte': { $in: [null, ''] } }
    : f === 'negatifs' ? { note: { $lte: 2 } }
    : f === 'masques' ? { statut: 'masque' } : {};
  const [liste, stats, sansReponse] = await Promise.all([
    Avis.find(filtre).sort({ createdAt: -1 }).limit(500).populate('user', 'prenom nom telephone').lean(),
    statistiques(),
    Avis.countDocuments({ statut: 'publie', 'reponse.texte': { $in: [null, ''] } }),
  ]);
  res.json({ succes: true, avis: liste, stats, sansReponse });
}));

const chargerAvis = async (req, res) => {
  if (!/^[a-f0-9]{24}$/.test(String(req.params.id))) { res.status(404).json({ succes: false, message: 'Avis introuvable.' }); return null; }
  const a = await Avis.findById(req.params.id);
  if (!a) res.status(404).json({ succes: false, message: 'Avis introuvable.' });
  return a;
};

// ── POST /api/avis/:id/reponse ── { texte } réponse publique de TMS (vide = retirer)
router.post('/:id/reponse', auth, role(ROLES.ADMIN), [
  body('texte').optional({ values: 'falsy' }).isString().isLength({ max: 1000 }).withMessage('Réponse trop longue'),
], valider, ah(async (req, res) => {
  const a = await chargerAvis(req, res); if (!a) return;
  const texte = String(req.body.texte || '').trim();
  const nouvelle = texte && !a.reponse?.texte;
  a.reponse = texte ? { texte, le: new Date(), par: req.user._id } : undefined;
  await a.save();
  if (nouvelle) {
    const push = require('../utils/push');
    push.sansAttendre(push.aLUtilisateur(a.user, { titre: 'TMS a répondu à votre avis', corps: texte.slice(0, 110), chemin: '/#/avis' }));
  }
  res.json({ succes: true, avis: a });
}));

// ── POST /api/avis/:id/masquer ── { motif } ; /afficher pour le remettre
router.post('/:id/masquer', auth, role(ROLES.ADMIN), [
  body('motif').isString().trim().isLength({ min: 3, max: 200 }).withMessage('Indiquez le motif (propos injurieux, données personnelles…)'),
], valider, ah(async (req, res) => {
  const a = await chargerAvis(req, res); if (!a) return;
  a.statut = 'masque'; a.motifMasque = String(req.body.motif).trim();
  await a.save();
  res.json({ succes: true, avis: a });
}));
router.post('/:id/afficher', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  const a = await chargerAvis(req, res); if (!a) return;
  a.statut = 'publie'; a.motifMasque = undefined;
  await a.save();
  res.json({ succes: true, avis: a });
}));

module.exports = router;
