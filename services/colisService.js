// ─────────────────────────────────────────────────────────────
//  Opérations métier sur les colis (utilisées par les routes)
// ─────────────────────────────────────────────────────────────
const Colis = require('../models/Colis');
const Lot = require('../models/Lot');
const Config = require('../models/Config');
const OperationSync = require('../models/OperationSync');
const { Mouvement } = require('../models/Mouvement');
const { calculerTarif, calculerSolde, calculerMagasinage, enGnf } = require('../utils/tarif');
const { notifier, MESSAGES } = require('../utils/sms');
const {
  STATUTS, STATUTS_LABELS, STATUTS_LOT, CODE_RETRAIT_ESSAIS_MAX, METHODES_PAIEMENT, DEVISES, PAYS, sensEntre, CGV_VERSION, SENS: SENS_LISTE, libMode,
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

// Le colis concerne-t-il ce compte ? (réservé par lui, ou son numéro sur le colis)
function lieAuCompte(colis, user) {
  if (!colis || !user) return false;
  if (['agent', 'admin', 'livreur'].includes(user.role)) return true;
  if (String(colis.client) === String(user._id)) return true;
  return [colis.expediteur?.telephone, colis.destinataire?.telephone, colis.tiersAutorise?.telephone].includes(user.telephone);
}

// ── Vues ────────────────────────────────────────────────────
// Course à domicile vue par tout le monde : pas d'adresse précise ni de téléphone
function vueCoursePublique(c) {
  if (!c?.demande || c.statut === 'annulee') return null;
  return {
    statut: c.statut,
    quartier: c.adresse?.quartier || c.adresse?.commune || '',
    aPosition: !!c.adresse?.position?.lat,
    prix: c.prix, devise: c.devise, distanceKm: c.distanceKm, prixGnf: c.prixGnf,
    payeGnf: c.payeGnf || 0, payee: !!(c.prixGnf > 0 && (c.payeGnf || 0) >= c.prixGnf),
    livreur: c.livreurNom ? prenomSeul(c.livreurNom) : undefined,
    jour: c.jour, moment: c.moment,
  };
}

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
    historique: (colis.historique || []).filter(h => !h.annule && h.label !== 'Étape annulée').map(h => ({ statut: h.statut, label: h.label, detail: h.detail, le: h.le })),
    arriveGuichetLe: colis.arriveGuichetLe,
    magasinage: solde.magasinage,
    soldeGnf: solde.soldeGnf,
    soldeEur: solde.soldeEur,
    ramassage: vueCoursePublique(colis.ramassage),
    livraison: vueCoursePublique(colis.livraison),
    paiementEnVerification: (colis.declarations || []).some(d => d.statut === 'a_verifier'),
    majLe: new Date(),
  };
}

async function vueComplete(colis, { avecCode = false } = {}) {
  const config = await Config.get();
  const obj = colis.toJSON();
  const solde = calculerSolde(colis, config);
  obj.solde = solde;
  obj.domicileAPayerGnf = require('../utils/tarif').domicileAPayerGnf(colis);
  obj.guichetInfo = await Config.lieu(colis.guichet);
  if (avecCode && colis.codeRetrait && [STATUTS.PRET, STATUTS.EN_LIVRAISON].includes(colis.statut)) obj.codeRetrait = colis.codeRetrait;
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

// Articles à la pièce demandés : on garde ceux du catalogue (quantité 1 à 99)
function nettoyerArticles(config, articles) {
  if (!Array.isArray(articles)) return undefined;
  const sortie = [];
  for (const a of articles) {
    const art = (config.articles || []).find(x => x.cle === a?.cle && x.actif !== false);
    const quantite = Math.min(parseInt(a?.quantite, 10) || 0, 99);
    if (!art || quantite < 1) continue;
    const exist = sortie.find(x => x.cle === art.cle);
    if (exist) exist.quantite = Math.min(exist.quantite + quantite, 99);
    else sortie.push({ cle: art.cle, label: art.label, quantite });
  }
  return sortie;
}
const articlesTexte = (articles) => (articles || []).map(a => `${a.quantite} × ${a.label.toLowerCase()}`).join(', ');

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
  const guichetAvant = colis.guichet;
  champs.forEach(k => { if (data[k] !== undefined && data[k] !== '') colis[k] = data[k]; });
  if (data.expediteur) colis.expediteur = { nom: data.expediteur.nom, telephone: normTel(data.expediteur.telephone) };
  if (data.destinataire) colis.destinataire = { nom: data.destinataire.nom, telephone: normTel(data.destinataire.telephone) };
  if (!colis.guichet) throw new ErreurMetier('Agence de retrait requise.');
  if (data.articles !== undefined) colis.articles = nettoyerArticles(config, data.articles);

  colis.poidsReel = poidsReel;
  // Le colis part de l'agence où il est pesé
  colis.depot = agent.lieu || data.depot || colis.depot;
  colis.sens = await sensDepuisAgences(colis.depot, colis.guichet);
  const tarif = calculerTarif(config, {
    sens: colis.sens, mode: colis.mode, poidsKg: poidsReel, typeColis: colis.typeColis,
    valeurDeclaree: colis.valeurDeclaree, assurance: colis.assurance, articles: colis.articles,
  });
  colis.tarif = { ...tarif, estime: false };
  if (data.livraison === undefined && colis.livraison?.demande && guichetAvant && guichetAvant !== colis.guichet) {
    data.livraison = { demande: true, adresse: colis.livraison.adresse, jour: colis.livraison.jour, moment: colis.livraison.moment };
  }
  if (data.livraison !== undefined) {
    await require('./domicileService').demanderCourse(colis, 'livraison', data.livraison);
  } else if (colis.livraison?.demande && colis.livraison.prix && colis.livraison.devise) {
    // Taux du jour figé à la pesée : on recalcule l'équivalent GNF de la livraison
    colis.livraison.prixGnf = enGnf(colis.livraison.prix, colis.livraison.devise, tarif.taux);
  }

  const ecart = colis.poidsEstime ? Math.round((poidsReel - colis.poidsEstime) * 10) / 10 : 0;
  colis.ajouterEvenement(STATUTS.DEPOSE,
    `Pesé ${poidsReel} kg${colis.poidsEstime ? ` (déclaré ${colis.poidsEstime} kg)` : ''}${colis.articles?.length ? ` · ${articlesTexte(colis.articles)}` : ''}`,
    { lieu: colis.depot, agent: agent._id });

  // Conditions générales et objets interdits : confirmés par le client au comptoir
  if (!colis.cgv?.version) {
    if (!data.cgvAcceptees) throw new ErreurMetier('Faites confirmer au client les conditions d\'envoi et la liste des objets interdits.');
    colis.cgv = { version: CGV_VERSION, accepteesLe: new Date(), par: 'comptoir' };
  }
  if (data.photo) {
    const Photo = require('../models/Photo');
    const photo = await Photo.depuisDataUrl(data.photo, { type: 'depot', colis, par: agent._id });
    colis.photoDepot = photo._id;
  }

  await colis.validate();
  await encaisser(colis, agent, data.paiement);
  await colis.save();
  if (!colis.payeurArrivee) await require('./factureService').emettreSansBloquer(colis, { moment: 'depot', agent });

  notifier(colis.expediteur.telephone, MESSAGES.depose(colis));
  return { colis: await vueComplete(colis), ecartPoids: ecart };
}

// ── Annulation d'une étape (erreur de scan, mauvais colis…) ──
const instantane = (c) => ({ statut: c.statut, lot: c.lot ? String(c.lot) : null, lotCode: c.lotCode || null, arriveGuichetLe: c.arriveGuichetLe || null, emplacement: c.emplacement || null });
// Note l'état d'avant sur l'événement que l'étape vient d'ajouter
function marquerRetour(colis, avant) {
  const ev = colis.historique[colis.historique.length - 1];
  if (ev && ev.statut && !ev.retour) { ev.retour = avant; colis.markModified('historique'); }
}
const DELAI_ANNULATION_AGENT = 2 * 3600 * 1000; // un agent peut annuler pendant 2 h, l'admin toujours

async function annulerEtape(agent, numero, motif = '') {
  const colis = await Colis.findOne({ numeroSuivi: String(numero || '').trim().toUpperCase() }).select('+codeRetrait +codeEssais');
  if (!colis) throw new ErreurMetier('Colis introuvable.', 404);
  const idx = colis.historique.map(e => !!e.statut && !e.annule).lastIndexOf(true);
  const ev = colis.historique[idx];
  if (!ev) throw new ErreurMetier('Aucune étape à annuler.', 409);
  if (!ev.retour) throw new ErreurMetier(`L'étape « ${ev.label} » ne peut pas être annulée ici. Demandez à l'administrateur.`, 409);
  const admin = agent.role === 'admin';
  if (!admin) {
    if (ev.statut === STATUTS.REMIS) throw new ErreurMetier('Seul l\'administrateur peut annuler une remise.', 403);
    if (ev.lieu && agent.lieu && ev.lieu !== agent.lieu) throw new ErreurMetier('Cette étape a été faite dans une autre agence.', 403);
    if (Date.now() - new Date(ev.le) > DELAI_ANNULATION_AGENT) throw new ErreurMetier('Trop tard pour annuler (plus de 2 h). Demandez à l\'administrateur.', 403);
  }
  const r = ev.retour;
  colis.statut = r.statut;
  colis.lot = r.lot || undefined;
  colis.lotCode = r.lotCode || undefined;
  colis.arriveGuichetLe = r.arriveGuichetLe || undefined;
  colis.emplacement = r.emplacement || undefined;
  if (ev.statut === STATUTS.REMIS) {
    colis.remise = undefined;
    if (colis.livraison?.demande && colis.livraison.statut === 'faite') { colis.livraison.statut = r.statut === STATUTS.EN_LIVRAISON ? 'en_route' : 'a_planifier'; colis.markModified('livraison'); }
  }
  ev.annule = true;
  colis.historique.push({ label: 'Étape annulée', detail: `${ev.label}${motif ? ` : ${String(motif).slice(0, 200)}` : ''}`, lieu: agent.lieu, agent: agent._id, le: new Date() });
  colis.markModified('historique');
  await colis.save();
  return { colis: await vueComplete(colis), annulee: ev.label, statut: colis.statut };
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
  const msg = colis.livraison?.demande && colis.livraison.statut !== 'annulee'
    ? MESSAGES.pretLivraison(colis, code, reste)
    : MESSAGES.pret(colis, code, nomGuichet, reste);
  notifier(colis.destinataire.telephone, msg);
  if (colis.tiersAutorise?.telephone) notifier(colis.tiersAutorise.telephone, msg);
  if (colis.expediteur.telephone !== colis.destinataire.telephone) notifier(colis.expediteur.telephone, msg);
  if (colis.livraison?.demande && colis.livraison.statut !== 'annulee') {
    const push = require('../utils/push');
    push.sansAttendre(push.aLAgence(colis.guichet, { titre: 'Livraison à faire', corps: `${colis.numeroSuivi} pour ${colis.destinataire.nom}${colis.livraison.adresse?.quartier ? ` à ${colis.livraison.adresse.quartier}` : ''}.`, chemin: '/#/courses' }, { roles: ['livreur'] }));
  }
}

// ── Scan automatique : l'app décide de l'étape ───────────────
// Un agent qui n'a jamais vu le colis le scanne : on regarde où il en est et où
// se trouve l'agent, et on fait l'étape logique. Les autres cas sont expliqués en clair.
const User = require('../models/User');
async function etapePrecedente(colis) {
  const h = [...(colis.historique || [])].reverse().find(e => e.statut);
  if (!h) return null;
  let par;
  if (h.agent) { const u = await User.findById(h.agent).select('prenom nom').lean(); if (u) par = `${u.prenom} ${(u.nom || '')[0] || ''}.`.trim(); }
  return { label: h.label, detail: h.detail, lieu: h.lieu ? await nomLieu(h.lieu) : undefined, par, le: h.le };
}

// Lot ouvert du bon sens et du bon mode ; ouvert automatiquement s'il n'y en a pas
async function lotPourChargement(colis, agent, codeDemande) {
  const filtre = { statut: STATUTS_LOT.PREPARATION, mode: colis.mode, sens: colis.sens || 'FR-GN' };
  if (codeDemande) {
    const l = await Lot.findOne({ ...filtre, code: String(codeDemande).toUpperCase() });
    if (l) return { lot: l };
  }
  const existant = await Lot.findOne(filtre).sort({ createdAt: -1 });
  if (existant) return { lot: existant };
  const s = SENS_LISTE.find(x => x.key === (colis.sens || 'FR-GN'));
  const [dep, arr] = await Promise.all([Config.plateforme(s.depart), Config.plateforme(s.arrivee)]);
  const lot = await Lot.create({ sens: s.key, mode: colis.mode, depot: dep?.code, destination: arr?.code, creePar: agent._id, notes: 'Ouvert automatiquement au premier chargement' });
  return { lot, nouveau: true };
}

async function scanAuto(agent, scan) {
  const numero = String(scan.numero || '').trim().toUpperCase();
  const colis = await Colis.findOne({ numeroSuivi: numero });
  const base = { numero, action: 'auto' };
  if (!colis) return { ...base, ok: false, erreur: 'Colis introuvable. Vérifiez l\'étiquette.' };
  const agence = agent.lieu ? await Config.lieu(agent.lieu) : null;
  const [paysDep, paysArr] = String(colis.sens || 'FR-GN').split('-');
  const avant = await etapePrecedente(colis);
  const info = { ...base, destinataire: colis.destinataire?.nom, avant, statut: colis.statut };
  const ici = agent.lieu && colis.guichet === agent.lieu;
  const guichetNom = await nomLieu(colis.guichet);
  const faire = async (action, extra = {}) => {
    const r = await appliquerScan(agent, { ...scan, numero, action, ...extra });
    return { ...r, ...info, action: 'auto', actionFaite: r.ok ? action : undefined, statut: r.statut || colis.statut, avant };
  };
  const dire = (message, ok = true, extra = {}) => ({ ...info, ok, info: true, dejaFait: ok, message, erreur: ok ? undefined : message, ...extra });
  if (!agence) return dire('Votre compte n\'est rattaché à aucune agence : utilisez le choix manuel de l\'étape.', false);

  switch (colis.statut) {
    case STATUTS.RESERVE:
      return dire('Ce colis n\'est pas encore déposé : enregistrez-le d\'abord dans « Dépôt ».', false);
    case STATUTS.DEPOSE: {
      if (agence.pays !== paysDep) return dire(`Ce colis est encore au départ (${nomPays(paysDep)}).`, false);
      const { lot, nouveau } = await lotPourChargement(colis, agent, scan.lot);
      const r = await faire('charger', { lot: lot.code });
      if (r.ok) r.message = `Mis dans le lot ${lot.code}${nouveau ? ' (lot ouvert automatiquement)' : ''}`;
      return { ...r, lotCode: lot.code, lotNouveau: !!nouveau };
    }
    case STATUTS.CHARGE:
      if (agence.pays === paysDep) return dire(`Déjà dans le lot ${colis.lotCode}. Il partira avec ce lot.`, true, { lotCode: colis.lotCode });
      // Lot pas encore marqué « parti » mais colis déjà là : on le réceptionne
      // falls through
    case STATUTS.EN_TRANSIT: {
      if (agence.pays !== paysArr) return dire(`Ce colis est en route vers ${nomPays(paysArr)}.`, false);
      const r = await faire('arrivee');
      if (!r.ok) return r;
      if (ici) {
        // Arrivé directement dans son agence de retrait : mis en rayon dans la foulée
        const r2 = await faire('guichet');
        if (r2.ok) return { ...r2, actionFaite: 'arrivee+guichet', message: 'Reçu et mis en rayon : le destinataire a son code' };
      }
      return { ...r, message: ici ? 'Reçu' : `Reçu ici. À envoyer vers ${guichetNom} : mettez-le de côté.`, aEnvoyer: !ici, versAgence: ici ? undefined : guichetNom };
    }
    case STATUTS.ARRIVE:
    case STATUTS.ACHEMINEMENT: {
      if (agence.pays !== paysArr) return dire(`Ce colis est déjà en ${nomPays(paysArr)}.`, false);
      if (ici) {
        const r = await faire('guichet');
        if (r.ok) r.message = 'Mis en rayon : le destinataire a son code';
        return r;
      }
      if (colis.statut === STATUTS.ACHEMINEMENT) return dire(`Déjà en route vers ${guichetNom}.`, true);
      const r = await faire('acheminer');
      if (r.ok) r.message = `Envoyé vers ${guichetNom}`;
      return r;
    }
    case STATUTS.PRET:
      return ici ? dire('Déjà en rayon, prêt à remettre : ouvrez « Remise » quand le client est là.', true, { pretARemettre: true })
        : dire(`Ce colis attend son destinataire à ${guichetNom}.`, false);
    case STATUTS.EN_LIVRAISON:
      return dire('Ce colis est parti en livraison avec un livreur.', false);
    case STATUTS.REMIS:
      return dire('Ce colis a déjà été remis au destinataire.', false);
    default:
      return dire(`Statut : ${STATUTS_LABELS[colis.statut]}.`, false);
  }
}

async function appliquerScan(agent, scan) {
  if (scan.action === 'auto') return scanAuto(agent, scan);
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
  const etatAvant = instantane(colis);

  if (scan.action === 'charger') {
    const lot = await Lot.findOne({ code: String(scan.lot || '').toUpperCase() });
    if (!lot) return { ...base, ...resume, ok: false, erreur: 'Choisissez un lot.' };
    if (lot.statut !== STATUTS_LOT.PREPARATION) return { ...base, ...resume, ok: false, erreur: `Le lot ${lot.code} est déjà parti.` };
    if ((lot.sens || 'FR-GN') !== (colis.sens || 'FR-GN')) return { ...base, ...resume, ok: false, erreur: `Ce colis va vers : ${nomPays(paysDest)}. Le lot ${lot.code} part dans l'autre sens.` };
    if (lot.mode !== colis.mode) return { ...base, ...resume, ok: false, erreur: `Colis prévu en ${libMode(colis.mode)}, lot ${lot.code} en ${libMode(lot.mode)}.` };
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
    { const push = require('../utils/push'); push.sansAttendre(push.aLAgence(colis.guichet, { titre: 'Colis en route vers votre agence', corps: `${colis.numeroSuivi} pour ${colis.destinataire.nom}, envoyé par ${agence?.nom || 'la plateforme'}.`, chemin: '/#/jour' })); }
    marquerRetour(colis, etatAvant);
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

  marquerRetour(colis, etatAvant);
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
  const aDomicile = !!data.aDomicile;
  if (aDomicile ? colis.statut !== STATUTS.EN_LIVRAISON : colis.statut !== STATUTS.PRET) {
    if (colis.statut === STATUTS.EN_LIVRAISON) throw new ErreurMetier('Ce colis est parti en livraison avec un livreur.', 409);
    throw new ErreurMetier(`Pas encore disponible (« ${STATUTS_LABELS[colis.statut]} »).`, 409);
  }
  if (agent.lieu && colis.guichet !== agent.lieu) throw new ErreurMetier('Ce colis est attendu dans une autre agence.', 409);

  if ((colis.codeEssais || 0) >= CODE_RETRAIT_ESSAIS_MAX) {
    throw new ErreurMetier('Trop de codes faux : colis bloqué. Appelez l\'administrateur.', 423, 'code_bloque');
  }
  if (String(data.code || '') !== colis.codeRetrait) {
    colis.codeEssais = (colis.codeEssais || 0) + 1;
    await colis.save();
    throw new ErreurMetier(`Code incorrect (${CODE_RETRAIT_ESSAIS_MAX - colis.codeEssais} essai(s) restant(s)).`, 401, 'code_faux');
  }
  // Au guichet, la pièce d'identité est obligatoire ; à domicile, le code suffit.
  if (!data.pieceVerifiee && !aDomicile) throw new ErreurMetier('Vérifiez la pièce d\'identité.');
  if (data.retirePar === 'tiers' && !colis.tiersAutorise?.nom && !data.nomRetrait) {
    throw new ErreurMetier('Nom de la personne qui retire requis.');
  }

  // Vérifie que le paiement couvre le solde AVANT d'enregistrer quoi que ce soit en caisse.
  const config = await Config.get();
  const p = validerPaiement(data.paiement);
  const essai = {
    sens: colis.sens, paiements: [...colis.paiements, ...(p ? [p] : [])], tarif: colis.tarif, fraisDouaneGnf: colis.fraisDouaneGnf,
    arriveGuichetLe: colis.arriveGuichetLe, ramassage: colis.ramassage, livraison: colis.livraison, avoirsGnf: colis.avoirsGnf,
  };
  const solde = calculerSolde(essai, config);
  if (solde.soldeGnf > 0) {
    throw new ErreurMetier(`Il reste ${solde.soldeGnf.toLocaleString('fr-FR')} GNF à payer.`, 402, 'solde_du');
  }
  await encaisser(colis, agent, data.paiement, { opId: data.opId });

  colis.remise = {
    le: new Date(), agent: agent._id,
    retirePar: data.retirePar === 'tiers' ? 'tiers' : 'destinataire',
    nomRetrait: data.retirePar === 'tiers' ? (data.nomRetrait || colis.tiersAutorise?.nom) : colis.destinataire.nom,
    pieceVerifiee: !!data.pieceVerifiee,
    aDomicile,
    signature: typeof data.signature === 'string' && data.signature.startsWith('data:image/') && data.signature.length < 300000 ? data.signature : undefined,
    opId: data.opId,
  };
  colis.ajouterEvenement(STATUTS.REMIS, `Remis à ${colis.remise.nomRetrait}${aDomicile ? ' à domicile' : ''}`, { lieu: agent.lieu, agent: agent._id });
  marquerRetour(colis, { ...instantane(colis), statut: aDomicile ? STATUTS.EN_LIVRAISON : STATUTS.PRET });
  if (typeof data.avantSauvegarde === 'function') data.avantSauvegarde(colis);
  await colis.save();
  await require('./factureService').emettreSansBloquer(colis, { moment: 'remise', agent });
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
    const avant = instantane(colis);
    if (statut === STATUTS.PRET) {
      await mettrePret(colis, agent);
    } else if (statut === STATUTS.CHARGE) {
      colis.ajouterEvenement(statut, 'Départ du lot annulé', { agent: agent._id, label: 'De retour au dépôt (départ annulé)' });
    } else {
      colis.ajouterEvenement(statut, 'Mise à jour par l\'administration', { agent: agent._id });
      if (statut === STATUTS.EN_TRANSIT) {
        const pays = nomPays(paysArriveeDe(colis.sens));
        notifier(colis.expediteur.telephone, MESSAGES.en_transit(colis, pays));
        notifier(colis.destinataire.telephone, MESSAGES.en_transit(colis, pays));
      }
      if (statut === STATUTS.ARRIVE) notifier(colis.destinataire.telephone, MESSAGES.arrive(colis, nomPays(paysArriveeDe(colis.sens))));
    }
    if (statut !== STATUTS.CHARGE) marquerRetour(colis, avant);
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
      soldeEur: solde.soldeEur,
      magasinage: solde.magasinage,
      empreinteCode: Colis.empreinteCode(c.numeroSuivi, c.codeRetrait),
      aLivrer: !!(c.livraison?.demande && c.livraison.statut !== 'annulee'),
    };
  });
}

module.exports = {
  ErreurMetier, normTel, masquerTel, lieAuCompte, vuePublique, vueComplete, avecOperation,
  encaisser, deposer, appliquerScan, sensDepuisAgences, paysArriveeDe, nomPays, remettre, changerStatutMasse, colisDuGuichet,
  mettrePret, calculerMagasinage, etapePrecedente, annulerEtape, nettoyerArticles, articlesTexte,
};
