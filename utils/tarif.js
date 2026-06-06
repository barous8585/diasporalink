const { PRIX_KG, FRAIS_PICKUP, TAUX_ASSURANCE, POIDS_MIN } = require('../config/constants');

/**
 * Calcule le tarif d'un colis
 * @param {string} pays - Code pays destination
 * @param {number} poidsKg - Poids en kg
 * @param {number} valeurDeclare - Valeur déclarée en €
 * @returns {object} Détail du tarif
 */
const calculerTarif = (pays, poidsKg, valeurDeclare = 0) => {
  const poids = Math.max(parseFloat(poidsKg) || 0, POIDS_MIN);
  const valeur = parseFloat(valeurDeclare) || 0;

  const prixKg = PRIX_KG[pays] || 8.0;
  const fraisTransport = poids * prixKg;
  const fraisAssurance = valeur > 0 ? valeur * TAUX_ASSURANCE : 0;
  const total = FRAIS_PICKUP + fraisTransport + fraisAssurance;

  return {
    fraisCollecte:  parseFloat(FRAIS_PICKUP.toFixed(2)),
    fraisTransport: parseFloat(fraisTransport.toFixed(2)),
    fraisAssurance: parseFloat(fraisAssurance.toFixed(2)),
    total:          parseFloat(total.toFixed(2)),
    prixKg,
    poids,
  };
};

module.exports = { calculerTarif };
