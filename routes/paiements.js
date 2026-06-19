const router = require('express').Router();
const { auth } = require('../middleware/auth');
const {
  creerSession,
  verifierSession,
} = require('../controllers/paiementController');

// ⚠️ Le webhook est monté directement dans server.js
// car il nécessite le raw body AVANT express.json

// Routes protégées par JWT
router.post('/creer-session',      auth, creerSession);
router.get('/verifier/:sessionId', auth, verifierSession);

module.exports = router;
