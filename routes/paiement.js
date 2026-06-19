const router = require('express').Router();
const { auth } = require('../middleware/auth');
const {
  creerSession,
  webhook,
  verifierSession,
} = require('../controllers/paiementController');

// Webhook Stripe — RAW body obligatoire, PAS de auth JWT
router.post('/webhook', webhook);

// Routes protégées
router.post('/creer-session',          auth, creerSession);
router.get('/verifier/:sessionId',     auth, verifierSession);

module.exports = router;
