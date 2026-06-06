const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { creerIntention, webhookStripe, historiquePaiements } = require('../controllers/paiementController');

// Webhook Stripe (raw body — déclaré en dehors d'express.json)
router.post('/webhook', webhookStripe);

// Créer intention de paiement
router.post('/intention', auth, creerIntention);

// Historique
router.get('/historique', auth, historiquePaiements);

module.exports = router;
