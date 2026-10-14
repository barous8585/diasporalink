// ─────────────────────────────────────────────────────────────
//  Opérations métier sur les colis (utilisées par les routes)
// ─────────────────────────────────────────────────────────────
const Colis = require('../models/Colis');
const Lot = require('../models/Lot');
const Config = require('../models/Config');
const OperationSync = require('../models/OperationSync');
const { Mouvement } = require('../models/Mouvement');
const { calculerTarif, calculerSolde, calculerMagasinage } = require('../utils/tarif');
const { notifier, MESSAGES } = require('../utils/sms');
const {
  STATUTS, STATUTS_LABELS, STATUTS_LOT, CODE_RETRAIT_ESSAIS_MAX, METHODES_PAIEMENT, DEVISES, PAYS, sensEntre,
} = require('../config/constants');

const paysArriveeDe = (sens) => String(sens || 'FR-GN').split('-')[1];
const nomPays = (code) => PAYS[code]?.nom || code;

/**
 * Vérifie les agences de départ et de retrait et renvoie le sens d'envoi.
 * Les deux agences doivent être dans deux pays différents (France ⇄ Guinée).
 */
async function sensDepuisAgences(codeDepart, codeRetrait) {
  const [dep, ret] = await Promise.all([Config.lieu(codeDepart), Config.lieu(codeRetrait)]);
  if (!dep) throw new ErreurMetier('Agence de départ inconnue.');
  if (!ret) throw new ErreurMetier('Agence de retrait inconnue.');
  if (ret.actif === false) throw new ErreurMetier(`L'agence ${ret.nom} est fermée.`);
  const sens = sensEntre(dep.pays, ret.pays);
  if (!sens) throw new ErreurMetier('L\'agence de retrait doit être dans l\'autre pays.');
  return sens.key;
}

class ErreurMetier extends Error {
  constructor(message, status = 400, code = 'erreur') {
    super(message); this.name = 'ErreurMetier'; this.status = status; this.code = code;
  }
}

// ── Téléphones : format international pour pouvoir retrouver les colis ──
// 6XXXXXXXX (9 chiffres) → +224 ; 0XXXXXXXXX (10 chiffres) → +33 ; 00… → +…
function normTel(tel) {
  if (!tel) return tel;
  let t = String(tel).replace(/[\s.\-()]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (/^6\d{8}$/.test(t)) t = '+224' + t;
  if (/^0[1-9]\d{8}$/.test(t)) t = '+33' + t.slice(1);
  return t;
}

// Masque un téléphone pour l'affichage public : +224 6•• •• 42 17
function masquerTel(tel) {
  if (!tel) return '';
  const t = String(tel);
  if (t.length < 8) return '••••';
  return `${t.slice(0, t.length - 8)}•• •• ${t.slice(-4, -2)} ${t.slice(-2)}`;
}

const prenomSeul = (nom) => (nom || '').trim().split(/\s+/)[0] || '';

async function nomLieu(code) {
  const lieu = await Config.lieu(code);
  return lieu?.nom || code;
}

// ── Vues ────────────────────────────────────────────────────
async function vuePublique(colis) {
  const config = await Config.get();
  const solde = calculerSolde(colis, config);
  const guichet = await Config.lieu(colis.guichet);
  return {
    numeroSuivi: colis.numeroSuivi,
    statut: colis.statut,
    statutLabel: STATUTS_LABELS[colis.statut],
    mode: colis.mode,
    sens: colis.sens || 'FR-GN',
    destinataire: prenomSeul(colis.destinataire?.nom),
    guichet: guichet ? { code: guichet.code, nom: guichet.nom, pays: guichet.pays, ville: guichet.ville, commune: guichet.commune, adresse: guichet.adresse, telephone: guichet.telephone, horaires: guichet.horaires } : { code: colis.guichet },
    poids: colis.poidsReel || colis.poidsEstime,
    nbCartons: colis.nbCartons,
    lotCode: colis.lotCode,
    historique: (colis.historique || []).map(h => ({ statut: h.statut, label: h.label, detail: h.detail, le: h.le })),
    arriveGuichetLe: colis.arriveGuichetLe,
    magasinage: solde.magasinage,
    soldeGnf: solde.soldeGnf,
    soldeEur: solde.soldeEur,
    majLe: new Date(),
  };
}

async function vueComplete(colis, { avecCode = false } = {}) {
  const config = await Config.get();
  const obj = colis.toJSON();
  const solde = calculerSolde(colis, config);
  obj.solde = solde;
  obj.guichetInfo = await Config.lieu(colis.guichet);
  if (avecCode && colis.codeRetrait && colis.statut === STATUTS.PRET) obj.codeRetrait = colis.codeRetrait;
  return obj;
}

// ── Opérations idempotentes (app agent hors-ligne) ───────────
async function avecOperation(opId, agent, type, fn) {
  if (!opId) return fn();
  const deja = await OperationSync.findOne({ opId }).lean();
  if (deja) return { ...deja.resultat, rejoue: true };
  const resultat = await fn();
  try {
    await OperationSync.create({ opId, agent: agent?._id, type, resultat });
  } catch (e) {
    if (e.code !== 11000) throw e; // doublon concurrent : déjà enregistré
  }
  return resultat;
}

// ── Encaissement ────────────────────────────────────────────
function validerPaiement(p) {
  if (!p) return null;
  const montant = parseFloat(p.montant);
  if (!(montant > 0)) return null;
  if (!DEVISES.includes(p.devise)) throw new ErreurMetier('Devise invalide.');
  if (!METHODES_PAIEMENT.some(m => m.key === p.methode)) throw new ErreurMetier('Moyen de paiement invalide.');
  return { montant, devise: p.devise, methode: p.methode, objet: p.objet || 'global', reference: p.reference };
}

async function encaisser(colis, agent, paiement, { opId } = {}) {
  const p = validerPaiement(paiement);
  if (!p) return null;
  const lieu = agent?.lieu || 'EN_LIGNE';
  colis.paiements.push({ ...p, lieu, agent: agent?._id, opId, le: new Date() });
  if (agent) {
    await Mouvement.create({
      agent: agent._id, lieu, colis: colis._id, numeroSuivi: colis.numeroSuivi,
      montant: p.montant, devise: p.devise, methode: p.methode, objet: p.objet, reference: p.reference,
    });
  }
  return p;
}

// ── Dépôt / pesée ───────────────────────────────────────────
// Crée un colis (client sans réservation) ou complète une réservation.
async function deposer(agent, data) {
  const config = await Config.get();
  const poidsReel = parseFloat(data.poidsReel);
  if (!(poidsReel > 0)) throw new ErreurMetier('Poids pesé requis.');

  let colis;
  if (data.numeroSuivi) {
    colis = await Colis.findOne({ numeroSuivi: data.numeroSuivi.trim().toUpperCase() });
    if (!colis) throw new ErreurMetier('Réservation introuvable.', 404);
    if (colis.statut !== STATUTS.RESERVE) throw new ErreurMetier(`Ce colis est déjà « ${STATUTS_LABELS[colis.statut]} ».`, 409);
  } else {
    colis = new Colis({ client: data.clientId || undefined });
  }

  // Champs modifiables au comptoir (l'agent corrige la réservation si besoin)
  const champs = ['mode', 'typeColis', 'guichet', 'description', 'nbCartons', 'valeurDeclaree', 'assurance', 'payeurArrivee'];
  champs.forEach(k => { if (data[k] !== undefined && data[k] !== '') colis[k] = data[k]; });
  if (data.expediteur) colis.expediteur = { nom: data.expediteur.nom, telephone: normTel(data.expediteur.telephone) };
  if (data.destinataire) colis.destinataire = { nom: data.destinataire.nom, telephone: normTel(data.destinataire.telephone) };
  if (!colis.guichet) throw new ErreurMetier('Agence de retrait requise.');

  colis.poidsReel = poidsReel;
  // Le colis part de l'agence où il est pesé
  colis.depot = agent.lieu || data.depot || colis.depot;
  colis.sens = await sensDepuisAgences(colis.depot, colis.guichet);
  const tarif = calculerTarif(config, {
    sens: colis.sens, mode: colis.mode, poidsKg: poidsReel, typeColis: colis.typeColis,
    valeurDeclaree: colis.valeurDeclaree, assurance: colis.assurance,
  });
  colis.tarif = { ...tarif, estime: false };

  const ecart = colis.poidsEstime ? Math.round((poidsReel - colis.poidsEstime) * 10) / 10 : 0;
  colis.ajouterEvenement(STATUTS.DEPOSE,
    `Pesé ${poidsReel} kg${colis.poidsEstime ? ` (déclaré ${colis.poidsEstime} kg)` : ''}`,
    { lieu: colis.depot, agent: agent._id });

  await colis.validate();
  await encaisser(colis, agent, data.paiement);
  await colis.save();

  notifier(colis.expediteur.telephone, MESSAGES.depose(colis));
  return { colis: await vueComplete(colis), ecartPoids: ecart };
}

// ── Scans (dépôt, arrivée, guichet) ─────────────────────────
const ACTIONS_SCAN = {
  // Mettre dans un lot à l'agence de départ
  charger: { depuis: [STATUTS.DEPOSE, STATUTS.CHARGE], vers: STATUTS.CHARGE },
  // Réception du lot à la plateforme d'arrivée (aéroport / port)
  arrivee: { depuis: [STATUTS.CHARGE, STATUTS.EN_TRANSIT, STATUTS.ARRIVE], vers: STATUTS.ARRIVE },
  // Envoi de la plateforme vers l'agence de retrait d'une autre ville / commune
  acheminer: { depuis: [STATUTS.ARRIVE, STATUTS.ACHEMINEMENT], vers: STATUTS.ACHEMINEMENT },
  // Mise en rayon à l'agence de retrait → code envoyé au destinataire
  guichet: { depuis: [STATUTS.ARRIVE, STATUTS.EN_TRANSIT, STATUTS.ACHEMINEMENT, STATUTS.PRET], vers: STATUTS.PRET },
};

async function mettrePret(colis, agent, emplacement) {
  const code = colis.genererCodeRetrait();
  colis.arriveGuichetLe = new Date();
  if (emplacement) colis.emplacement = emplacement;
  const nomGuichet = await nomLieu(colis.guichet);
  colis.ajouterEvenement(STATUTS.PRET, nomGuichet, { lieu: colis.guichet, agent: agent?._id });
  const config = await Config.get();
  const { soldeGnf, soldeEur } = calculerSolde(colis, config);
  const enFrance = paysArriveeDe(colis.sens) === 'FR';
  const reste = soldeGnf > 0 ? (enFrance ? `${soldeEur.toLocaleString('fr-FR')} €` : `${soldeGnf.toLocaleString('fr-FR')} GNF`) : '';
  const msg = MESSAGES.pret(colis, code, nomGuichet, reste);
  notifier(colis.destinataire.telephone, msg);
  if (colis.tiersAutorise?.telephone) notifier(colis.tiersAutorise.telephone, msg);
  if (colis.expediteur.telephone !== colis.destinataire.telephone) notifier(colis.expediteur.telephone, msg);
}

async function appliquerScan(agent, scan) {
  const numero = String(scan.numero || '').trim().toUpperCase();
  const action = ACTIONS_SCAN[scan.action];
  const base = { numero, action: scan.action };
  if (!action) return { ...base, ok: false, erreur: 'Action inconnue.' };

  const colis = await Colis.findOne({ numeroSuivi: numero }).select('+codeRetrait +codeEssais');
  if (!colis) return { ...base, ok: false, erreur: 'Colis introuvable.' };
  const resume = { destinataire: colis.destinataire.nom, poids: colis.poidsReel || colis.poidsEstime, lotCode: colis.lotCode };

  if (colis.statut === action.vers && scan.action !== 'guichet') {
    return { ...base, ...resume, ok: true, dejaFait: true, statut: colis.statut };
  }
  if (!action.depuis.includes(colis.statut)) {
    return { ...base, ...resume, ok: false, erreur: `Statut actuel : « ${STATUTS_LABELS[colis.statut]} ».` };
  }

  const agence = agent.lieu ? await Config.lieu(agent.lieu) : null;
  const paysDest = paysArriveeDe(colis.sens);

  if (scan.action === 'charger') {
    const lot = await Lot.findOne({ code: String(scan.lot || '').toUpperCase() });
    if (!lot) return { ...base, ...resume, ok: false, erreur: 'Choisissez un lot.' };
    if (lot.statut !== STATUTS_LOT.PREPARATION) return { ...base, ...resume, ok: false, erreur: `Le lot ${lot.code} est déjà parti.` };
    if ((lot.sens || 'FR-GN') !== (colis.sens || 'FR-GN')) return { ...base, ...resume, ok: false, erreur: `Ce colis va vers : ${nomPays(paysDest)}. Le lot ${lot.code} part dans l'autre sens.` };
    if (lot.mode !== colis.mode) return { ...base, ...resume, ok: false, erreur: `Colis prévu en ${colis.mode === 'air' ? 'avion' : 'bateau'}, lot ${lot.code} en ${lot.mode === 'air' ? 'avion' : 'bateau'}.` };
    colis.lot = lot._id;
    colis.lotCode = lot.code;
    colis.ajouterEvenement(STATUTS.CHARGE, `Lot ${lot.code}`, { lieu: agent.lieu, agent: agent._id });
  }

  if (scan.action === 'arrivee') {
    if (scan.lot && colis.lotCode && colis.lotCode !== String(scan.lot).toUpperCase()) {
      return { ...base, ...resume, ok: false, horsLot: true, erreur: `N'est pas dans ce lot (lot ${colis.lotCode}).` };
    }
    if (agence && agence.pays !== paysDest) {
      return { ...base, ...resume, ok: false, erreur: `Ce colis est attendu en ${nomPays(paysDest)}.` };
    }
    colis.ajouterEvenement(STATUTS.ARRIVE, agence ? `${agence.ville || agence.nom}` : nomPays(paysDest), { lieu: agent.lieu, agent: agent._id });
    notifier(colis.destinataire.telephone, MESSAGES.arrive(colis, nomPays(paysDest)));
  }

  if (scan.action === 'acheminer') {
    if (agence && agence.pays !== paysDest) {
      return { ...base, ...resume, ok: false, erreur: `Ce colis est attendu en ${nomPays(paysDest)}.` };
    }
    if (agent.lieu && colis.guichet === agent.lieu) {
      return { ...base, ...resume, ok: false, erreur: 'Ce colis se retire ici : utilisez « Mise en rayon ».' };
    }
    const dest = await Config.lieu(colis.guichet);
    colis.ajouterEvenement(STATUTS.ACHEMINEMENT, `Vers ${dest?.nom || colis.guichet}${dest?.ville ? ` (${dest.ville})` : ''}`, { lieu: agent.lieu, agent: agent._id });
    notifier(colis.destinataire.telephone, MESSAGES.acheminement(colis, dest?.nom || colis.guichet));
    await colis.save();
    return { ...base, ...resume, ok: true, statut: colis.statut, versAgence: dest?.nom || colis.guichet };
  }

  if (scan.action === 'guichet') {
    if (agent.lieu && colis.guichet !== agent.lieu) {
      const prevu = await nomLieu(colis.guichet);
      return { ...base, ...resume, ok: false, erreur: `Ce colis se retire à : ${prevu}. Utilisez « Envoi vers agence ».`, autreAgence: prevu };
    }
    if (colis.statut === STATUTS.PRET) {
      return { ...base, ...resume, ok: true, dejaFait: true, statut: colis.statut };
    }
    await mettrePret(colis, agent, scan.emplacement);
  }

  await colis.save();
  return { ...base, ...resume, ok: true, statut: colis.statut, lotCode: colis.lotCode };
}

// ── Remise au destinataire ──────────────────────────────────
async function remettre(agent, data) {
  const numero = String(data.numero || '').trim().toUpperCase();
  const colis = await Colis.findOne({ numeroSuivi: numero }).select('+codeRetrait +codeEssais');
  if (!colis) throw new ErreurMetier('Colis introuvable.', 404);
  if (colis.statut === STATUTS.REMIS) {
    if (data.opId && colis.remise?.opId === data.opId) return { colis: await vueComplete(colis), rejoue: true };
    throw new ErreurMetier('Ce colis a déjà été remis.', 409);
  }
  if (colis.statut !== STATUTS.PRET) throw new ErreurMetier(`Pas encore disponible (« ${STATUTS_LABELS[colis.statut]} »).`, 409);
  if (agent.lieu && colis.guichet !== agent.lieu) throw new ErreurMetier('Ce colis est attendu dans une autre agence.', 409);

  if ((colis.codeEssais || 0) >= CODE_RETRAIT_ESSAIS_MAX) {
    throw new ErreurMetier('Trop de codes faux : colis bloqué. Appelez l\'administrateur.', 423, 'code_bloque');
  }
  if (String(data.code || '') !== colis.codeRetrait) {
    colis.codeEssais = (colis.codeEssais || 0) + 1;
    await colis.save();
    throw new ErreurMetier(`Code incorrect (${CODE_RETRAIT_ESSAIS_MAX - colis.codeEssais} essai(s) restant(s)).`, 401, 'code_faux');
  }
  if (!data.pieceVerifiee) throw new ErreurMetier('Vérifiez la pièce d\'identité.');
  if (data.retirePar === 'tiers' && !colis.tiersAutorise?.nom && !data.nomRetrait) {
    throw new ErreurMetier('Nom de la personne qui retire requis.');
  }

  // Vérifie que le paiement couvre le solde AVANT d'enregistrer quoi que ce soit en caisse.
  const config = await Config.get();
  const p = validerPaiement(data.paiement);
  const essai = { sens: colis.sens, paiements: [...colis.paiements, ...(p ? [p] : [])], tarif: colis.tarif, fraisDouaneGnf: colis.fraisDouaneGnf, arriveGuichetLe: colis.arriveGuichetLe };
  const solde = calculerSolde(essai, config);
  if (solde.soldeGnf > 0) {
    throw new ErreurMetier(`Il reste ${solde.soldeGnf.toLocaleString('fr-FR')} GNF à payer.`, 402, 'solde_du');
  }
  await encaisser(colis, agent, data.paiement, { opId: data.opId });

  colis.remise = {
    le: new Date(), agent: agent._id,
    retirePar: data.retirePar === 'tiers' ? 'tiers' : 'destinataire',
    nomRetrait: data.retirePar === 'tiers' ? (data.nomRetrait || colis.tiersAutorise?.nom) : colis.destinataire.nom,
    pieceVerifiee: true,
    signature: typeof data.signature === 'string' && data.signature.startsWith('data:image/') && data.signature.length < 300000 ? data.signature : undefined,
    opId: data.opId,
  };
  colis.ajouterEvenement(STATUTS.REMIS, `Remis à ${colis.remise.nomRetrait}`, { lieu: agent.lieu, agent: agent._id });
  await colis.save();
  notifier(colis.expediteur.telephone, MESSAGES.remis(colis));
  if (colis.destinataire.telephone !== colis.expediteur.telephone) notifier(colis.destinataire.telephone, MESSAGES.remis(colis));
  return { colis: await vueComplete(colis) };
}

// ── Changement de statut en masse (admin) ───────────────────
async function changerStatutMasse(numeros, statut, agent) {
  const resultats = [];
  for (const numero of numeros) {
    const colis = await Colis.findOne({ numeroSuivi: numero }).select('+codeRetrait +codeEssais');
    if (!colis) { resultats.push({ numero, ok: false, erreur: 'Introuvable' }); continue; }
    if (colis.statut === statut) { resultats.push({ numero, ok: true, dejaFait: true }); continue; }
    if (colis.statut === STATUTS.REMIS) { resultats.push({ numero, ok: false, erreur: 'Déjà remis' }); continue; }
    if (statut === STATUTS.PRET) {
      await mettrePret(colis, agent);
    } else {
      colis.ajouterEvenement(statut, 'Mise à jour par l\'administration', { agent: agent._id });
      if (statut === STATUTS.EN_TRANSIT) {
        const pays = nomPays(paysArriveeDe(colis.sens));
        notifier(colis.expediteur.telephone, MESSAGES.en_transit(colis, pays));
        notifier(colis.destinataire.telephone, MESSAGES.en_transit(colis, pays));
      }
      if (statut === STATUTS.ARRIVE) notifier(colis.destinataire.telephone, MESSAGES.arrive(colis, nomPays(paysArriveeDe(colis.sens))));
    }
    await colis.save();
    resultats.push({ numero, ok: true, statut });
  }
  return resultats;
}

// ── Liste des colis prêts à un guichet (cache hors-ligne de l'agent) ──
async function colisDuGuichet(guichet) {
  const config = await Config.get();
  const liste = await Colis.find({ guichet, statut: STATUTS.PRET }).select('+codeRetrait');
  return liste.map(c => {
    const solde = calculerSolde(c, config);
    return {
      numeroSuivi: c.numeroSuivi,
      destinataire: c.destinataire,
      tiersAutorise: c.tiersAutorise,
      poids: c.poidsReel, nbCartons: c.nbCartons, emplacement: c.emplacement,
      arriveGuichetLe: c.arriveGuichetLe,
      soldeGnf: solde.soldeGnf,
      magasinage: solde.magasinage,
      empreinteCode: Colis.empreinteCode(c.numeroSuivi, c.codeRetrait),
    };
  });
}

module.exports = {
  ErreurMetier, normTel, masquerTel, vuePublique, vueComplete, avecOperation,
  encaisser, deposer, appliquerScan, sensDepuisAgences, paysArriveeDe, nomPays, remettre, changerStatutMasse, colisDuGuichet,
  mettrePret, calculerMagasinage,
};
