const router = require('express').Router();
const { body } = require('express-validator');
const {
  connexionCtrl, inscriptionCtrl, changerMotDePasseCtrl, envoyerOtpCtrl, verifierOtpCtrl, moiCtrl, googleCtrl, lierGoogleCtrl,
} = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');

// ── Connexion par mot de passe ──
router.post('/connexion', [
  body('telephone').trim().notEmpty().withMessage('Numéro de téléphone requis'),
  body('motDePasse').notEmpty().withMessage('Mot de passe requis'),
], valider, ah(connexionCtrl));

router.post('/inscription', [
  body('telephone').trim().notEmpty().withMessage('Numéro de téléphone requis'),
  body('prenom').trim().notEmpty().withMessage('Prénom requis'),
  body('nom').trim().notEmpty().withMessage('Nom requis'),
  body('motDePasse').isLength({ min: 8, max: 100 }).withMessage('Mot de passe : 8 caractères minimum'),
], valider, ah(inscriptionCtrl));

router.patch('/mot-de-passe', auth, [
  body('actuel').optional().isString(),
  body('nouveau').isLength({ min: 8, max: 100 }).withMessage('Nouveau mot de passe : 8 caractères minimum'),
], valider, ah(changerMotDePasseCtrl));

// ── Connexion par SMS (désactivée tant qu'aucun fournisseur SMS n'est branché) ──
router.post('/envoyer-otp', [
  body('telephone').trim().notEmpty().withMessage('Numéro de téléphone requis'),
], valider, ah(envoyerOtpCtrl));

router.post('/verifier-otp', [
  body('telephone').trim().notEmpty().withMessage('Numéro requis'),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code à 6 chiffres'),
], valider, ah(verifierOtpCtrl));

router.get('/moi', auth, moiCtrl);

// ── Connexion avec Google (espace client) ──
router.post('/google', [body('credential').isString().isLength({ min: 20, max: 5000 }).withMessage('Connexion Google invalide')], valider, ah(googleCtrl));
router.post('/google/lier', auth, [body('credential').isString().isLength({ min: 20, max: 5000 }).withMessage('Connexion Google invalide')], valider, ah(lierGoogleCtrl));

module.exports = router;
