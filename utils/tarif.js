// ─────────────────────────────────────────────────────────────
//  Règles de calcul — fonctions pures (testables sans base)
// ─────────────────────────────────────────────────────────────

const arrondi2 = (n) => Math.round(n * 100) / 100;
// Le GNF n'a pas de centimes : on arrondit aux 500 GNF supérieurs
const arrondiGnf = (n) => Math.ceil(n / 500) * 500;

/**
 * Calcule le prix d'un envoi.
 * @param {object} config  document Config (tarifs, surcharges, tauxAssurance, tauxEurGnf)
 * @param {object} p       { mode, poidsKg, typeColis, valeurDeclaree, assurance }
 */
function calculerTarif(config, { mode, poidsKg, typeColis, valeurDeclaree = 0, assurance = false }) {
  const t = config.tarifs?.[mode];
  if (!t) throw new Error(`Mode de transport inconnu : ${mode}`);

  const poids         = Math.max(parseFloat(poidsKg) || 0, 0);
  const poidsFacture  = Math.max(poids, t.poidsMin || 0);
  const transport     = poidsFacture * t.prixKg;
  const tauxSurcharge = config.surcharges?.[typeColis] || 0;
  const surcharge     = transport * tauxSurcharge;
  const valeur        = parseFloat(valeurDeclaree) || 0;
  const assuranceEur  = assurance && valeur > 0 ? valeur * (config.tauxAssurance || 0) : 0;
  const totalEur      = arrondi2(transport + surcharge + assuranceEur);
  const taux          = config.tauxEurGnf;

  return {
    mode,
    prixKg:        t.prixKg,
    poidsFacture:  arrondi2(poidsFacture),
    transport:     arrondi2(transport),
    surcharge:     arrondi2(surcharge),
    assurance:     arrondi2(assuranceEur),
    totalEur,
    taux,                                 // taux figé sur le colis
    totalGnf:      arrondiGnf(totalEur * taux),
  };
}

/** Frais de magasinage dus à une date donnée (GNF). */
function calculerMagasinage(config, arriveGuichetLe, maintenant = new Date()) {
  if (!arriveGuichetLe) return { jours: 0, joursFactures: 0, fraisGnf: 0, gratuitJusquau: null };
  const { joursGratuits = 0, fraisJourGnf = 0 } = config.magasinage || {};
  const debut  = new Date(arriveGuichetLe);
  const jours  = Math.max(0, Math.floor((maintenant - debut) / 86400000));
  const joursFactures = Math.max(0, jours - joursGratuits);
  const gratuitJusquau = new Date(debut.getTime() + joursGratuits * 86400000);
  return { jours, joursFactures, fraisGnf: joursFactures * fraisJourGnf, gratuitJusquau };
}

/** Convertit un paiement en GNF au taux figé du colis. */
function enGnf(montant, devise, taux) {
  return devise === 'EUR' ? arrondiGnf(montant * taux) : Math.round(montant);
}

/**
 * Solde restant dû sur un colis, en GNF (et équivalent EUR).
 * Dû = transport (totalGnf) + douane + magasinage − paiements.
 */
function calculerSolde(colis, config, maintenant = new Date()) {
  const taux       = colis.tarif?.taux || config.tauxEurGnf;
  const magasinage = calculerMagasinage(config, colis.arriveGuichetLe, maintenant);
  const du = (colis.tarif?.totalGnf || 0) + (colis.fraisDouaneGnf || 0) + magasinage.fraisGnf;
  const paye = (colis.paiements || []).reduce((s, p) => s + enGnf(p.montant, p.devise, taux), 0);
  const soldeGnf = Math.max(0, du - paye);
  return {
    duGnf: du,
    payeGnf: paye,
    soldeGnf,
    soldeEur: arrondi2(soldeGnf / taux),
    magasinage,
  };
}

module.exports = { calculerTarif, calculerMagasinage, calculerSolde, enGnf, arrondiGnf, arrondi2 };
