// ─────────────────────────────────────────────────────────────
//  Règles de calcul — fonctions pures (testables sans base)
//  Ce même fichier est copié dans les apps (npm run sync-apps)
//  pour que l'estimation fonctionne aussi hors-ligne.
// ─────────────────────────────────────────────────────────────
(function (racine) {

const arrondi2 = (n) => Math.round(n * 100) / 100;
// Le GNF n'a pas de centimes : on arrondit aux 500 GNF supérieurs
const arrondiGnf = (n) => Math.ceil(n / 500) * 500;

// Pays d'arrivée d'un sens « FR-GN » → « GN »
const paysArrivee = (sens) => String(sens || 'FR-GN').split('-')[1];

/**
 * Calcule le prix d'un envoi.
 * Le prix au kilo est exprimé dans la devise du sens (€ depuis la France,
 * GNF depuis la Guinée) ; l'autre devise est calculée au taux du jour.
 * @param {object} config  { tarifs: { 'FR-GN': { devise, air, mer }, … }, surcharges, tauxAssurance, tauxEurGnf }
 * @param {object} p       { sens, mode, poidsKg, typeColis, valeurDeclaree, assurance }
 *                         valeurDeclaree est dans la devise du sens.
 */
function calculerTarif(config, { sens = 'FR-GN', mode, poidsKg, typeColis, valeurDeclaree = 0, assurance = false }) {
  const grille = config.tarifs?.[sens];
  if (!grille) throw new Error(`Sens d'envoi inconnu : ${sens}`);
  const t = grille[mode];
  if (!t) throw new Error(`Mode de transport inconnu : ${mode}`);
  const devise = grille.devise || 'EUR';
  const taux = config.tauxEurGnf;

  const poids         = Math.max(parseFloat(poidsKg) || 0, 0);
  const poidsFacture  = Math.max(poids, t.poidsMin || 0);
  const transport     = poidsFacture * t.prixKg;
  const tauxSurcharge = config.surcharges?.[typeColis] || 0;
  const surcharge     = transport * tauxSurcharge;
  const valeur        = parseFloat(valeurDeclaree) || 0;
  const assuranceMt   = assurance && valeur > 0 ? valeur * (config.tauxAssurance || 0) : 0;
  const brut          = transport + surcharge + assuranceMt;

  // Montant de référence dans la devise du sens, puis conversion
  const totalGnf = devise === 'GNF' ? arrondiGnf(brut) : arrondiGnf(arrondi2(brut) * taux);
  const totalEur = devise === 'GNF' ? arrondi2(totalGnf / taux) : arrondi2(brut);
  const arr = devise === 'GNF' ? Math.round : arrondi2;

  return {
    sens,
    mode,
    devise,
    prixKg:        t.prixKg,
    poidsFacture:  arrondi2(poidsFacture),
    transport:     arr(transport),
    surcharge:     arr(surcharge),
    assurance:     arr(assuranceMt),
    total:         devise === 'GNF' ? totalGnf : totalEur, // dans la devise du sens
    totalEur,
    taux,                                 // taux figé sur le colis
    totalGnf,
  };
}

/**
 * Frais de garde dus à une date donnée, en GNF (référence de calcul).
 * En France, le tarif journalier est en € et converti au taux du colis.
 */
function calculerMagasinage(config, arriveGuichetLe, maintenant = new Date(), { pays = 'GN', taux } = {}) {
  if (!arriveGuichetLe) return { jours: 0, joursFactures: 0, fraisGnf: 0, gratuitJusquau: null };
  const { joursGratuits = 0, fraisJourGnf = 0, fraisJourEur = 0 } = config.magasinage || {};
  const debut  = new Date(arriveGuichetLe);
  const jours  = Math.max(0, Math.floor((maintenant - debut) / 86400000));
  const joursFactures = Math.max(0, jours - joursGratuits);
  const gratuitJusquau = new Date(debut.getTime() + joursGratuits * 86400000);
  const parJourGnf = pays === 'FR' ? arrondiGnf(fraisJourEur * (taux || config.tauxEurGnf)) : fraisJourGnf;
  return { jours, joursFactures, fraisGnf: joursFactures * parJourGnf, gratuitJusquau };
}

/** Convertit un paiement en GNF au taux figé du colis. */
function enGnf(montant, devise, taux) {
  return devise === 'EUR' ? arrondiGnf(montant * taux) : Math.round(montant);
}

/**
 * Solde restant dû sur un colis, en GNF (et équivalent EUR).
 * Dû = transport (totalGnf) + douane + garde − paiements.
 */
function calculerSolde(colis, config, maintenant = new Date()) {
  const taux       = colis.tarif?.taux || config.tauxEurGnf;
  const magasinage = calculerMagasinage(config, colis.arriveGuichetLe, maintenant, { pays: paysArrivee(colis.sens), taux });
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

const api = { calculerTarif, calculerMagasinage, calculerSolde, enGnf, arrondiGnf, arrondi2, paysArrivee };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else racine.KolisTarif = api;
})(typeof window !== 'undefined' ? window : globalThis);
