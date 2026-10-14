const router = require('express').Router();
const Config = require('../models/Config');
const { auth, role } = require('../middleware/auth');
const { ah } = require('../utils/http');
const {
  APP_NOM, APP_NOM_COURT, ENTREPRISE, MODES_INFO, TYPES_COLIS, METHODES_PAIEMENT, STATUTS_LABELS, ROLES, PAYS, SENS, MOMENTS,
} = require('../config/constants');

// ── GET /api/config ── données publiques pour les 3 apps
router.get('/', ah(async (req, res) => {
  const c = await Config.get();
  res.json({
    succes: true,
    app: APP_NOM,
    appCourt: APP_NOM_COURT,
    authMode: require('../controllers/authController').modeAuth(),
    entreprise: ENTREPRISE,
    pays: PAYS,
    sens: SENS.map(s => ({ ...s, devise: c.tarifs?.[s.key]?.devise || PAYS[s.depart].devise })),
    modes: MODES_INFO,
    tarifs: c.tarifs,
    typesColis: TYPES_COLIS.map(t => ({ ...t, surcharge: c.surcharges?.[t.key] ?? t.surcharge })),
    tauxAssurance: c.tauxAssurance,
    tauxEurGnf: c.tauxEurGnf,
    tauxMisAJourLe: c.tauxMisAJourLe,
    magasinage: c.magasinage,
    domicile: c.domicile,
    moments: MOMENTS,
    agences: (c.agences || []).filter(a => a.actif !== false),
    methodesPaiement: METHODES_PAIEMENT,
    statuts: STATUTS_LABELS,
    // Même forme que la config serveur : utilisée par KolisTarif côté navigateur
    regles: {
      tarifs: c.tarifs, surcharges: c.surcharges, tauxAssurance: c.tauxAssurance,
      tauxEurGnf: c.tauxEurGnf, magasinage: c.magasinage, domicile: c.domicile,
    },
  });
}));

// ── GET /api/config/position?lien= ── coordonnées d'un lien Google Maps / WhatsApp
// (les liens courts maps.app.goo.gl doivent être suivis côté serveur)
const rateLimit = require('express-rate-limit');
const positionLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { succes: false, message: 'Trop de demandes, patientez une minute.' } });
router.get('/position', positionLimiter, ah(async (req, res) => {
  const lien = String(req.query.lien || '').slice(0, 2000);
  const position = await require('../services/domicileService').positionDepuisLien(lien);
  if (!position) return res.status(422).json({ succes: false, message: 'Position non reconnue dans ce lien.' });
  res.json({ succes: true, position });
}));

// ── GET /api/config/admin ── config complète (agences fermées comprises)
router.get('/admin', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  res.json({ succes: true, config: await Config.get() });
}));

// ── PATCH /api/config/admin ── modifier tarifs, taux, agences…
const nombre = (v, min = 0) => { const n = parseFloat(v); return Number.isFinite(n) && n >= min ? n : undefined; };
const codeValide = (s) => /^[A-Z0-9_-]{2,20}$/.test(s);

router.patch('/admin', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  Config.invalider();
  const actuel = await Config.get();
  const doc = await Config.findById(actuel._id);
  const b = req.body || {};

  // Tarifs par sens : { 'FR-GN': { devise, air: { prixKg, poidsMin }, mer: {…} } }
  if (b.tarifs && typeof b.tarifs === 'object') {
    const tarifs = JSON.parse(JSON.stringify(actuel.tarifs || {}));
    for (const s of SENS) {
      const t = b.tarifs[s.key];
      if (!t) continue;
      tarifs[s.key] = tarifs[s.key] || { devise: PAYS[s.depart].devise, air: {}, mer: {} };
      if (['EUR', 'GNF'].includes(t.devise)) tarifs[s.key].devise = t.devise;
      for (const mode of ['air', 'mer']) {
        if (!t[mode]) continue;
        const prix = nombre(t[mode].prixKg, 0.01);
        const min = nombre(t[mode].poidsMin, 0);
        tarifs[s.key][mode] = tarifs[s.key][mode] || {};
        if (prix !== undefined) tarifs[s.key][mode].prixKg = prix;
        if (min !== undefined) tarifs[s.key][mode].poidsMin = min;
      }
    }
    doc.tarifs = tarifs;
    doc.markModified('tarifs');
  }
  if (b.surcharges && typeof b.surcharges === 'object') {
    const s = { ...(actuel.surcharges || {}) };
    for (const t of TYPES_COLIS) {
      const v = nombre(b.surcharges[t.key]);
      if (v !== undefined && v <= 5) s[t.key] = v;
    }
    doc.surcharges = s;
    doc.markModified('surcharges');
  }
  const assu = nombre(b.tauxAssurance);
  if (assu !== undefined && assu < 1) doc.tauxAssurance = assu;
  const taux = nombre(b.tauxEurGnf, 1);
  if (taux !== undefined && taux !== doc.tauxEurGnf) { doc.tauxEurGnf = taux; doc.tauxMisAJourLe = new Date(); }
  if (b.magasinage) {
    doc.magasinage = { ...(actuel.magasinage || {}) };
    const j = nombre(b.magasinage.joursGratuits);
    const f = nombre(b.magasinage.fraisJourGnf);
    const fe = nombre(b.magasinage.fraisJourEur);
    if (j !== undefined) doc.magasinage.joursGratuits = Math.round(j);
    if (f !== undefined) doc.magasinage.fraisJourGnf = Math.round(f);
    if (fe !== undefined) doc.magasinage.fraisJourEur = fe;
  }
  if (b.domicile && typeof b.domicile === 'object') {
    const dom = JSON.parse(JSON.stringify(actuel.domicile || {}));
    const maj = nombre(b.domicile.majoration, 1);
    if (maj !== undefined && maj <= 3) dom.majoration = maj;
    for (const p of Object.keys(PAYS)) {
      const t = b.domicile[p];
      if (!t) continue;
      dom[p] = dom[p] || {};
      if (typeof t.actif === 'boolean') dom[p].actif = t.actif;
      for (const k of ['base', 'parKm', 'plafond', 'rayonMaxKm']) {
        const v = nombre(t[k]);
        if (v !== undefined) dom[p][k] = v;
      }
    }
    doc.domicile = dom;
    doc.markModified('domicile');
  }
  if (Array.isArray(b.agences)) {
    const { positionDepuisLien } = require('../services/domicileService');
    for (const a of b.agences) {
      // Position : { lat, lng } ou lien Google Maps collé par l'admin
      if (a.lienPosition && String(a.lienPosition).trim()) {
        const pos = await positionDepuisLien(a.lienPosition);
        if (!pos) return res.status(400).json({ succes: false, message: `Position de l'agence ${a.nom || a.code} non reconnue. Collez un lien Google Maps ou « latitude, longitude ».` });
        a.position = pos;
      }
      const lat = parseFloat(a.position?.lat), lng = parseFloat(a.position?.lng);
      a.position = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
      delete a.lienPosition;
    }
    const agences = b.agences
      .map(a => ({ ...a, code: String(a.code || '').toUpperCase().trim(), plateforme: !!a.plateforme, actif: a.actif !== false }))
      .filter(a => codeValide(a.code) && a.nom && PAYS[a.pays]);
    const codes = new Set(agences.map(a => a.code));
    if (codes.size !== agences.length) return res.status(400).json({ succes: false, message: 'Deux agences ont le même code.' });
    for (const p of Object.keys(PAYS)) {
      if (!agences.some(a => a.pays === p && a.actif)) {
        return res.status(400).json({ succes: false, message: `Il faut au moins une agence ouverte en ${PAYS[p].nom}.` });
      }
    }
    // Une agence fermée garde son historique ; on interdit seulement de supprimer une agence encore utilisée
    const supprimees = (actuel.agences || []).filter(a => !codes.has(a.code)).map(a => a.code);
    if (supprimees.length) {
      const Colis = require('../models/Colis');
      const enCours = await Colis.countDocuments({ guichet: { $in: supprimees }, statut: { $nin: ['remis', 'annule'] } });
      if (enCours) return res.status(409).json({ succes: false, message: `${enCours} colis en cours vont vers une agence supprimée. Fermez-la plutôt (décochez « ouverte »).` });
    }
    doc.agences = agences;
  }
  await doc.save();
  Config.invalider();
  res.json({ succes: true, config: await Config.get(), message: 'Configuration enregistrée.' });
}));

module.exports = router;
