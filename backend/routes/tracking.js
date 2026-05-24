// ── routes/tracking.js ─────────────────────────────────────
const trackingRouter = require('express').Router();
const auth = require('../middleware/auth');
const Pickup = require('../models/Pickup');

// GET /api/tracking — tous les colis actifs
trackingRouter.get('/', auth, async (req, res) => {
  try {
    const pickups = await Pickup.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .select('trackingId status steps destinationCountry destinationCity recipientName pricing.total createdAt');
    res.json({ pickups });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/tracking/:trackingId — suivi d'un colis spécifique
trackingRouter.get('/:trackingId', auth, async (req, res) => {
  try {
    const pickup = await Pickup.findOne({
      trackingId: req.params.trackingId,
      user: req.user._id
    });
    if (!pickup) return res.status(404).json({ error: 'Colis introuvable.' });
    res.json({ pickup });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = trackingRouter;
