const router = require('express').Router();
const Tarif  = require('../models/Tarif');
const { auth, role } = require('../middleware/auth');
const { PAYS, CRENEAUX, TYPES_COLIS } = require('../config/constants');

// ── GET /api/config ───────────────────────
// Données publiques enrichies avec les prix MongoDB
router.get('/', async (req, res) => {
  try {
    const config = await Tarif.getConfig();
    const prixKg = Object.fromEntries(config.prixKg);

    const paysAvecPrix = PAYS.map(p => ({
      ...p,
      prixKg: prixKg[p.code] || 8.0,
    }));

    res.json({
      succes:     true,
      pays:       paysAvecPrix,
      creneaux:   CRENEAUX,
      typesColis: TYPES_COLIS,
    });
  } catch (e) {
    console.warn('[config] Fallback constants.js :', e.message);
    res.json({
      succes:     true,
      pays:       PAYS,
      creneaux:   CRENEAUX,
      typesColis: TYPES_COLIS,
    });
  }
});

// ── GET /api/config/tarifs ────────────────
// Lire les tarifs (admin uniquement)
router.get('/tarifs', auth, role('admin'), async (req, res) => {
  try {
    const config = await Tarif.getConfig();
    res.json({
      succes:        true,
      prixKg:        Object.fromEntries(config.prixKg),
      fraisPickup:   config.fraisPickup,
      tauxAssurance: config.tauxAssurance,
      poidsMin:      config.poidsMin,
    });
  } catch (err) {
    console.error('[config/tarifs GET]', err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
});

// ── PATCH /api/config/tarifs ──────────────
// Sauvegarder les tarifs (admin uniquement)
router.patch('/tarifs', auth, role('admin'), async (req, res) => {
  try {
    const { prixKg, fraisPickup, tauxAssurance } = req.body;
    const config = await Tarif.getConfig();

    if (prixKg && typeof prixKg === 'object') {
      Object.entries(prixKg).forEach(([code, prix]) => {
        const val = parseFloat(prix);
        if (!isNaN(val) && val > 0) config.prixKg.set(code, val);
      });
    }

    if (fraisPickup !== undefined) {
      const val = parseFloat(fraisPickup);
      if (!isNaN(val) && val >= 0) config.fraisPickup = val;
    }

    if (tauxAssurance !== undefined) {
      const val = parseFloat(tauxAssurance);
      // Frontend envoie en % → on divise par 100 pour stocker en décimal
      if (!isNaN(val) && val >= 0) config.tauxAssurance = val / 100;
    }

    config.markModified('prixKg');
    await config.save();

    res.json({
      succes:  true,
      message: 'Tarifs mis à jour et synchronisés.',
    });
  } catch (err) {
    console.error('[config/tarifs PATCH]', err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;
