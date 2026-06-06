const router = require('express').Router();
const { body } = require('express-validator');
const { envoyerOtpCtrl, verifierOtpCtrl, moiCtrl } = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// Envoyer OTP
router.post('/envoyer-otp', [
  body('telephone').isMobilePhone().withMessage('Numéro de téléphone invalide'),
  body('prenom').optional().trim().notEmpty(),
  body('nom').optional().trim().notEmpty(),
], envoyerOtpCtrl);

// Vérifier OTP
router.post('/verifier-otp', [
  body('telephone').isMobilePhone(),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code OTP invalide'),
], verifierOtpCtrl);

// Profil connecté
router.get('/moi', auth, moiCtrl);

module.exports = router;
