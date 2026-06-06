const router = require('express').Router();
const { PAYS, CRENEAUX, TYPES_COLIS } = require('../config/constants');

// Données publiques utilisées par le frontend
router.get('/', (req, res) => {
  res.json({
    succes: true,
    pays: PAYS,
    creneaux: CRENEAUX,
    typesColis: TYPES_COLIS,
  });
});

module.exports = router;
