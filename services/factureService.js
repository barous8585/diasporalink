// ─────────────────────────────────────────────────────────────
//  Factures et avoirs
//
//  • Au dépôt (si l'expéditeur paie) : facture à l'expéditeur, dans la devise
//    de l'agence de départ : transport, suppléments, assurance, ramassage,
//    livraison si son prix est déjà connu.
//  • À la remise : facture complémentaire pour tout ce qui n'a pas encore été
//    facturé (douane, garde, livraison… ou tout si le destinataire paie).
//  • Un remboursement passe par un avoir : une facture émise ne change jamais.
//  Les prix sont TTC ; la TVA est calculée selon le pays de l'agence qui facture.
// ─────────────────────────────────────────────────────────────
const Facture = require('../models/Facture');
const Config = require('../models/Config');
const { calculerSolde, enGnf, arrondi2, paysArrivee } = require('../utils/tarif');
const { ENTREPRISE, APP_NOM, PAYS, SENS, MODES_INFO, TYPES_COLIS } = require('../config/constants');

// Groupes de lignes : une fois un groupe facturé, il ne l'est plus jamais
const GROUPE = { transport: 'transport', supplement: 'transport', assurance: 'transport', arrondi: 'transport', ramassage: 'ramassage', livraison: 'livraison', douane: 'douane', garde: 'garde' };
const groupe = (cle) => (String(cle).startsWith('article:') ? 'transport' : GROUPE[cle] || cle);

const conv = (montant, de, vers, taux) => {
  if (!montant) return 0;
  if (de === vers) return montant;
  return vers === 'GNF' ? enGnf(montant, 'EUR', taux) : arrondi2(montant / taux);
};
const arrondir = (n, devise) => (devise === 'GNF' ? Math.round(n) : arrondi2(n));

/** Toutes les lignes facturables d'un colis, dans leur devise d'origine. */
function lignesDuColis(colis, config, maintenant = new Date()) {
  const t = colis.tarif || {};
  const dev = t.devise || 'EUR';
  const sens = SENS.find(s => s.key === (colis.sens || 'FR-GN'));
  const mode = MODES_INFO.find(m => m.key === colis.mode);
  const type = TYPES_COLIS.find(x => x.key === colis.typeColis);
  const lignes = [];
  const articles = t.articles || [];
  if (t.transport || t.articlesTotal) {
    const transportLib = `Transport ${mode?.key === 'mer' ? 'maritime' : mode?.key === 'express' ? 'aérien express' : 'aérien'} ${sens?.label || ''}`.trim();
    const pese = colis.poidsReel ? ` · ${String(colis.poidsReel).replace('.', ',')} kg pesés` : '';
    if (t.transport) {
      lignes.push({
        cle: 'transport', designation: articles.length ? `${transportLib}, au kilo` : transportLib,
        detail: `Colis ${colis.numeroSuivi} · ${colis.nbCartons || 1} carton(s)${type ? ` · ${type.label.toLowerCase()}` : ''}${pese}${t.poidsArticles ? ` (dont ${String(t.poidsArticles).replace('.', ',')} kg comptés dans les articles à la pièce)` : ''}`,
        quantite: t.poidsFacture, unite: 'kg', prixUnitaire: t.prixKg, montant: t.transport, devise: dev,
      });
    }
    articles.forEach((a, i) => lignes.push({
      cle: `article:${a.cle}`, designation: `${a.label}${t.transport ? '' : ` · ${transportLib.toLowerCase()}`}`,
      detail: i === 0 && !t.transport ? `Colis ${colis.numeroSuivi} · prix à la pièce${pese}` : 'Prix à la pièce',
      quantite: a.quantite, unite: a.quantite > 1 ? 'pièces' : 'pièce', prixUnitaire: a.prix, montant: a.montant, devise: dev,
    }));
    if (t.surcharge) lignes.push({ cle: 'supplement', designation: `Supplément ${type?.label.toLowerCase() || ''}`.trim(), detail: type?.surcharge ? `${Math.round((config.surcharges?.[colis.typeColis] ?? type.surcharge) * 100)} % du transport au kilo` : '', montant: t.surcharge, devise: dev });
    if (t.assurance) lignes.push({ cle: 'assurance', designation: 'Assurance ad valorem', detail: `Valeur déclarée : ${colis.valeurDeclaree} ${dev === 'EUR' ? '€' : 'GNF'}`, montant: t.assurance, devise: dev });
    const somme = (t.transport || 0) + (t.surcharge || 0) + (t.articlesTotal || 0) + (t.assurance || 0);
    const ecart = arrondir((t.total ?? somme) - somme, dev);
    if (Math.abs(ecart) > 0.004) lignes.push({ cle: 'arrondi', designation: 'Arrondi', montant: ecart, devise: dev });
  }
  for (const k of ['ramassage', 'livraison']) {
    const c = colis[k];
    if (!c) continue;
    const active = c.demande && c.statut !== 'annulee';
    const lib = k === 'ramassage' ? 'Ramassage à domicile' : 'Livraison à domicile';
    const lieu = [c.adresse?.quartier || c.adresse?.commune, c.adresse?.ville, c.distanceKm ? `${String(c.distanceKm).replace('.', ',')} km` : ''].filter(Boolean).join(' · ');
    if (active && c.prix) {
      // Payée d'avance plus cher qu'aujourd'hui (adresse changée) : le paiement reste acquis
      const plus = (c.payeGnf || 0) > (c.prixGnf || 0);
      lignes.push({ cle: k, designation: lib, detail: lieu, montant: plus ? c.payeGnf : c.prix, devise: plus ? 'GNF' : c.devise });
    } else if (!active && c.payeGnf > 0) {
      lignes.push({ cle: k, designation: `${lib} (annulée)`, detail: 'Payée d\'avance, non remboursable', montant: c.payeGnf, devise: 'GNF' });
    }
  }
  if (colis.fraisDouaneGnf) lignes.push({ cle: 'douane', designation: 'Droits et taxes de douane', detail: 'Débours : refacturés à l\'identique', montant: colis.fraisDouaneGnf, devise: 'GNF', debours: true });
  const m = calculerSolde(colis, config, maintenant).magasinage;
  if (m.fraisGnf) lignes.push({ cle: 'garde', designation: 'Frais de garde en agence', detail: `Au-delà de ${config.magasinage?.joursGratuits ?? 0} jours gratuits`, quantite: m.joursFactures, unite: 'jour', prixUnitaire: m.joursFactures ? Math.round(m.fraisGnf / m.joursFactures) : undefined, montant: m.fraisGnf, devise: 'GNF' });
  return lignes;
}

/** Calcule HT / TVA / TTC dans la devise de la facture. */
function chiffrer(lignesBrutes, { devise, taux, tauxTva }) {
  const lignes = lignesBrutes.map(l => {
    const montantTTC = arrondir(conv(l.montant, l.devise, devise, taux), devise);
    return {
      cle: l.cle, designation: l.designation, detail: l.detail, quantite: l.quantite ?? 1, unite: l.unite,
      prixUnitaire: l.prixUnitaire !== undefined ? arrondir(conv(l.prixUnitaire, l.devise, devise, taux), devise) : montantTTC,
      montantTTC, tauxTva: l.debours ? 0 : tauxTva, debours: !!l.debours,
      _gnf: l.devise === 'GNF' ? l.montant : enGnf(l.montant, l.devise, taux),
    };
  });
  const parTauxMap = {};
  for (const l of lignes) {
    const p = (parTauxMap[l.tauxTva] = parTauxMap[l.tauxTva] || { taux: l.tauxTva, ttc: 0 });
    p.ttc += l.montantTTC;
  }
  const parTaux = Object.values(parTauxMap).map(p => {
    const baseHT = arrondir(p.ttc / (1 + p.taux), devise);
    return { taux: p.taux, baseHT, tva: arrondir(p.ttc - baseHT, devise) };
  });
  const totalTTC = arrondir(lignes.reduce((s, l) => s + l.montantTTC, 0), devise);
  const totalTVA = arrondir(parTaux.reduce((s, p) => s + p.tva, 0), devise);
  const totalGnf = lignes.reduce((s, l) => s + l._gnf, 0);
  lignes.forEach(l => delete l._gnf);
  return { lignes, parTaux, totalTTC, totalTVA, totalHT: arrondir(totalTTC - totalTVA, devise), totalGnf };
}

function emetteur(config) {
  const f = config.facturation || {};
  return {
    ...ENTREPRISE, marque: APP_NOM,
    capital: f.capital || '', email: f.email || '', telephone: f.telephone || '', site: f.site || '',
  };
}

/**
 * Émet la facture de ce qui n'a pas encore été facturé sur le colis.
 * moment : 'depot' (facture à l'expéditeur) ou 'remise' (à la personne qui retire).
 * Renvoie null s'il n'y a rien à facturer.
 */
async function emettre(colis, { moment = 'depot', agent } = {}) {
  const config = await Config.get();
  const deja = await Facture.find({ colis: colis._id, type: 'facture' }).lean();
  const groupesFactures = new Set(deja.flatMap(f => f.lignes.map(l => groupe(l.cle))));
  let lignes = lignesDuColis(colis, config).filter(l => !groupesFactures.has(groupe(l.cle)));
  // Au dépôt : la garde et la douane n'existent pas encore ; seulement ce qui est connu
  if (moment === 'depot') lignes = lignes.filter(l => !['douane', 'garde'].includes(l.cle));
  // Paiement d'avance en ligne des courses à domicile : seulement ces courses
  if (moment === 'domicile') lignes = lignes.filter(l => ['ramassage', 'livraison'].includes(l.cle));
  if (!lignes.length) return null;

  if (moment === 'domicile') moment = 'depot'; // facturé par l'agence de départ, à l'expéditeur
  const codeAgence = agent?.lieu || (moment === 'depot' ? colis.depot : colis.guichet);
  const agence = (config.agences || []).find(a => a.code === codeAgence)
    || (config.agences || []).find(a => a.code === (moment === 'depot' ? colis.depot : colis.guichet));
  const pays = agence?.pays || (moment === 'depot' ? String(colis.sens || 'FR-GN').split('-')[0] : paysArrivee(colis.sens));
  const devise = PAYS[pays]?.devise || 'EUR';
  const tva = config.facturation?.tva?.[pays] || { taux: 0, mention: '' };
  const taux = colis.tarif?.taux || config.tauxEurGnf;
  const chiffres = chiffrer(lignes, { devise, taux, tauxTva: tva.taux || 0 });

  let client;
  if (moment === 'depot') client = { ...colis.expediteur.toObject?.() || colis.expediteur, role: 'Expéditeur' };
  else if (colis.remise?.retirePar === 'tiers') client = { nom: colis.remise.nomRetrait, telephone: colis.tiersAutorise?.telephone, role: 'Pour le destinataire' };
  else client = { ...colis.destinataire.toObject?.() || colis.destinataire, role: 'Destinataire' };

  return Facture.create({
    type: 'facture', colis: colis._id, numeroSuivi: colis.numeroSuivi,
    emetteur: emetteur(config),
    agence: agence ? { code: agence.code, nom: agence.nom, adresse: [agence.adresse, agence.commune, agence.ville].filter(Boolean).join(', '), pays: agence.pays } : undefined,
    client: { nom: client.nom, telephone: client.telephone, role: client.role },
    devise, taux, ...chiffres,
    mentionTva: tva.taux ? '' : (tva.mention || ''),
    conditionsPaiement: config.facturation?.conditionsPaiement,
    agent: agent?._id,
  });
}

/** Avoir (remboursement) sur une facture, pour un montant TTC dans sa devise. */
async function emettreAvoir(facture, montant, motif, agent) {
  const config = await Config.get();
  const m = arrondir(Math.min(Math.abs(montant), facture.totalTTC), facture.devise);
  if (!(m > 0)) throw new Error('Montant d\'avoir invalide.');
  const dejaAvoirs = await Facture.find({ factureOrigine: facture.numero, type: 'avoir' }).lean();
  const reste = facture.totalTTC - dejaAvoirs.reduce((s, a) => s + a.totalTTC, 0);
  if (m > reste + 0.001) throw new Error(`L'avoir dépasse ce qui reste sur la facture (${reste}).`);
  const tauxTva = (facture.lignes.find(l => !l.debours) || {}).tauxTva || 0;
  const chiffres = chiffrer([{ cle: 'remboursement', designation: `Avoir sur la facture ${facture.numero}`, detail: motif, montant: m, devise: facture.devise }], { devise: facture.devise, taux: facture.taux, tauxTva });
  return Facture.create({
    type: 'avoir', colis: facture.colis, numeroSuivi: facture.numeroSuivi,
    emetteur: emetteur(config), agence: facture.agence, client: facture.client,
    devise: facture.devise, taux: facture.taux, ...chiffres,
    mentionTva: facture.mentionTva, factureOrigine: facture.numero, motif, agent: agent?._id,
  });
}

/**
 * Factures d'un colis avec leur état de paiement : les paiements du colis sont
 * répartis dans l'ordre des factures (en GNF au taux du colis).
 */
async function facturesDuColis(colis) {
  const factures = await Facture.find({ colis: colis._id }).sort({ date: 1 }).lean();
  const taux = colis.tarif?.taux || 10000;
  let paye = (colis.paiements || []).reduce((s, p) => s + enGnf(p.montant, p.devise, taux), 0);
  const avoirsGnf = factures.filter(f => f.type === 'avoir').reduce((s, f) => s + f.totalGnf, 0);
  paye += avoirsGnf; // un avoir éteint la dette comme un paiement
  return factures.map(f => {
    if (f.type === 'avoir') return { ...f, etat: 'avoir' };
    const couvert = Math.min(f.totalGnf, Math.max(0, paye));
    paye -= f.totalGnf;
    const resteGnf = f.totalGnf - couvert;
    return {
      ...f,
      etat: resteGnf <= 0 ? 'payee' : couvert > 0 ? 'partielle' : 'a_payer',
      reste: resteGnf <= 0 ? 0 : arrondir(conv(resteGnf, 'GNF', f.devise, f.taux), f.devise),
    };
  });
}

// Émission silencieuse : une facture ratée ne doit jamais bloquer un dépôt ou une remise
async function emettreSansBloquer(colis, options) {
  try { return await emettre(colis, options); } catch (e) { console.error('[facture]', colis?.numeroSuivi, e.message); return null; }
}

module.exports = { lignesDuColis, chiffrer, emettre, emettreSansBloquer, emettreAvoir, facturesDuColis, GROUPE };
