const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Colis  = require('../models/Colis');

// ── POST /api/paiements/creer-session ────
const creerSession = async (req, res) => {
  try {
    const { colisId } = req.body;
    if (!colisId) {
      return res.status(400).json({ succes: false, message: 'colisId requis.' });
    }

    const colis = await Colis.findOne({ _id: colisId, client: req.user._id });
    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }
    if (colis.paiementStatut === 'paye') {
      return res.status(400).json({ succes: false, message: 'Colis déjà payé.' });
    }

    const montantCentimes = Math.round((colis.tarif?.total || 0) * 100);
    if (montantCentimes < 50) {
      return res.status(400).json({ succes: false, message: 'Montant trop faible.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode:                 'payment',
      locale:               'fr',
      line_items: [{
        price_data: {
          currency:     'eur',
          unit_amount:  montantCentimes,
          product_data: {
            name:        `DiasporaLink — Colis #${colis.numeroSuivi}`,
            description: `Collecte + livraison vers ${colis.villeDestination}, ${colis.paysDestination}`,
          },
        },
        quantity: 1,
      }],
      metadata: {
        colisId:     colis._id.toString(),
        numeroSuivi: colis.numeroSuivi,
        clientId:    req.user._id.toString(),
      },
      success_url: `${process.env.FRONTEND_URL}/paiement-succes.html?session_id={CHECKOUT_SESSION_ID}&colis=${colis._id}`,
      cancel_url:  `${process.env.FRONTEND_URL}?paiement=annule`,
    });

    res.json({ succes: true, url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[paiement/creer-session]', err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── POST /api/paiements/webhook ───────────
// ⚠️ raw body déjà géré dans server.js avant express.json
const webhookStripe = async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[webhook] Signature invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const colisId = session.metadata?.colisId;
    if (colisId) {
      try {
        await Colis.findByIdAndUpdate(colisId, {
          paiementStatut:  'paye',
          paiementSession: session.id,
        });
        console.log(`[webhook] Colis ${colisId} marqué payé ✓`);
      } catch (err) {
        console.error('[webhook] Erreur update colis:', err);
      }
    }
  }

  res.json({ received: true });
};

// ── GET /api/paiements/verifier/:sessionId
const verifierSession = async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const colisId = session.metadata?.colisId;

    if (session.payment_status === 'paid' && colisId) {
      // Sécurité : forcer la mise à jour si le webhook a été lent
      await Colis.findByIdAndUpdate(colisId, {
        paiementStatut:  'paye',
        paiementSession: session.id,
      });
      const colis = await Colis.findById(colisId)
        .populate('client',  'prenom nom telephone')
        .populate('livreur', 'prenom nom telephone');
      return res.json({ succes: true, paye: true, colis });
    }

    res.json({ succes: true, paye: false });
  } catch (err) {
    console.error('[paiement/verifier]', err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

module.exports = { creerSession, webhookStripe, verifierSession };
