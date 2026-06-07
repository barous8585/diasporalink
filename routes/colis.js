const router = require('express').Router();
const { body } = require('express-validator');
const { auth, role } = require('../middleware/auth');
const {
  creerColis, mesColis, unColis,
  suiviPublic, mettreAJourStatut, calculerTarifCtrl, assignerLivreur,
} = require('../controllers/colisController');
const { ROLES } = require('../config/constants');

// Calculer tarif (public)
router.get('/tarif', calculerTarifCtrl);

// Suivi public
router.get('/suivi/:numero', suiviPublic);

// Mes colis
router.get('/', auth, mesColis);

// Détail d'un colis
router.get('/:id', auth, unColis);

// Créer un colis
router.post('/', auth, [
  body('adresseCollecte').notEmpty().withMessage('Adresse de collecte requise'),
  body('villeCollecte').notEmpty(),
  body('dateCollecte').isISO8601().withMessage('Date invalide'),
  body('creneau').isIn(['matin', 'apresmidi', 'soir']),
  body('paysDestination').notEmpty(),
  body('villeDestination').notEmpty(),
  body('nomDestinataire').notEmpty(),
  body('telDestinataire').notEmpty(),
  body('typeColis').notEmpty(),
  body('poidsKg').isFloat({ min: 0.1 }).withMessage('Poids invalide'),
], creerColis);

// Mettre à jour le statut (livreur ou admin)
router.patch('/:id/statut', auth, role(ROLES.LIVREUR, ROLES.ADMIN), [
  body('statut').notEmpty(),
], mettreAJourStatut);

// Assigner un livreur (admin uniquement)
router.patch('/:id/assigner', auth, role(ROLES.ADMIN), [
  body('livreurId').notEmpty().withMessage('Livreur requis'),
], assignerLivreur);

module.exports = router;
