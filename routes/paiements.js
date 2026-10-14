const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/paiementController');
const { auth, role } = require('../middleware/auth');
const { ah } = require('../utils/http');
const { ROLES } = require('../config/constants');

// Le webhook Stripe est monté dans server.js (il lui faut le corps brut).
// Payer un colis ne demande pas de compte : le numéro de suivi suffit
// (la famille peut payer pour l'expéditeur ou le destinataire).
const limite = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { succes: false, message: 'Trop d\'essais, patientez un peu.' } });
router.get('/a-payer/:numero', limite, ah(c.resumeAPayer));
router.post('/creer-session', limite, ah(c.creerSession));
router.get('/verifier/:sessionId', ah(c.verifierSession));

// Orange Money / MTN MoMo : le client déclare son envoi, l'équipe le vérifie
router.post('/mobile', limite, ah(c.declarerMobile));
router.get('/declarations', auth, role(ROLES.ADMIN), ah(c.listeDeclarations));
router.post('/declarations/:id', auth, role(ROLES.ADMIN), ah(c.traiterDeclaration));

module.exports = router;
