const { validationResult } = require('express-validator');

// Enveloppe les contrôleurs async : toute erreur part vers le gestionnaire global.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Renvoie 400 si express-validator a trouvé des erreurs.
const valider = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ succes: false, message: errors.array()[0].msg, erreurs: errors.array() });
  }
  next();
};

module.exports = { ah, valider };
