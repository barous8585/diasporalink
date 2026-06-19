const { PRIX_KG, FRAIS_PICKUP, TAUX_ASSURANCE, POIDS_MIN } = require('../config/constants');

/**
 * Calcule le tarif d'un colis.
 * Tente de lire depuis MongoDB (Tarif), fallback sur constants.js si erreur.
 */
const calculerTarif = async (pays, poidsKg, valeurDeclare = 0) => {
  let fraisPickup   = FRAIS_PICKUP;
  let tauxAssurance = TAUX_ASSURANCE;
  let poidsMin      = POIDS_MIN;
  let prixKgMap     = PRIX_KG;

  try {
    const Tarif  = require('../models/Tarif');
    const config = await Tarif.getConfig();
    fraisPickup   = config.fraisPickup;
    tauxAssurance = config.tauxAssurance;
    poidsMin      = config.poidsMin;
    prixKgMap     = Object.fromEntries(config.prixKg);
  } catch (e) {
    console.warn('[tarif] MongoDB indisponible, fallback constants.js :', e.message);
  }

  const poids          = Math.max(parseFloat(poidsKg) || 0, poidsMin);
  const valeur         = parseFloat(valeurDeclare) || 0;
  const prixKg         = prixKgMap[pays] || 8.0;
  const fraisTransport = poids * prixKg;
  const fraisAssurance = valeur > 0 ? valeur * tauxAssurance : 0;
  const total          = fraisPickup + fraisTransport + fraisAssurance;

  return {
    fraisCollecte:  parseFloat(fraisPickup.toFixed(2)),
    fraisTransport: parseFloat(fraisTransport.toFixed(2)),
    fraisAssurance: parseFloat(fraisAssurance.toFixed(2)),
    total:          parseFloat(total.toFixed(2)),
    prixKg,
    poids,
  };
};

module.exports = { calculerTarif };
