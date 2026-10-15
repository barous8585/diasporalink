// ─────────────────────────────────────────────────────────────
//  Courses à domicile : ramassage chez l'expéditeur, livraison chez le destinataire
//
//  Ramassage : le client réserve avec une adresse → un livreur de l'agence de départ
//  prend la course → « Ramassé » → il rapporte le colis à l'agence, où il est pesé
//  et enregistré comme un dépôt normal.
//  Livraison : le colis arrive à l'agence de retrait (code généré) → un livreur le
//  prend (« Je pars livrer ») → chez le destinataire : code + signature + paiement.
//  Échec : le colis revient en rayon à l'agence, la course repasse « à planifier ».
// ─────────────────────────────────────────────────────────────
const Colis = require('../models/Colis');
const Config = require('../models/Config');
const { calculerCourse, distanceKm, pointValide } = require('../utils/tarif');
const { notifier } = require('../utils/sms');
const { STATUTS, STATUTS_COURSE, MOMENTS, APP_NOM_COURT } = require('../config/constants');
const svc = require('./colisService');

const { ErreurMetier, normTel } = svc;
const COURSES = ['ramassage', 'livraison'];
const OUVERTES = [STATUTS_COURSE.A_PLANIFIER, STATUTS_COURSE.ASSIGNEE, STATUTS_COURSE.EN_ROUTE];

// ── Positions ───────────────────────────────────────────────
// Extrait { lat, lng } d'un lien Google Maps / Apple Plans / WhatsApp, ou de « 9.51, -13.71 ».
function positionDepuisTexte(texte) {
  const t = decodeURIComponent(String(texte || ''));
  const motifs = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,            // lien long Google Maps (lieu exact)
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,              // …/@9.51,-13.71,17z
    /[?&](?:q|query|ll|daddr|destination|center)=(?:loc:)?(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)\s*$/, // coordonnées collées
    /(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/,  // coordonnées dans un texte
  ];
  for (const m of motifs) {
    const r = t.match(m);
    if (r) {
      const p = { lat: parseFloat(r[1]), lng: parseFloat(r[2]) };
      if (pointValide(p)) return p;
    }
  }
  return null;
}

// Liens courts (maps.app.goo.gl, goo.gl/maps) : on suit les redirections côté serveur.
// En Europe, Google peut renvoyer vers sa page de consentement (consent.google.com) :
// on lit alors l'adresse d'origine dans « continue », et on envoie un cookie de consentement.
// Domaines Google uniquement (google.com, google.fr, google.com.gn, google.co.uk…) : un domaine
// comme « google.exemple.com » est refusé, sinon le serveur pourrait être envoyé vers n'importe où.
const HOTES_GOOGLE = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|(?:(?:consent|maps|www)\.)?google\.(?:com|[a-z]{2}|com?\.[a-z]{2}))$/i;
const ENTETES_GOOGLE = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  Cookie: 'CONSENT=YES+cb.20240101-00-p0.fr+FX+000; SOCS=CAI',
};
// Coordonnées dans une page Google Maps (aperçu de carte, épingle, centre)
function positionDansPage(html) {
  const motifs = [
    /center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/,
    /markers=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /\[null,null,(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})\]/,
  ];
  for (const m of motifs) {
    const r = html.match(m);
    if (r) { const p = { lat: parseFloat(r[1]), lng: parseFloat(r[2]) }; if (pointValide(p)) return p; }
  }
  return null;
}
async function positionDepuisLien(texte) {
  const direct = positionDepuisTexte(texte);
  if (direct) return direct;
  const m = String(texte || '').match(/https?:\/\/[^\s]+/);
  if (!m) return null;
  let url = m[0];
  for (let i = 0; i < 6; i++) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (!HOTES_GOOGLE.test(u.hostname)) return null; // on ne suit que les liens Google
    if (/^consent\./i.test(u.hostname) && u.searchParams.get('continue')) {
      url = u.searchParams.get('continue');
      const p = positionDepuisTexte(url);
      if (p) return p;
      continue;
    }
    const res = await fetch(url, { redirect: 'manual', headers: ENTETES_GOOGLE, signal: AbortSignal.timeout(7000) }).catch(() => null);
    if (!res) return null;
    const suivant = res.headers.get('location');
    if (!suivant) {
      const html = res.status === 200 ? (await res.text()).slice(0, 400000) : '';
      return positionDansPage(html);
    }
    url = new URL(suivant, url).toString();
    const p = positionDepuisTexte(url);
    if (p) return p;
  }
  return null;
}

function nettoyerPoint(p) {
  if (!p) return null;
  const point = { lat: parseFloat(p.lat), lng: parseFloat(p.lng) };
  if (!pointValide(point)) return null;
  if (p.precision) point.precision = Math.round(parseFloat(p.precision)) || undefined;
  if (['gps', 'carte', 'lien', 'adresse'].includes(p.source)) point.source = p.source;
  point.le = new Date();
  return point;
}

// ── Demande de course (réservation, guichet, suivi) ─────────
/**
 * Remplit colis[type] à partir de la demande. Le prix est calculé dès que la
 * position est connue ; pour une livraison, elle peut arriver plus tard
 * (le destinataire l'envoie depuis la page de suivi).
 */
async function demanderCourse(colis, type, data) {
  if (!COURSES.includes(type)) throw new ErreurMetier('Type de course inconnu.');
  if (!data || data.demande === false) {
    if (colis[type]?.demande) {
      if (colis[type].statut === STATUTS_COURSE.FAITE) throw new ErreurMetier('Course déjà faite.');
      if (colis[type].statut === STATUTS_COURSE.EN_ROUTE) throw new ErreurMetier('Le livreur est déjà en route.');
      colis[type].demande = false;
      colis[type].statut = STATUTS_COURSE.ANNULEE;
      colis.historique.push({ label: type === 'ramassage' ? 'Ramassage annulé' : 'Livraison à domicile annulée', detail: 'Retrait à l\'agence', le: new Date() });
    }
    return colis[type];
  }
  const config = await Config.get();
  const codeAgence = type === 'ramassage' ? colis.depot : colis.guichet;
  const agence = await Config.lieu(codeAgence);
  if (!agence) throw new ErreurMetier('Agence inconnue.');

  const a = data.adresse || {};
  const position = nettoyerPoint(a.position) || (a.lien ? nettoyerPoint(await positionDepuisLien(a.lien)) : null);
  if (a.lien && !position) throw new ErreurMetier('Lien de position non reconnu. Envoyez la position depuis Google Maps ou WhatsApp.');
  const precedent = colis[type]?.demande && colis[type].statut !== STATUTS_COURSE.ANNULEE ? colis[type] : null;
  // Une livraison payée puis annulée reste payée : si elle est redemandée, le paiement compte
  const dejaPaye = { payeGnf: colis[type]?.payeGnf || 0, payeeLe: colis[type]?.payeeLe };

  const adresse = {
    nom: (a.nom || '').trim() || (type === 'ramassage' ? colis.expediteur?.nom : colis.destinataire?.nom),
    telephone: normTel(a.telephone) || (type === 'ramassage' ? colis.expediteur?.telephone : colis.destinataire?.telephone),
    ville: (a.ville || '').trim(),
    commune: (a.commune || '').trim(),
    quartier: (a.quartier || '').trim().slice(0, 120),
    rue: (a.rue || '').trim().slice(0, 200),
    repere: (a.repere || '').trim().slice(0, 200),
    position: position || precedent?.adresse?.position || undefined,
  };
  // Quartier, repère et position aident le livreur mais ne bloquent jamais la réservation :
  // s'ils manquent, la course est créée « adresse à compléter » et le prix sera calculé
  // dès que la position sera connue (le livreur appelle le client au besoin).

  let prix = {};
  if (adresse.position) {
    const c = calculerCourse(config, agence, adresse.position, { taux: colis.tarif?.taux });
    if (!c.ok) throw new ErreurMetier(c.message);
    prix = { distanceKm: c.distanceKm, prix: c.prix, devise: c.devise, prixGnf: c.prixGnf };
  } else {
    const dispo = calculerCourse(config, agence, { lat: 1, lng: 1 }); // vérifie seulement que le service existe
    if (!dispo.ok && dispo.raison !== 'trop_loin') throw new ErreurMetier(dispo.message);
    prix = { distanceKm: undefined, prix: undefined, devise: agence.pays === 'FR' ? 'EUR' : 'GNF', prixGnf: 0 };
  }
  const moment = MOMENTS.some(m => m.key === data.moment) ? data.moment : undefined;
  const jour = data.jour ? new Date(data.jour) : undefined;

  colis[type] = {
    ...(precedent ? (precedent.toObject?.() || precedent) : {}),
    demande: true,
    statut: precedent?.statut || STATUTS_COURSE.A_PLANIFIER,
    agence: agence.code,
    adresse,
    jour: jour && !isNaN(jour) ? jour : precedent?.jour,
    moment: moment || precedent?.moment,
    ...prix,
    ...dejaPaye,
  };
  if (!precedent) {
    colis.historique.push({
      label: type === 'ramassage' ? 'Ramassage à domicile demandé' : 'Livraison à domicile demandée',
      detail: [adresse.quartier || adresse.commune, adresse.ville].filter(Boolean).join(', '),
      le: new Date(),
    });
  }
  return colis[type];
}

// ── Vue d'une course pour les livreurs et l'admin ──────────
async function vueCourse(colis, type, config) {
  const c = colis[type];
  const agence = (config.agences || []).find(a => a.code === c.agence);
  const solde = require('../utils/tarif').calculerSolde(colis, config);
  return {
    type,
    numeroSuivi: colis.numeroSuivi,
    statutColis: colis.statut,
    statut: c.statut,
    agence: c.agence,
    agenceNom: agence?.nom || c.agence,
    agencePays: agence?.pays,
    adresse: c.adresse,
    jour: c.jour, moment: c.moment,
    distanceKm: c.distanceKm, prix: c.prix, devise: c.devise,
    livreur: c.livreur, livreurNom: c.livreurNom, assigneeLe: c.assigneeLe, faiteLe: c.faiteLe,
    ecartM: c.ecartM, echecs: c.echecs,
    contact: type === 'ramassage' ? colis.expediteur : colis.destinataire,
    nbCartons: colis.nbCartons,
    poids: colis.poidsReel || colis.poidsEstime,
    description: colis.description,
    // À encaisser chez le client : tout le solde à la livraison ; au ramassage rien (payé à l'agence)
    soldeGnf: solde.soldeGnf, soldeEur: solde.soldeEur,
    // Payée d'avance en ligne, ou tout le colis réglé (au comptoir par exemple)
    payee: !!(c.prixGnf > 0 && (c.payeGnf || 0) >= c.prixGnf) || (solde.soldeGnf === 0 && !colis.tarif?.estime),
    payeGnf: c.payeGnf || 0,
    empreinteCode: type === 'livraison' && colis.codeRetrait ? Colis.empreinteCode(colis.numeroSuivi, colis.codeRetrait) : undefined,
    majLe: colis.updatedAt,
  };
}

// Courses ouvertes d'une agence (ou toutes pour l'admin)
async function coursesOuvertes({ agence, livreur } = {}) {
  const config = await Config.get();
  const res = [];
  for (const type of COURSES) {
    const filtre = { [`${type}.demande`]: true, [`${type}.statut`]: { $in: OUVERTES } };
    if (agence) filtre[`${type}.agence`] = agence;
    if (livreur) filtre[`${type}.livreur`] = livreur;
    // Ramassage : tant que le colis n'est pas déposé. Livraison : une fois le colis à l'agence.
    filtre.statut = type === 'ramassage' ? STATUTS.RESERVE : { $in: [STATUTS.PRET, STATUTS.EN_LIVRAISON, STATUTS.ARRIVE, STATUTS.ACHEMINEMENT, STATUTS.EN_TRANSIT, STATUTS.CHARGE, STATUTS.DEPOSE] };
    const liste = await Colis.find(filtre).select('+codeRetrait').limit(300);
    for (const c of liste) res.push(await vueCourse(c, type, config));
  }
  // Prêtes d'abord (livraisons à l'agence, ramassages), puis par date souhaitée
  const rang = (v) => (v.type === 'livraison' && ![STATUTS.PRET, STATUTS.EN_LIVRAISON].includes(v.statutColis) ? 1 : 0);
  return res.sort((a, b) => rang(a) - rang(b) || new Date(a.jour || a.majLe) - new Date(b.jour || b.majLe));
}

async function chargerCourse(numero, type) {
  if (!COURSES.includes(type)) throw new ErreurMetier('Type de course inconnu.');
  const colis = await Colis.findOne({ numeroSuivi: String(numero || '').trim().toUpperCase() }).select('+codeRetrait +codeEssais');
  if (!colis || !colis[type]?.demande) throw new ErreurMetier('Course introuvable.', 404);
  return colis;
}

function verifierLivreur(colis, type, livreur) {
  const c = colis[type];
  if (livreur.role === 'admin') return;
  if (livreur.lieu && c.agence !== livreur.lieu) throw new ErreurMetier('Cette course dépend d\'une autre agence.', 403);
  if (c.livreur && String(c.livreur) !== String(livreur._id)) throw new ErreurMetier(`Course déjà prise par ${c.livreurNom || 'un autre livreur'}.`, 409);
}

// Assigner (admin) ou prendre soi-même (livreur)
async function assigner(numero, type, livreur, { par } = {}) {
  const colis = await chargerCourse(numero, type);
  const c = colis[type];
  if (!OUVERTES.includes(c.statut)) throw new ErreurMetier('Course terminée.', 409);
  if (c.statut === STATUTS_COURSE.EN_ROUTE) throw new ErreurMetier('Le livreur est déjà en route avec ce colis.', 409);
  if (livreur) {
    if (!par || par.role !== 'admin') verifierLivreur(colis, type, livreur);
    c.livreur = livreur._id;
    c.livreurNom = `${livreur.prenom} ${livreur.nom}`;
    c.assigneeLe = new Date();
    c.statut = STATUTS_COURSE.ASSIGNEE;
  } else {
    c.livreur = undefined; c.livreurNom = undefined; c.assigneeLe = undefined;
    c.statut = STATUTS_COURSE.A_PLANIFIER;
  }
  colis.markModified(type);
  await colis.save();
  return colis;
}

// Écart (m) entre la position du livreur et l'adresse : contrôle a posteriori
function ecartAdresse(c, positionLivreur) {
  const p = nettoyerPoint(positionLivreur);
  if (!p) return {};
  const ecartM = pointValide(c.adresse?.position) ? Math.round(distanceKm(p, c.adresse.position) * 1000) : undefined;
  return { positionLivreur: p, ecartM };
}

// Ramassage fait : le colis est avec le livreur, il le rapporte à l'agence
async function ramasser(numero, livreur, { position, opId } = {}) {
  const colis = await chargerCourse(numero, 'ramassage');
  const c = colis.ramassage;
  if (c.statut === STATUTS_COURSE.FAITE) return { colis, rejoue: true };
  if (colis.statut !== STATUTS.RESERVE) throw new ErreurMetier('Ce colis est déjà déposé à l\'agence.', 409);
  verifierLivreur(colis, 'ramassage', livreur);
  Object.assign(c, ecartAdresse(c, position), {
    statut: STATUTS_COURSE.FAITE, faiteLe: new Date(),
    livreur: livreur._id, livreurNom: `${livreur.prenom} ${livreur.nom}`,
  });
  colis.markModified('ramassage');
  colis.historique.push({ label: 'Ramassé à domicile', detail: `Par ${c.livreurNom}, en route vers l'agence`, lieu: c.agence, agent: livreur._id, le: new Date() });
  await colis.save();
  notifier(colis.expediteur.telephone, `${APP_NOM_COURT} : votre colis ${colis.numeroSuivi} a été ramassé par ${c.livreurNom}. Il sera pesé à l'agence.`);
  return { colis, opId };
}

// Le livreur part avec le colis vers le destinataire
async function partirLivrer(numero, livreur) {
  const colis = await chargerCourse(numero, 'livraison');
  const c = colis.livraison;
  if (colis.statut === STATUTS.EN_LIVRAISON && String(c.livreur) === String(livreur._id)) return { colis, dejaFait: true };
  if (colis.statut !== STATUTS.PRET) throw new ErreurMetier('Le colis n\'est pas encore à l\'agence.', 409);
  verifierLivreur(colis, 'livraison', livreur);
  if (!pointValide(c.adresse?.position)) throw new ErreurMetier('Position du destinataire inconnue : demandez-lui sa localisation avant de partir.', 409);
  Object.assign(c, {
    statut: STATUTS_COURSE.EN_ROUTE, livreur: livreur._id, livreurNom: `${livreur.prenom} ${livreur.nom}`,
    assigneeLe: c.assigneeLe || new Date(),
  });
  colis.markModified('livraison');
  colis.ajouterEvenement(STATUTS.EN_LIVRAISON, `Avec ${c.livreurNom}`, { lieu: c.agence, agent: livreur._id });
  await colis.save();
  notifier(colis.destinataire.telephone, `${APP_NOM_COURT} : ${c.livreurNom} arrive avec votre colis ${colis.numeroSuivi}. Préparez votre code de retrait.`);
  return { colis };
}

// Remise chez le destinataire : mêmes règles qu'au guichet (code, solde payé, signature)
async function livrer(livreur, data) {
  const colis = await chargerCourse(data.numero, 'livraison');
  if (colis.statut === STATUTS.REMIS) {
    if (data.opId && colis.remise?.opId === data.opId) return { colis: await svc.vueComplete(colis), rejoue: true };
    throw new ErreurMetier('Ce colis a déjà été remis.', 409);
  }
  if (colis.statut !== STATUTS.EN_LIVRAISON) throw new ErreurMetier('Appuyez d\'abord sur « Je pars livrer » à l\'agence.', 409);
  verifierLivreur(colis, 'livraison', livreur);
  return svc.remettre(livreur, {
    ...data, aDomicile: true,
    avantSauvegarde: (doc) => {
      Object.assign(doc.livraison, ecartAdresse(doc.livraison, data.position), { statut: STATUTS_COURSE.FAITE, faiteLe: new Date() });
      doc.markModified('livraison');
    },
  });
}

// Échec (absent, injoignable, adresse introuvable, refus…)
async function echec(numero, type, livreur, motif) {
  const colis = await chargerCourse(numero, type);
  const c = colis[type];
  if (!OUVERTES.includes(c.statut)) throw new ErreurMetier('Course terminée.', 409);
  verifierLivreur(colis, type, livreur);
  c.echecs = [...(c.echecs || []), { le: new Date(), motif: String(motif || 'Non précisé').slice(0, 200), livreur: livreur._id }];
  c.statut = STATUTS_COURSE.A_PLANIFIER;
  c.livreur = undefined; c.livreurNom = undefined; c.assigneeLe = undefined;
  colis.markModified(type);
  const label = type === 'ramassage' ? 'Ramassage manqué' : 'Livraison manquée';
  if (type === 'livraison' && colis.statut === STATUTS.EN_LIVRAISON) {
    // Le colis revient en rayon : le destinataire peut aussi venir le retirer
    colis.ajouterEvenement(STATUTS.PRET, `${label} : ${motif || ''}`.trim(), { lieu: c.agence, agent: livreur._id, label: 'De retour à l\'agence' });
  } else {
    colis.historique.push({ label, detail: motif, lieu: c.agence, agent: livreur._id, le: new Date() });
  }
  await colis.save();
  const tel = type === 'ramassage' ? colis.expediteur.telephone : colis.destinataire.telephone;
  notifier(tel, `${APP_NOM_COURT} : ${label.toLowerCase()} pour le colis ${colis.numeroSuivi}. Nous vous rappelons pour un nouveau passage.`);
  return colis;
}

module.exports = {
  COURSES, OUVERTES, positionDepuisTexte, positionDepuisLien, demanderCourse, vueCourse, coursesOuvertes,
  assigner, ramasser, partirLivrer, livrer, echec,
};
