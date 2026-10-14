// ─────────────────────────────────────────────────────────────
//  Caisse : encaissements non clôturés par agent, clôture de fin de journée
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const { Mouvement, Cloture } = require('../models/Mouvement');
const { auth, role } = require('../middleware/auth');
const { ah } = require('../utils/http');
const { ROLES } = require('../config/constants');

router.use(auth, role(ROLES.AGENT, ROLES.LIVREUR, ROLES.ADMIN));

// totaux[devise][methode]
function totaliser(mouvements) {
  const totaux = {};
  for (const m of mouvements) {
    totaux[m.devise] = totaux[m.devise] || {};
    totaux[m.devise][m.methode] = Math.round(((totaux[m.devise][m.methode] || 0) + m.montant) * 100) / 100;
  }
  return totaux;
}

// ── GET /api/caisse/moi ── ma caisse ouverte
router.get('/moi', ah(async (req, res) => {
  const mouvements = await Mouvement.find({ agent: req.user._id, cloture: null }).sort({ le: -1 }).lean();
  res.json({ succes: true, mouvements, totaux: totaliser(mouvements), depuis: mouvements.at(-1)?.le || null });
}));

// ── POST /api/caisse/cloturer ── { especesComptees: { EUR, GNF }, commentaire }
router.post('/cloturer', ah(async (req, res) => {
  const mouvements = await Mouvement.find({ agent: req.user._id, cloture: null }).lean();
  if (!mouvements.length) return res.status(409).json({ succes: false, message: 'Aucun encaissement à clôturer.' });
  const totaux = totaliser(mouvements);
  const comptees = req.body.especesComptees || {};
  const ecart = {};
  for (const d of ['EUR', 'GNF']) {
    const attendu = totaux[d]?.especes || 0;
    const compte = parseFloat(comptees[d]);
    if (Number.isFinite(compte)) ecart[d] = Math.round((compte - attendu) * 100) / 100;
  }
  const cloture = await Cloture.create({
    agent: req.user._id, lieu: req.user.lieu || '—', totaux,
    especesComptees: comptees, ecart, nbMouvements: mouvements.length, commentaire: req.body.commentaire,
  });
  await Mouvement.updateMany({ _id: { $in: mouvements.map(m => m._id) } }, { $set: { cloture: cloture._id } });
  res.json({ succes: true, cloture });
}));

// ── GET /api/caisse/jour ── admin : caisses ouvertes + clôtures du jour, par agent
router.get('/jour', role(ROLES.ADMIN), ah(async (req, res) => {
  const debut = req.query.date ? new Date(req.query.date) : new Date();
  debut.setHours(0, 0, 0, 0);
  const fin = new Date(debut.getTime() + 86400000);

  const [ouverts, duJour, clotures] = await Promise.all([
    Mouvement.find({ cloture: null }).populate('agent', 'prenom nom lieu').lean(),
    Mouvement.find({ le: { $gte: debut, $lt: fin } }).lean(),
    Cloture.find({ createdAt: { $gte: debut, $lt: fin } }).populate('agent', 'prenom nom lieu').lean(),
  ]);

  const parAgent = {};
  for (const m of ouverts) {
    const k = String(m.agent?._id);
    parAgent[k] = parAgent[k] || { agent: m.agent, lieu: m.lieu, mouvements: [], plusAncien: m.le };
    parAgent[k].mouvements.push(m);
    if (m.le < parAgent[k].plusAncien) parAgent[k].plusAncien = m.le;
  }
  const caissesOuvertes = Object.values(parAgent).map(c => ({
    agent: c.agent, lieu: c.lieu, nb: c.mouvements.length, totaux: totaliser(c.mouvements),
    plusAncien: c.plusAncien, enRetard: new Date(c.plusAncien) < debut,
  }));
  res.json({ succes: true, date: debut, encaisseJour: totaliser(duJour), caissesOuvertes, clotures });
}));

module.exports = router;
