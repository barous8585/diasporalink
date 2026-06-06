const router = require('express').Router();
const { body } = require('express-validator');
const { auth } = require('../middleware/auth');
const { lireMessages, envoyerMessage } = require('../controllers/messageController');

router.get('/:colisId', auth, lireMessages);

router.post('/:colisId', auth, [
  body('texte').trim().notEmpty().isLength({ max: 1000 }),
], envoyerMessage);

module.exports = router;
