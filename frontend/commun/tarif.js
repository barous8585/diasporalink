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
 * Articles facturés à la pièce (chaussures, téléphone…) : prix fixe par sens et par mode,
 * dans la devise du sens. Chaque article « compte » pour un poids forfaitaire, retiré
 * du poids pesé : le reste (vêtements, vivres…) est facturé au kilo.
 * @param articles [{ cle, quantite }] ; les articles inconnus ou fermés sont ignorés.
 */
function chiffrerArticles(config, sens, mode, articles) {
  const catalogue = config.articles || [];
  const lignes = [];
  for (const a of Array.isArray(articles) ? articles : []) {
    const quantite = Math.min(Math.max(parseInt(a?.quantite, 10) || 0, 0), 99);
    const art = catalogue.find(x => x.cle === a?.cle && x.actif !== false);
    // Express sans prix propre : même prix à la pièce que l'avion
    const prix = parseFloat(art?.prix?.[sens]?.[mode] ?? (mode === 'express' ? art?.prix?.[sens]?.air : undefined));
    if (!quantite || !art || !(prix >= 0)) continue;
    const exist = lignes.find(l => l.cle === art.cle);
    if (exist) { exist.quantite += quantite; exist.montant = exist.quantite * prix; exist.poids = exist.quantite * (art.poids || 0); continue; }
    lignes.push({ cle: art.cle, label: art.label, quantite, prix, montant: quantite * prix, poids: quantite * (parseFloat(art.poids) || 0) });
  }
  return lignes;
}

/**
 * Calcule le prix d'un envoi.
 * Le prix au kilo est exprimé dans la devise du sens (€ depuis la France,
 * GNF depuis la Guinée) ; l'autre devise est calculée au taux du jour.
 * @param {object} config  { tarifs: { 'FR-GN': { devise, air, mer }, … }, surcharges, tauxAssurance, tauxEurGnf, articles }
 * @param {object} p       { sens, mode, poidsKg, typeColis, valeurDeclaree, assurance, articles }
 *                         poidsKg = poids total sur la balance (articles compris).
 *                         valeurDeclaree est dans la devise du sens.
 */
function calculerTarif(config, { sens = 'FR-GN', mode, poidsKg, typeColis, valeurDeclaree = 0, assurance = false, articles = [] }) {
  const grille = config.tarifs?.[sens];
  if (!grille) throw new Error(`Sens d'envoi inconnu : ${sens}`);
  const t = grille[mode];
  if (!t) throw new Error(`Mode de transport inconnu : ${mode}`);
  const devise = grille.devise || 'EUR';
  const taux = config.tauxEurGnf;
  const arr = devise === 'GNF' ? Math.round : arrondi2;

  const lignesArticles = chiffrerArticles(config, sens, mode, articles);
  const poidsArticles  = arrondi2(lignesArticles.reduce((s, l) => s + l.poids, 0));
  const articlesTotal  = lignesArticles.reduce((s, l) => s + l.montant, 0);

  const poids         = Math.max(parseFloat(poidsKg) || 0, 0);
  // Ce qui reste une fois les articles à la pièce retirés est facturé au kilo
  const poidsKilo     = Math.max(arrondi2(poids - poidsArticles), 0);
  // Le minimum facturé ne s'applique pas quand l'envoi contient des articles à la pièce
  const poidsFacture  = lignesArticles.length ? poidsKilo : Math.max(poidsKilo, t.poidsMin || 0);
  const transport     = poidsFacture * t.prixKg;
  const tauxSurcharge = config.surcharges?.[typeColis] || 0;
  const surcharge     = transport * tauxSurcharge;
  const valeur        = parseFloat(valeurDeclaree) || 0;
  const assuranceMt   = assurance && valeur > 0 ? valeur * (config.tauxAssurance || 0) : 0;
  const brut          = transport + surcharge + articlesTotal + assuranceMt;

  // Montant de référence dans la devise du sens, puis conversion
  const totalGnf = devise === 'GNF' ? arrondiGnf(brut) : arrondiGnf(arrondi2(brut) * taux);
  const totalEur = devise === 'GNF' ? arrondi2(totalGnf / taux) : arrondi2(brut);

  return {
    sens,
    mode,
    devise,
    prixKg:        t.prixKg,
    poidsMin:      t.poidsMin || 0,
    poidsFacture:  arrondi2(poidsFacture),
    poidsArticles,
    transport:     arr(transport),
    surcharge:     arr(surcharge),
    articles:      lignesArticles.map(l => ({ ...l, prix: arr(l.prix), montant: arr(l.montant) })),
    articlesTotal: arr(articlesTotal),
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

// ── Courses à domicile ──────────────────────────────────────
const RAYON_TERRE_KM = 6371;
const rad = (d) => d * Math.PI / 180;
const pointValide = (p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng)
  && Math.abs(+p.lat) <= 90 && Math.abs(+p.lng) <= 180 && !(+p.lat === 0 && +p.lng === 0);

/** Distance à vol d'oiseau en km entre deux points { lat, lng }. */
function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON_TERRE_KM * Math.asin(Math.sqrt(h));
}

// Zones des pays desservis (rectangles larges autour du territoire). Sert à refuser une
// position manifestement fausse : une agence de Conakry placée en France, un client en
// Guinée pointé à Paris, un GPS qui renvoie la position de l'ordinateur de bureau…
const ZONES_PAYS = {
  GN: { latMin: 7.0, latMax: 12.8, lngMin: -15.4, lngMax: -7.5, nom: 'Guinée', centre: { lat: 9.5370, lng: -13.6773 } },
  FR: { latMin: 41.2, latMax: 51.2, lngMin: -5.4, lngMax: 9.8, nom: 'France', centre: { lat: 48.8566, lng: 2.3522 } },
};
const pointDansPays = (p, pays) => {
  const z = ZONES_PAYS[pays];
  return !!(z && pointValide(p) && +p.lat >= z.latMin && +p.lat <= z.latMax && +p.lng >= z.lngMin && +p.lng <= z.lngMax);
};
const paysDuPoint = (p) => Object.keys(ZONES_PAYS).find(k => pointDansPays(p, k)) || null;
const nomPays = (k) => ZONES_PAYS[k]?.nom || 'un autre pays';
// Position d'agence utilisable : valide ET dans le pays de l'agence
const agenceBienPlacee = (agence) => pointDansPays(agence?.position, agence?.pays);

/**
 * Prix d'une course (ramassage ou livraison) entre une agence et le client.
 * Prix = base + parKm × distance par la route, arrondi au millier de GNF ou au
 * demi-euro supérieur, plafond facultatif.
 * Distance : celle de l'itinéraire routier si le serveur l'a calculée (routeKm),
 * sinon une estimation (vol d'oiseau × majoration, 1,3 par défaut).
 * @returns { ok, distanceKm, methode, prix, devise, prixGnf } ou { ok:false, raison, message }
 */
function calculerCourse(config, agence, point, { taux, routeKm } = {}) {
  const dom = config.domicile || {};
  const pays = agence?.pays;
  const bareme = dom[pays];
  const devise = pays === 'FR' ? 'EUR' : 'GNF';
  const nomAg = agence?.nom || 'cette agence';
  if (!bareme || bareme.actif === false) return { ok: false, raison: 'indisponible', message: 'Service à domicile pas encore proposé dans ce pays.' };
  if (!pointValide(agence?.position)) return { ok: false, raison: 'agence_sans_position', message: `Service à domicile pas encore proposé par ${nomAg}.` };
  if (!agenceBienPlacee(agence)) {
    return { ok: false, raison: 'agence_mal_placee', message: `Service à domicile momentanément indisponible depuis ${nomAg} : la position de l'agence (hors de ${nomPays(pays)}) doit être corrigée par l'équipe.` };
  }
  if (!pointValide(point)) return { ok: false, raison: 'sans_position', message: 'Position du client nécessaire pour calculer le prix.' };
  if (!pointDansPays(point, pays)) {
    const ou = paysDuPoint(point);
    return { ok: false, raison: 'hors_pays', message: `Cette position est ${ou ? `en ${nomPays(ou)}` : 'hors de la zone desservie'}, pas en ${nomPays(pays)}. Placez l'épingle sur l'adresse en ${nomPays(pays)}, ou écrivez l'adresse.` };
  }
  const volOiseau = distanceKm(agence.position, point);
  const route = Number.isFinite(+routeKm) && +routeKm > 0 ? +routeKm : null;
  const km = Math.max(0.1, Math.round((route ?? volOiseau * (dom.majoration || 1.3)) * 10) / 10);
  const methode = route ? 'route' : 'estimation';
  if (bareme.rayonMaxKm && km > bareme.rayonMaxKm) {
    return { ok: false, raison: 'trop_loin', distanceKm: km, methode, message: `Trop loin de ${nomAg} (${km.toLocaleString('fr-FR')} km par la route, maximum ${bareme.rayonMaxKm} km).` };
  }
  let prix = (bareme.base || 0) + (bareme.parKm || 0) * km;
  if (bareme.plafond > 0) prix = Math.min(prix, bareme.plafond);
  prix = devise === 'GNF' ? Math.ceil(prix / 1000) * 1000 : Math.ceil(prix * 2) / 2;
  const t = taux || config.tauxEurGnf;
  return { ok: true, distanceKm: km, volOiseauKm: Math.round(volOiseau * 10) / 10, methode, prix, devise, prixGnf: enGnf(prix, devise, t) };
}

const courseActive = (c) => !!(c?.demande && c.statut !== 'annulee');
/**
 * Frais des courses à domicile d'un colis, en GNF. Une course payée d'avance reste due
 * (non remboursable) même si elle est annulée ensuite.
 */
function fraisDomicileGnf(colis) {
  let total = 0;
  for (const k of ['ramassage', 'livraison']) {
    const c = colis?.[k];
    if (!c) continue;
    total += courseActive(c) ? Math.max(c.prixGnf || 0, c.payeGnf || 0) : (c.payeGnf || 0);
  }
  return total;
}

/** Courses à domicile pas encore payées d'avance, en GNF (prix connu seulement). */
function domicileAPayerGnf(colis) {
  let total = 0;
  for (const k of ['ramassage', 'livraison']) {
    const c = colis?.[k];
    if (courseActive(c) && c.prixGnf > 0) total += Math.max(0, c.prixGnf - (c.payeGnf || 0));
  }
  return total;
}

/** Convertit un paiement en GNF au taux figé du colis. */
function enGnf(montant, devise, taux) {
  return devise === 'EUR' ? arrondiGnf(montant * taux) : Math.round(montant);
}

/**
 * Solde restant dû sur un colis, en GNF (et équivalent EUR).
 * Dû = transport (totalGnf) + douane + garde + courses à domicile − paiements.
 */
function calculerSolde(colis, config, maintenant = new Date()) {
  const taux       = colis.tarif?.taux || config.tauxEurGnf;
  // La garde s'arrête le jour de la remise (sinon un colis remis continuerait à « coûter »)
  const finGarde = colis.remise?.le ? new Date(colis.remise.le) : maintenant;
  const magasinage = calculerMagasinage(config, colis.arriveGuichetLe, finGarde, { pays: paysArrivee(colis.sens), taux });
  const domicileGnf = fraisDomicileGnf(colis);
  const du = (colis.tarif?.totalGnf || 0) + (colis.fraisDouaneGnf || 0) + magasinage.fraisGnf + domicileGnf;
  // Les avoirs (gestes commerciaux, remboursements) éteignent la dette comme un paiement
  const paye = (colis.paiements || []).reduce((s, p) => s + enGnf(p.montant, p.devise, taux), 0) + (colis.avoirsGnf || 0);
  const soldeGnf = Math.max(0, du - paye);
  return {
    duGnf: du,
    payeGnf: paye,
    soldeGnf,
    // Payé en ligne sur un prix estimé plus élevé que le prix pesé : à rendre au client
    tropPayeGnf: Math.max(0, Math.round(paye - du)),
    soldeEur: arrondi2(soldeGnf / taux),
    domicileGnf,
    magasinage,
  };
}

const api = { ZONES_PAYS, pointDansPays, paysDuPoint, agenceBienPlacee, calculerTarif, chiffrerArticles, domicileAPayerGnf, calculerMagasinage, calculerSolde, enGnf, arrondiGnf, arrondi2, paysArrivee, distanceKm, calculerCourse, fraisDomicileGnf, pointValide };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else racine.KolisTarif = api;
})(typeof window !== 'undefined' ? window : globalThis);
