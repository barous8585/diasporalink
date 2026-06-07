const router = require('express').Router();
const { body } = require('express-validator');
const { auth, role } = require('../middleware/auth');
const { monProfil, mettreAJourProfil } = require('../controllers/userController');
const User = require('../models/User');
const { ROLES } = require('../config/constants');

router.get('/moi', auth, monProfil);

router.patch('/moi', auth, [
  body('prenom').optional().trim().notEmpty(),
  body('nom').optional().trim().notEmpty(),
  body('email').optional().isEmail(),
  body('adresse').optional().trim(),
  body('ville').optional().trim(),
], mettreAJourProfil);

// ── GET /api/utilisateurs/livreurs ────────
// Admin — liste des livreurs
router.get('/livreurs', auth, role(ROLES.ADMIN), async (req, res) => {
  try {
    const livreurs = await User.find({ role: ROLES.LIVREUR })
      .select('prenom nom telephone')
      .sort({ prenom: 1 });
    res.json({ succes: true, livreurs });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
});

// ── GET /api/utilisateurs/clients ─────────
// Admin — liste des clients
router.get('/clients', auth, role(ROLES.ADMIN), async (req, res) => {
  try {
    const clients = await User.find({ role: ROLES.CLIENT })
      .select('prenom nom telephone email createdAt actif')
      .sort({ createdAt: -1 });
    res.json({ succes: true, clients });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;
