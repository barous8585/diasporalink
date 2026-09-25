const router = require('express').Router();
const Config = require('../models/Config');
const { auth, role } = require('../middleware/auth');
const { ah } = require('../utils/http');
const {
  APP_NOM, MODES_INFO, TYPES_COLIS, METHODES_PAIEMENT, STATUTS_LABELS, ROLES,
} = require('../config/constants');

// ── GET /api/config ── données publiques pour les 3 apps
router.get('/', ah(async (req, res) => {
  const c = await Config.get();
  res.json({
    succes: true,
    app: APP_NOM,
    modes: MODES_INFO.map(m => ({ ...m, ...c.tarifs[m.key] })),
    typesColis: TYPES_COLIS.map(t => ({ ...t, surcharge: c.surcharges?.[t.key] ?? t.surcharge })),
    tauxAssurance: c.tauxAssurance,
    tauxEurGnf: c.tauxEurGnf,
    tauxMisAJourLe: c.tauxMisAJourLe,
    magasinage: c.magasinage,
    depots: c.depots,
    guichets: c.guichets,
    methodesPaiement: METHODES_PAIEMENT,
    statuts: STATUTS_LABELS,
    // Même forme que la config serveur : utilisée par KolisTarif côté navigateur
    regles: {
      tarifs: c.tarifs, surcharges: c.surcharges, tauxAssurance: c.tauxAssurance,
      tauxEurGnf: c.tauxEurGnf, magasinage: c.magasinage,
    },
  });
}));

// ── GET /api/config/admin ── config complète
router.get('/admin', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  res.json({ succes: true, config: await Config.get() });
}));

// ── PATCH /api/config/admin ── modifier tarifs, taux, guichets…
const nombre = (v, min = 0) => { const n = parseFloat(v); return Number.isFinite(n) && n >= min ? n : undefined; };
const codeValide = (s) => /^[A-Z0-9_-]{2,20}$/.test(s);

router.patch('/admin', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  Config.invalider();
  const actuel = await Config.get();
  const doc = await Config.findById(actuel._id);
  const b = req.body || {};

  for (const mode of ['air', 'mer']) {
    if (b.tarifs?.[mode]) {
      const prix = nombre(b.tarifs[mode].prixKg, 0.01);
      const min = nombre(b.tarifs[mode].poidsMin, 0);
      if (prix !== undefined) doc.tarifs[mode].prixKg = prix;
      if (min !== undefined) doc.tarifs[mode].poidsMin = min;
    }
  }
  if (b.surcharges && typeof b.surcharges === 'object') {
    const s = { ...(doc.surcharges || {}) };
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
    const j = nombre(b.magasinage.joursGratuits);
    const f = nombre(b.magasinage.fraisJourGnf);
    if (j !== undefined) doc.magasinage.joursGratuits = Math.round(j);
    if (f !== undefined) doc.magasinage.fraisJourGnf = Math.round(f);
  }
  for (const liste of ['depots', 'guichets']) {
    if (Array.isArray(b[liste])) {
      const lieux = b[liste]
        .map(l => ({ ...l, code: String(l.code || '').toUpperCase().trim() }))
        .filter(l => codeValide(l.code) && l.nom);
      if (!lieux.length) return res.status(400).json({ succes: false, message: `Au moins un ${liste === 'depots' ? 'dépôt' : 'guichet'} requis.` });
      doc[liste] = lieux;
    }
  }
  await doc.save();
  Config.invalider();
  res.json({ succes: true, config: await Config.get(), message: 'Configuration enregistrée.' });
}));

module.exports = router;
