const router = require('express').Router();
const { body } = require('express-validator');
const { envoyerOtpCtrl, verifierOtpCtrl, moiCtrl } = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');

router.post('/envoyer-otp', [
  body('telephone').trim().notEmpty().withMessage('Numéro de téléphone requis'),
  body('prenom').optional().trim(),
  body('nom').optional().trim(),
], valider, ah(envoyerOtpCtrl));

router.post('/verifier-otp', [
  body('telephone').trim().notEmpty().withMessage('Numéro requis'),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code à 6 chiffres'),
], valider, ah(verifierOtpCtrl));

router.get('/moi', auth, moiCtrl);

module.exports = router;
