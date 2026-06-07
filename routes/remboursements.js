const router = require('express').Router();
const { body } = require('express-validator');
const { auth, role } = require('../middleware/auth');
const { creerDemande, mesDemandes, toutesLesDemandes, traiterDemande } = require('../controllers/remboursementController');
const { ROLES } = require('../config/constants');

router.get('/mes', auth, mesDemandes);

router.post('/', auth, [
  body('colisId').notEmpty().withMessage('Colis requis'),
  body('motif').isIn(['colis_perdu', 'colis_endommage', 'retard_excessif', 'annulation', 'autre']),
  body('description').optional().trim().isLength({ max: 500 }),
], creerDemande);

router.get('/', auth, role(ROLES.ADMIN), toutesLesDemandes);

router.patch('/:id', auth, role(ROLES.ADMIN), [
  body('statut').isIn(['en_cours', 'approuve', 'refuse', 'rembourse']),
], traiterDemande);

module.exports = router;
