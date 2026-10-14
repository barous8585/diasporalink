const router = require('express').Router();
const { creerSession, verifierSession } = require('../controllers/paiementController');
const { ah } = require('../utils/http');

// Le webhook Stripe est monté dans server.js (il lui faut le corps brut).
// Payer le solde d'un colis ne demande pas de compte : le numéro de suivi suffit
// (la famille peut payer pour le destinataire).
router.post('/creer-session', ah(creerSession));
router.get('/verifier/:sessionId', ah(verifierSession));

// Mobile money : à brancher (Orange Money, MTN MoMo) via un agrégateur.
router.post('/mobile-money', (req, res) => {
  res.status(501).json({ succes: false, message: 'Paiement Orange Money / MTN MoMo bientôt disponible. Payez au guichet en attendant.' });
});

module.exports = router;
