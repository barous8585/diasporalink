// ─────────────────────────────────────────────────────────────
//  Paiement en ligne par carte (Stripe) du solde d'un colis.
//  Orange Money / MTN MoMo : à brancher en v2 (agrégateur local).
// ─────────────────────────────────────────────────────────────
const Colis  = require('../models/Colis');
const Config = require('../models/Config');
const { calculerSolde } = require('../utils/tarif');
const { APP_NOM, STATUTS } = require('../config/constants');

let stripe = null;
const getStripe = () => {
  if (!stripe && process.env.STRIPE_SECRET_KEY) stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripe;
};

// Enregistre un paiement Stripe une seule fois (webhook et vérification peuvent arriver tous les deux)
async function enregistrerPaiementStripe(session) {
  const colis = await Colis.findById(session.metadata?.colisId);
  if (!colis) return null;
  if (colis.paiements.some(p => p.reference === session.id)) return colis;
  colis.paiements.push({
    montant: session.amount_total / 100, devise: 'EUR', methode: 'carte',
    lieu: 'EN_LIGNE', reference: session.id, le: new Date(),
  });
  colis.historique.push({ label: 'Paiement par carte reçu', detail: `${session.amount_total / 100} €`, le: new Date() });
  await colis.save();
  return colis;
}

// ── POST /api/paiements/creer-session ── { numero }
const creerSession = async (req, res) => {
  if (!getStripe()) return res.status(503).json({ succes: false, message: 'Paiement par carte non configuré.' });
  const colis = await Colis.findOne({ numeroSuivi: String(req.body.numero || '').toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  if ([STATUTS.REMIS, STATUTS.ANNULE].includes(colis.statut)) return res.status(409).json({ succes: false, message: 'Ce colis n\'attend plus de paiement.' });
  if (colis.tarif?.estime) return res.status(409).json({ succes: false, message: 'Le prix sera fixé à la pesée au dépôt. Payez à ce moment-là.' });

  const config = await Config.get();
  const { soldeEur } = calculerSolde(colis, config);
  const centimes = Math.round(soldeEur * 100);
  if (centimes < 50) return res.status(400).json({ succes: false, message: 'Rien à payer.' });

  const session = await getStripe().checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    locale: 'fr',
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: centimes,
        product_data: { name: `${APP_NOM} — colis ${colis.numeroSuivi}` },
      },
      quantity: 1,
    }],
    metadata: { colisId: colis._id.toString(), numeroSuivi: colis.numeroSuivi },
    success_url: `${process.env.FRONTEND_URL}/paiement-succes.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.FRONTEND_URL}/?suivi=${colis.numeroSuivi}`,
  });
  res.json({ succes: true, url: session.url });
};

// ── POST /api/paiements/webhook ── (raw body, monté dans server.js)
const webhookStripe = async (req, res) => {
  if (!getStripe()) return res.status(503).end();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed' && event.data.object.payment_status === 'paid') {
    await enregistrerPaiementStripe(event.data.object);
  }
  res.json({ received: true });
};

// ── GET /api/paiements/verifier/:sessionId
const verifierSession = async (req, res) => {
  if (!getStripe()) return res.status(503).json({ succes: false, message: 'Paiement par carte non configuré.' });
  const session = await getStripe().checkout.sessions.retrieve(req.params.sessionId);
  if (session.payment_status !== 'paid') return res.json({ succes: true, paye: false });
  const colis = await enregistrerPaiementStripe(session);
  res.json({ succes: true, paye: true, numeroSuivi: colis?.numeroSuivi });
};

module.exports = { creerSession, webhookStripe, verifierSession };
