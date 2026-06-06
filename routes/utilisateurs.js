const router = require('express').Router();
const { body } = require('express-validator');
const { auth } = require('../middleware/auth');
const { monProfil, mettreAJourProfil } = require('../controllers/userController');

router.get('/moi', auth, monProfil);

router.patch('/moi', auth, [
  body('prenom').optional().trim().notEmpty(),
  body('nom').optional().trim().notEmpty(),
  body('email').optional().isEmail(),
  body('adresse').optional().trim(),
  body('ville').optional().trim(),
], mettreAJourProfil);

module.exports = router;
