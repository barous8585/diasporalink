const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Pickup = require('../models/Pickup');

const PRICE_PER_KG = {
  SN: 7.5, CI: 8.0, CM: 7.8, GN: 8.5,
  ML: 8.2, BF: 8.3, CD: 9.0, MR: 8.6, TG: 8.1
};
const PICKUP_FEE   = 5.0;
const INSURANCE_RATE = 0.023;

const DEFAULT_STEPS = [
  { label: 'Pick-up effectué',         detail: 'En attente de collecte',         status: 'todo' },
  { label: 'Contrôle douanier',        detail: 'En attente',                     status: 'todo' },
  { label: 'En cours de transport',    detail: 'En attente d\'expédition',       status: 'todo' },
  { label: 'Arrivée entrepôt',         detail: 'En attente',                     status: 'todo' },
  { label: 'Livraison au destinataire',detail: 'En attente de livraison finale', status: 'todo' }
];

// ── POST /api/pickups ──────────────────────────────────────
// Créer une nouvelle demande de pick-up
router.post('/', auth, [
  body('pickupAddress').notEmpty(),
  body('pickupCity').notEmpty(),
  body('pickupDate').isISO8601(),
  body('pickupSlot').isIn(['morning', 'afternoon', 'evening']),
  body('destinationCountry').isIn(Object.keys(PRICE_PER_KG)),
  body('destinationCity').notEmpty(),
  body('recipientName').notEmpty(),
  body('recipientPhone').notEmpty(),
  body('packageType').notEmpty(),
  body('weightKg').isFloat({ min: 0.1 }),
  body('declaredValue').optional().isFloat({ min: 0 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { weightKg, declaredValue = 0, destinationCountry } = req.body;
    const ppkg      = PRICE_PER_KG[destinationCountry] || 8.0;
    const transport = weightKg * ppkg;
    const insurance = declaredValue * INSURANCE_RATE;
    const total     = PICKUP_FEE + transport + insurance;

    const pickup = new Pickup({
      ...req.body,
      user: req.user._id,
      pricing: { pickupFee: PICKUP_FEE, transport, insurance, total },
      steps: DEFAULT_STEPS
    });

    await pickup.save();
    res.status(201).json({ pickup });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du pick-up.' });
  }
});

// ── GET /api/pickups ───────────────────────────────────────
// Tous les pick-ups de l'utilisateur connecté
router.get('/', auth, async (req, res) => {
  try {
    const pickups = await Pickup.find({ user: req.user._id })
      .sort({ createdAt: -1 });
    res.json({ pickups });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── GET /api/pickups/:id ───────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const pickup = await Pickup.findOne({ _id: req.params.id, user: req.user._id });
    if (!pickup) return res.status(404).json({ error: 'Colis introuvable.' });
    res.json({ pickup });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── GET /api/pickups/track/:trackingId ────────────────────
// Suivi public par numéro de tracking
router.get('/track/:trackingId', async (req, res) => {
  try {
    const pickup = await Pickup.findOne({ trackingId: req.params.trackingId })
      .select('trackingId status statusLabel steps destinationCountry destinationCity recipientName createdAt');
    if (!pickup) return res.status(404).json({ error: 'Numéro de suivi introuvable.' });
    res.json({ pickup });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── PATCH /api/pickups/:id/status ─────────────────────────
// Mise à jour du statut (admin/livreur)
router.patch('/:id/status', auth, [
  body('status').isIn(['confirmed','picked_up','in_transit','arrived','delivered','cancelled']),
  body('stepIndex').optional().isInt({ min: 0, max: 4 }),
  body('stepDetail').optional().isString()
], async (req, res) => {
  try {
    const { status, stepIndex, stepDetail } = req.body;
    const pickup = await Pickup.findById(req.params.id);
    if (!pickup) return res.status(404).json({ error: 'Colis introuvable.' });

    pickup.status = status;

    if (stepIndex !== undefined) {
      pickup.steps[stepIndex].status = 'done';
      pickup.steps[stepIndex].completedAt = new Date();
      if (stepDetail) pickup.steps[stepIndex].detail = stepDetail;
      if (stepIndex + 1 < pickup.steps.length) {
        pickup.steps[stepIndex + 1].status = 'active';
      }
    }

    await pickup.save();
    res.json({ pickup });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
