const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Colis = require('../models/Colis');

// ── POST /api/paiements/intention ─────────
// Créer une intention de paiement Stripe
const creerIntention = async (req, res) => {
  try {
    const { colisId } = req.body;

    const colis = await Colis.findOne({ _id: colisId, client: req.user._id });
    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }

    if (colis.paiementStatut === 'paye') {
      return res.status(400).json({ succes: false, message: 'Colis déjà payé.' });
    }

    const montantCentimes = Math.round(colis.tarif.total * 100);

    const intention = await stripe.paymentIntents.create({
      amount: montantCentimes,
      currency: 'eur',
      metadata: {
        colisId: colis._id.toString(),
        numeroSuivi: colis.numeroSuivi,
        clientId: req.user._id.toString(),
      },
      description: `DiasporaLink — Colis ${colis.numeroSuivi} vers ${colis.villeDestination}`,
      receipt_email: req.user.email || undefined,
    });

    res.json({
      succes: true,
      clientSecret: intention.client_secret,
      montant: colis.tarif.total,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ succes: false, message: 'Erreur paiement.' });
  }
};

// ── POST /api/paiements/webhook ───────────
// Webhook Stripe — appelé par Stripe après paiement
const webhookStripe = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const colisId = intent.metadata.colisId;

    try {
      await Colis.findByIdAndUpdate(colisId, {
        paiementId:      intent.id,
        paiementStatut:  'paye',
        paiementMethode: 'carte',
        statut:          'confirme',
        'etapes.0.statut':     'fait',
        'etapes.0.completeLe': new Date(),
        'etapes.1.statut':     'en_cours',
      });
      console.log(`✅ Paiement confirmé : colis ${colisId}`);
    } catch (e) {
      console.error('Erreur MAJ colis :', e);
    }
  }

  res.json({ recu: true });
};

// ── GET /api/paiements/historique ─────────
const historiquePaiements = async (req, res) => {
  try {
    const colis = await Colis.find({
      client: req.user._id,
      paiementStatut: 'paye',
    })
    .select('numeroSuivi tarif.total paysDestination villeDestination statut createdAt')
    .sort({ createdAt: -1 });

    res.json({ succes: true, paiements: colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

module.exports = { creerIntention, webhookStripe, historiquePaiements };
