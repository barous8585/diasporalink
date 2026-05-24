const router = require('express').Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const auth = require('../middleware/auth');
const Pickup = require('../models/Pickup');

// ── POST /api/payments/intent ──────────────────────────────
// Crée un PaymentIntent Stripe pour un pick-up
router.post('/intent', auth, async (req, res) => {
  try {
    const { pickupId } = req.body;
    const pickup = await Pickup.findOne({ _id: pickupId, user: req.user._id });
    if (!pickup) return res.status(404).json({ error: 'Colis introuvable.' });
    if (pickup.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'Ce colis est déjà payé.' });
    }

    const amount = Math.round(pickup.pricing.total * 100); // en centimes

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'eur',
      metadata: {
        pickupId:   pickup._id.toString(),
        trackingId: pickup.trackingId,
        userId:     req.user._id.toString()
      },
      description: `DiasporaLink - Colis ${pickup.trackingId} vers ${pickup.destinationCity}`,
      receipt_email: req.user.email || undefined
    });

    res.json({ clientSecret: intent.client_secret, amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur création paiement.' });
  }
});

// ── POST /api/payments/webhook ─────────────────────────────
// Webhook Stripe — appelé directement depuis server.js avec raw body
const webhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const pickupId = intent.metadata.pickupId;
    try {
      await Pickup.findByIdAndUpdate(pickupId, {
        paymentId: intent.id,
        paymentStatus: 'paid',
        status: 'confirmed'
      });
      console.log(`✅ Paiement confirmé pour le colis ${pickupId}`);
    } catch (e) {
      console.error('Erreur MAJ BDD après paiement :', e);
    }
  }

  res.json({ received: true });
};

// ── GET /api/payments/history ──────────────────────────────
router.get('/history', auth, async (req, res) => {
  try {
    const pickups = await Pickup.find({ user: req.user._id, paymentStatus: 'paid' })
      .select('trackingId pricing.total destinationCountry destinationCity status createdAt')
      .sort({ createdAt: -1 });
    res.json({ payments: pickups });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.webhook = webhook;
module.exports = router;
