// ─────────────────────────────────────────────────────────────
//  Simulation : 30 jours d'activité fictive d'une entreprise qui tourne bien
//  (clients, réservations, dépôts, lots, transport, guichets, remises, courses à
//  domicile, paiements, caisses, factures, réclamations).
//
//  Tout est marqué demo: true et numéroté à part (DEMO-26-…, DEMO-FA-…, DEMO-AIR-…) :
//  la vraie numérotation n'est jamais consommée, et tout s'efface d'un coup.
//  Aucune notification (SMS, push) n'est envoyée : on écrit directement les données.
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');
const Colis = require('../models/Colis');
const Lot = require('../models/Lot');
const User = require('../models/User');
const Facture = require('../models/Facture');
const Reclamation = require('../models/Reclamation');
const Compteur = require('../models/Compteur');
const Config = require('../models/Config');
const { Mouvement, Cloture } = require('../models/Mouvement');
const { calculerTarif, calculerCourse, enGnf } = require('../utils/tarif');
const { STATUTS, STATUTS_LABELS, STATUTS_LOT, STATUTS_COURSE, TYPES_COLIS } = require('../config/constants');
const factureService = require('./factureService');

const J = 86400000;
const H = 3600000;

// Hasard reproductible (la même simulation donne les mêmes chiffres)
function hasard(graine = 20261015) {
  let s = graine >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    r,
    entre: (a, b) => a + (b - a) * r(),
    ent: (a, b) => Math.floor(a + (b - a + 1) * r()),
    un: (liste) => liste[Math.floor(r() * liste.length)],
    pondere: (paires) => { const t = paires.reduce((s, [, p]) => s + p, 0); let x = r() * t; for (const [v, p] of paires) { if ((x -= p) <= 0) return v; } return paires[paires.length - 1][0]; },
    proba: (p) => r() < p,
  };
}

const PRENOMS_H = ['Mamadou', 'Ibrahima', 'Alpha', 'Thierno', 'Abdoulaye', 'Ousmane', 'Sekou', 'Lamine', 'Boubacar', 'Mohamed', 'Elhadj', 'Moussa', 'Amadou', 'Souleymane', 'Aboubacar', 'Cheick', 'Mamoudou', 'Oumar', 'Saïdou', 'Kerfala', 'Fodé', 'Ismaël', 'Karim', 'Youssouf'];
const PRENOMS_F = ['Fatoumata', 'Aïssatou', 'Mariama', 'Oumou', 'Kadiatou', 'Hawa', 'Binta', 'Nènè', 'Aminata', 'Saran', 'Djenabou', 'Hadja', 'Fanta', 'Mabinty', 'Ramatoulaye', 'Kadija', 'Bountouraby', 'Néné Oumou', 'Hadiatou', 'Safiatou', 'Assiatou', 'Maïmouna', 'Rouguiatou', 'Djariou'];
const NOMS = ['Diallo', 'Barry', 'Bah', 'Camara', 'Sow', 'Condé', 'Touré', 'Keïta', 'Sylla', 'Soumah', 'Kouyaté', 'Baldé', 'Cissé', 'Fofana', 'Traoré', 'Konaté', 'Kaba', 'Doumbouya', 'Kanté', 'Bangoura', 'Diakité', 'Sacko', 'Kourouma', 'Haïdara', 'Dramé', 'Savané', 'Yansané', 'Kamano', 'Millimono', 'Loua'];
const QUARTIERS = { GN: ['Kipé', 'Ratoma', 'Lambanyi', 'Kaloum', 'Dixinn', 'Matam', 'Cosa', 'Taouyah', 'Hamdallaye', 'Bambeto', 'Sonfonia', 'Koloma', 'Nongo', 'Kagbélén', 'Simbaya'], FR: ['Château-Rouge', 'Barbès', 'Saint-Denis', 'Aubervilliers', 'Montreuil', 'Bobigny', 'La Courneuve', 'Sarcelles', 'Créteil', 'Évry'] };
const DESCRIPTIONS = { vetements: ['vêtements et pagnes', 'habits pour la famille', 'tissus et basins', 'vêtements enfants'], alimentaire: ['riz, huile et lait', 'épices et condiments', 'café, sucre, conserves'], documents: ['papiers administratifs', 'diplômes et dossiers'], mixte: ['vêtements et cosmétiques', 'affaires diverses', 'cadeaux pour la famille'], fragile: ['vaisselle', 'miroir et cadres'], electronique: ['téléphone et accessoires', 'ordinateur portable', 'télévision'] };
const TRANSPORTEURS = { air: ['Air France', 'Royal Air Maroc', 'Brussels Airlines', 'Air Sénégal'], express: ['Air France Cargo', 'DHL Aviation'], mer: ['CMA CGM', 'MSC', 'Maersk', 'Grimaldi'] };
const CENTRE = { GN: { lat: 9.5370, lng: -13.6773 }, FR: { lat: 48.8566, lng: 2.3522 } };

let enCours = null;      // { debut, etape, fait, total }
let dernierResultat = null;

function etat() { return { enCours: !!enCours, ...(enCours || {}), dernier: dernierResultat }; }

async function compter() {
  const [colis, factures, lots, utilisateurs, reclamations, mouvements] = await Promise.all([
    Colis.countDocuments({ demo: true }), Facture.countDocuments({ demo: true }), Lot.countDocuments({ demo: true }),
    User.countDocuments({ demo: true }), Reclamation.countDocuments({ demo: true }), Mouvement.countDocuments({ demo: true }),
  ]);
  return { colis, factures, lots, utilisateurs, reclamations, mouvements };
}

async function effacer() {
  if (enCours) throw Object.assign(new Error('Une simulation est en cours, patientez.'), { status: 409 });
  const r = await purger();
  require('../utils/temps-reel').taire(false);
  dernierResultat = null;
  return r;
}

async function purger() {
  const ids = (await Colis.find({ demo: true }).select('_id').lean()).map(c => c._id);
  const res = await Promise.all([
    Colis.deleteMany({ demo: true }), Facture.deleteMany({ demo: true }), Lot.deleteMany({ demo: true }),
    Mouvement.deleteMany({ demo: true }), Cloture.deleteMany({ demo: true }), Reclamation.deleteMany({ demo: true }),
    User.deleteMany({ demo: true }), ids.length ? require('../models/Photo').deleteMany({ colis: { $in: ids } }) : null,
  ]);
  // Les compteurs de la démo repartent de 1 (les vrais ne sont pas touchés)
  await Compteur.deleteMany({ _id: { $regex: /demo|^DEMO-/i } });
  return { colis: res[0].deletedCount, factures: res[1].deletedCount, lots: res[2].deletedCount, utilisateurs: res[6].deletedCount };
}

function lancer(options = {}) {
  if (enCours) throw Object.assign(new Error('Une simulation est déjà en cours.'), { status: 409 });
  enCours = { debut: new Date(), etape: 'Préparation', fait: 0, total: 0 };
  require('../utils/temps-reel').taire(true);
  generer(options)
    .then(r => { dernierResultat = { ...r, fini: new Date() }; })
    .catch(e => { console.error('[simulation]', e); dernierResultat = { erreur: e.message, fini: new Date() }; })
    .finally(() => { enCours = null; require('../utils/temps-reel').taire(false); });
  return etat();
}

async function generer({ jours = 30, parJour = 55 } = {}) {
  await purger();
  enCours = enCours || { debut: new Date() };
  const R = hasard();
  const config = await Config.get();
  const maintenant = Date.now();
  const debut = maintenant - jours * J;
  const agences = (config.agences || []).filter(a => a.actif !== false);
  const parPays = (p) => agences.filter(a => a.pays === p);
  if (!parPays('FR').length || !parPays('GN').length) throw new Error('Il faut au moins une agence en France et une en Guinée.');
  const plateforme = (p) => parPays(p).find(a => a.plateforme) || parPays(p)[0];
  // Position des agences (pour les courses) : la vraie, ou le centre-ville à défaut
  const posAgence = (a) => (a.position?.lat ? a.position : CENTRE[a.pays]);
  const agencePos = (a) => ({ ...a, position: posAgence(a) });
  const taux = config.tauxEurGnf || 10000;

  // ── Équipe fictive : 2 agents et 2 livreurs par agence ──
  enCours.etape = 'Équipe';
  let numTel = 0;
  const tel = (pays) => { numTel++; return pays === 'FR' ? `+3378${String(10000000 + numTel).slice(-7)}` : `+22462${String(9000000 + numTel).slice(-7)}`; };
  const equipe = {};
  for (const a of agences) {
    equipe[a.code] = { agents: [], livreurs: [] };
    for (const [role, n] of [['agent', 2], ['livreur', 2]]) {
      for (let i = 0; i < n; i++) {
        const f = R.proba(0.4);
        const u = await User.create({ demo: true, telephone: tel(a.pays), prenom: R.un(f ? PRENOMS_F : PRENOMS_H), nom: R.un(NOMS), role, lieu: a.code, verifie: true });
        equipe[a.code][role === 'agent' ? 'agents' : 'livreurs'].push(u);
      }
    }
  }

  // ── Clients : expéditeurs et destinataires des deux pays ; 40 % ont un compte ──
  enCours.etape = 'Clients';
  const personne = (pays) => { const f = R.proba(0.5); return { nom: `${R.un(f ? PRENOMS_F : PRENOMS_H)} ${R.un(NOMS)}`, telephone: tel(pays), pays }; };
  const clientsFR = Array.from({ length: 420 }, () => personne('FR'));
  const clientsGN = Array.from({ length: 300 }, () => personne('GN'));
  const comptes = new Map();
  const avecCompte = [...clientsFR, ...clientsGN].filter(() => R.proba(0.4));
  const docs = await User.insertMany(avecCompte.map(p => ({ demo: true, telephone: p.telephone, prenom: p.nom.split(' ')[0], nom: p.nom.split(' ').slice(1).join(' '), role: 'client', verifie: true })));
  docs.forEach(u => comptes.set(u.telephone, u));
  // Clients fidèles : 20 % des clients font 60 % des envois
  const choisir = (liste) => (R.proba(0.6) ? liste[R.ent(0, Math.floor(liste.length * 0.2) - 1)] : R.un(liste));

  // ── Lots : départs programmés (express tous les jours, avion 3 fois par semaine, bateau chaque semaine) ──
  const lots = new Map();
  const transit = { express: [2, 3], air: [4, 7], mer: [26, 38] };
  const prochainDepart = (sens, mode, apres) => {
    const d = new Date(apres + 0.4 * J); d.setHours(mode === 'mer' ? 10 : 22, 0, 0, 0);
    for (let k = 0; k < 14; k++) {
      const jour = d.getDay();
      const ok = mode === 'express' ? jour !== 0 : mode === 'air' ? [2, 4, 6].includes(jour) : jour === 3;
      if (ok && d.getTime() > apres) return d.getTime();
      d.setTime(d.getTime() + J);
    }
    return d.getTime();
  };
  const lotPour = async (sens, mode, depart) => {
    const cle = `${sens}|${mode}|${depart}`;
    if (!lots.has(cle)) {
      const [pd, pa] = sens.split('-');
      const arrivee = depart + R.entre(...transit[mode]) * J;
      const statut = arrivee <= maintenant ? (arrivee + 4 * J <= maintenant ? STATUTS_LOT.CLOTURE : STATUTS_LOT.ARRIVE) : depart <= maintenant ? STATUTS_LOT.PARTI : STATUTS_LOT.PREPARATION;
      const doc = await Lot.create({
        demo: true, sens, mode, depot: plateforme(pd).code, destination: plateforme(pa).code, statut,
        reference: mode === 'mer' ? `${R.un(['MSCU', 'CMAU', 'MAEU'])}${R.ent(1000000, 9999999)}` : `${R.un(['AF', 'AT', 'SN', 'HC'])} ${R.ent(500, 899)}`,
        transporteur: R.un(TRANSPORTEURS[mode]),
        dateDepartPrevue: new Date(depart), dateArriveePrevue: new Date(arrivee),
        departLe: depart <= maintenant ? new Date(depart) : undefined, arriveLe: arrivee <= maintenant ? new Date(arrivee) : undefined,
        createdAt: new Date(depart - 3 * J),
      });
      lots.set(cle, { arrivee, doc });
    }
    return lots.get(cle);
  };

  // ── Colis jour par jour ──
  enCours.etape = 'Colis';
  const typesPoids = [['vetements', 45], ['mixte', 20], ['alimentaire', 15], ['electronique', 8], ['documents', 7], ['fragile', 5]];
  const articlesDispo = (sens, mode) => (config.articles || []).filter(a => a.actif !== false && Number.isFinite(parseFloat(a.prix?.[sens]?.[mode])));
  const plans = [];
  for (let jour = 0; jour < jours; jour++) {
    const date = new Date(debut + jour * J);
    const semaine = [0.55, 1.05, 1.0, 1.1, 1.05, 1.2, 1.35][date.getDay()]; // samedi chargé, dimanche calme
    const croissance = 0.75 + 0.5 * (jour / jours);                         // l'activité monte sur le mois
    const n = Math.round(parJour * semaine * croissance * R.entre(0.85, 1.15));
    for (let i = 0; i < n; i++) plans.push(date.getTime() + R.entre(8, 20) * H);
  }
  enCours.total = plans.length;

  const factures = [];
  const facturesCfg = config;
  const mouvements = [];
  const remisesPourReclamations = [];
  let facRemise;
  for (const creeLe of plans) {
    const sens = R.proba(0.68) ? 'FR-GN' : 'GN-FR';
    const [pd, pa] = sens.split('-');
    const mode = R.pondere([['air', 52], ['mer', 30], ['express', 18]]);
    const depot = pd === 'FR' ? R.pondere(parPays('FR').map(a => [a, a.plateforme ? 3 : 1])) : R.pondere(parPays('GN').map(a => [a, a.plateforme ? 3 : 2]));
    const guichet = R.pondere(parPays(pa).map(a => [a, a.plateforme ? 3 : 2]));
    const exp = choisir(pd === 'FR' ? clientsFR : clientsGN);
    const dest = choisir(pa === 'FR' ? clientsFR : clientsGN);
    const enLigne = R.proba(0.45);
    const typeColis = R.pondere(typesPoids);
    const poids = Math.round((mode === 'mer' ? R.entre(8, 60) : mode === 'express' ? R.entre(0.8, 8) : R.entre(2.5, 28)) * 10) / 10;
    const dispo = articlesDispo(sens, mode);
    const articles = dispo.length && R.proba(0.15) ? [{ cle: R.un(dispo).cle, quantite: R.ent(1, 3) }] : [];
    const assurance = typeColis === 'electronique' || R.proba(0.08);
    const valeur = assurance ? R.ent(15, 120) * (pd === 'FR' ? 10 : 100000) : 0;
    const tarif = calculerTarif(config, { sens, mode, poidsKg: poids, typeColis, valeurDeclaree: valeur, assurance, articles: articles.map(a => ({ ...a, ...dispo.find(x => x.cle === a.cle) })) });
    const agentDepot = R.un(equipe[depot.code].agents);
    const agentGuichet = R.un(equipe[guichet.code].agents);
    const payeurArrivee = R.proba(0.14);
    const compte = comptes.get(exp.telephone);
    const deposeLe = enLigne ? creeLe + R.entre(1, 52) * H : creeLe;

    const colis = new Colis({
      demo: true, client: enLigne && compte ? compte._id : undefined,
      expediteur: { nom: exp.nom, telephone: exp.telephone }, destinataire: { nom: dest.nom, telephone: dest.telephone },
      sens, mode, depot: depot.code, guichet: guichet.code, typeColis,
      description: R.un(DESCRIPTIONS[typeColis] || DESCRIPTIONS.mixte), nbCartons: poids > 25 ? R.ent(2, 4) : 1,
      articles: tarif.articles?.length ? tarif.articles.map(a => ({ cle: a.cle, label: a.label, quantite: a.quantite })) : undefined,
      poidsEstime: Math.max(0.5, Math.round((poids + R.entre(-1.5, 1.5)) * 10) / 10),
      valeurDeclaree: valeur, assurance, payeurArrivee,
      cgv: { version: '2026-10-15', accepteesLe: new Date(creeLe), par: enLigne ? 'en_ligne' : 'comptoir' },
      historique: [], paiements: [], createdAt: new Date(creeLe),
    });
    const ev = (statut, le, detail, lieu, agent) => { if (le <= maintenant) colis.historique.push({ statut, label: STATUTS_LABELS[statut], detail, lieu, agent: agent?._id, le: new Date(le) }); if (le <= maintenant && statut) colis.statut = statut; };
    const payer = (montant, devise, methode, le, { lieu, agent, objet = 'global', enLigneP = false } = {}) => {
      if (le > maintenant || !(montant > 0)) return;
      const ref = methode === 'especes' ? undefined : `${methode === 'orange_money' ? 'OM' : methode === 'mtn_momo' ? 'MM' : 'CB'}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      colis.paiements.push({ montant, devise, methode, objet, lieu: enLigneP ? 'EN_LIGNE' : lieu, agent: enLigneP ? undefined : agent?._id, reference: ref, le: new Date(le) });
      if (!enLigneP && agent) mouvements.push({ demo: true, agent: agent._id, lieu, numeroSuivi: null, colisRef: colis, montant, devise, methode, objet, reference: ref, le: new Date(le) });
    };
    const moyen = (pays) => (pays === 'FR' ? R.pondere([['especes', 35], ['carte', 40], ['orange_money', 10], ['virement', 5]]) : R.pondere([['especes', 55], ['orange_money', 30], ['mtn_momo', 15]]));

    // Réservation en ligne
    colis.statut = STATUTS.RESERVE;
    if (enLigne) ev(STATUTS.RESERVE, creeLe, 'Réservation en ligne');

    // Courses à domicile
    const avecRamassage = R.proba(0.13);
    const avecLivraison = R.proba(0.2);
    const course = (agence, quand, faiteLe, livreurs) => {
      const p = { lat: posAgence(agence).lat + R.entre(-0.05, 0.05), lng: posAgence(agence).lng + R.entre(-0.05, 0.05), source: R.pondere([['gps', 5], ['adresse', 3], ['lien', 2]]) };
      const c = calculerCourse(config, agencePos(agence), p, { taux });
      if (!c.ok) return undefined;
      const livreur = R.un(livreurs);
      const faite = faiteLe && faiteLe <= maintenant;
      return {
        demande: true, agence: agence.code, statut: faite ? STATUTS_COURSE.FAITE : (quand <= maintenant ? STATUTS_COURSE.ASSIGNEE : STATUTS_COURSE.A_PLANIFIER),
        adresse: { quartier: R.un(QUARTIERS[agence.pays]), ville: agence.pays === 'FR' ? 'Île-de-France' : 'Conakry', rue: R.proba(0.5) ? `${R.ent(1, 120)} rue ${R.ent(100, 999)}` : undefined, repere: R.proba(0.4) ? R.un(['derrière la mosquée', 'portail bleu', 'à côté de la pharmacie', 'immeuble jaune, 2e étage', 'face au marché']) : undefined, position: p },
        distanceKm: c.distanceKm, prix: c.prix, devise: c.devise, prixGnf: c.prixGnf,
        livreur: quand <= maintenant ? livreur._id : undefined, livreurNom: quand <= maintenant ? `${livreur.prenom} ${livreur.nom}` : undefined,
        assigneeLe: quand <= maintenant ? new Date(quand) : undefined, faiteLe: faite ? new Date(faiteLe) : undefined,
      };
    };
    if (avecRamassage) colis.ramassage = course(depot, creeLe + 2 * H, deposeLe - 1 * H, equipe[depot.code].livreurs);

    // Paiement d'avance en ligne (une partie des réservations)
    const dueDepot = () => tarif.totalGnf + (colis.ramassage?.prixGnf || 0) + (colis.livraison?.prixGnf || 0);
    if (enLigne && !payeurArrivee && R.proba(0.3)) {
      const m = pd === 'FR' ? R.pondere([['carte', 7], ['orange_money', 3]]) : R.pondere([['orange_money', 6], ['carte', 2], ['mtn_momo', 2]]);
      const montant = m === 'carte' ? Math.round(tarif.totalGnf / taux * 100) / 100 : tarif.totalGnf;
      payer(montant, m === 'carte' ? 'EUR' : 'GNF', m, creeLe + R.entre(0.1, 1) * H, { enLigneP: true });
    }

    if (deposeLe > maintenant) { await enregistrer(); continue; }

    // Dépôt et pesée
    colis.poidsReel = poids;
    colis.tarif = { ...tarif, estime: false };
    // Livraison demandée : le plus souvent un livreur est déjà prévu avant l'arrivée du colis
    if (avecLivraison) colis.livraison = course(guichet, R.proba(0.75) ? deposeLe + R.entre(2, 30) * H : maintenant + J, null, equipe[guichet.code].livreurs);
    ev(STATUTS.DEPOSE, deposeLe, `Pesé ${poids} kg${colis.poidsEstime ? ` (déclaré ${colis.poidsEstime} kg)` : ''}`, depot.code, agentDepot);
    colis.genererCodeRetrait();
    if (!payeurArrivee) {
      const deja = colis.paiements.reduce((s, p) => s + enGnf(p.montant, p.devise, taux), 0);
      const reste = Math.max(0, dueDepot() - deja);
      const m = moyen(pd);
      const enEur = pd === 'FR' && m !== 'orange_money';
      if (reste > 0 && R.proba(0.94)) payer(enEur ? Math.round(reste / taux * 100) / 100 : reste, enEur ? 'EUR' : 'GNF', m, deposeLe + 5 * 60000, { lieu: depot.code, agent: agentDepot });
    }
    const facDepot = !payeurArrivee && { moment: 'depot', date: deposeLe + 6 * 60000, agent: agentDepot };

    // Chargement, départ, arrivée
    const depart = prochainDepart(sens, mode, deposeLe);
    const charge = depart - 6 * H <= maintenant;
    const lot = charge ? await lotPour(sens, mode, depart) : { arrivee: depart + R.entre(...transit[mode]) * J };
    if (charge) { ev(STATUTS.CHARGE, Math.max(deposeLe + H, depart - R.entre(8, 30) * H), lot.doc.code, depot.code, agentDepot); colis.lot = lot.doc._id; colis.lotCode = lot.doc.code; }
    ev(STATUTS.EN_TRANSIT, depart, null, depot.code);
    const arriveLe = lot.arrivee;
    const pfArrivee = plateforme(pa);
    ev(STATUTS.ARRIVE, arriveLe, pfArrivee.nom, pfArrivee.code, R.un(equipe[pfArrivee.code].agents));
    let pretLe = arriveLe + R.entre(3, 20) * H;
    if (guichet.code !== pfArrivee.code) { ev(STATUTS.ACHEMINEMENT, arriveLe + R.entre(2, 8) * H, guichet.nom, pfArrivee.code); pretLe += R.entre(6, 24) * H; }
    if (pretLe <= maintenant) {
      colis.arriveGuichetLe = new Date(pretLe);
      colis.emplacement = `${R.un(['A', 'B', 'C', 'D'])}${R.ent(1, 12)}`;
      // Douane en Guinée sur une partie des colis
      if (pa === 'GN' && R.proba(0.18)) colis.fraisDouaneGnf = R.ent(3, 25) * 10000;
    }
    ev(STATUTS.PRET, pretLe, guichet.nom, guichet.code, agentGuichet);
    // Remise : la plupart dans la semaine, quelques-uns restent longtemps (frais de garde)
    const attente = R.pondere([[R.entre(0.1, 1), 35], [R.entre(1, 3), 30], [R.entre(3, 7), 20], [R.entre(7, 14), 10], [R.entre(14, 25), 5]]);
    const remisLe = pretLe + attente * J;
    if (pretLe <= maintenant && remisLe <= maintenant) {
      const aDomicile = !!(colis.livraison && R.proba(0.85));
      if (aDomicile) {
        const liv = equipe[guichet.code].livreurs;
        colis.livraison = course(guichet, pretLe + H, remisLe, liv) || colis.livraison;
        ev(STATUTS.EN_LIVRAISON, remisLe - R.entre(1, 4) * H, colis.livraison?.livreurNom, guichet.code);
      }
      // Encaissement du reste au retrait (destinataire qui paie, douane, garde)
      const garde = Math.max(0, Math.floor(attente) - (config.magasinage?.joursGratuits ?? 10)) * (pa === 'FR' ? Math.round((config.magasinage?.fraisJourEur || 1) * taux) : (config.magasinage?.fraisJourGnf || 5000));
      const deja = colis.paiements.reduce((s, p) => s + enGnf(p.montant, p.devise, taux), 0);
      const du = tarif.totalGnf + (colis.ramassage?.prixGnf || 0) + (colis.livraison?.prixGnf || 0) + (colis.fraisDouaneGnf || 0) + garde;
      const reste = Math.max(0, du - deja);
      const agentRemise = aDomicile ? R.un(equipe[guichet.code].livreurs) : agentGuichet;
      if (reste > 0) { const m = moyen(pa); const enEur = pa === 'FR' && m !== 'orange_money'; payer(enEur ? Math.round(reste / taux * 100) / 100 : reste, enEur ? 'EUR' : 'GNF', m, remisLe - 10 * 60000, { lieu: guichet.code, agent: agentRemise }); }
      const tiers = R.proba(0.08);
      colis.remise = { le: new Date(remisLe), agent: agentRemise._id, retirePar: tiers ? 'tiers' : 'destinataire', nomRetrait: tiers ? `${R.un(PRENOMS_H)} ${R.un(NOMS)}` : dest.nom, pieceVerifiee: true, aDomicile };
      ev(STATUTS.REMIS, remisLe, `Remis à ${colis.remise.nomRetrait}${aDomicile ? ' à domicile' : ''}`, guichet.code, agentRemise);
      facRemise = { moment: 'remise', date: remisLe + 60000, agent: agentRemise };
      if (R.proba(0.025)) remisesPourReclamations.push(colis);
    }
    await enregistrer();
    // Factures préparées avec la vraie logique de facturation, enregistrées en bloc à la fin
    const deja = [];
    for (const f of [facDepot, facRemise]) {
      if (!f || f.date > maintenant) continue;
      const d = factureService.preparer(colis, facturesCfg, { moment: f.moment, agent: f.agent, date: new Date(f.date), deja });
      if (d) { deja.push(d); factures.push(d); }
    }
    facRemise = undefined;

    async function enregistrer() {
      colis.$locals.sansNotif = true;
      await colis.save();
      enCours.fait++;
    }
  }

  // ── Factures : numérotées dans l'ordre des dates (DEMO-FA-2026-00001…) ──
  enCours.etape = 'Factures';
  factures.sort((a, b) => a.date - b.date);
  const seqParAn = {};
  for (const f of factures) {
    const an = f.date.getFullYear();
    seqParAn[an] = (seqParAn[an] || 0) + 1;
    f.numero = `DEMO-FA-${an}-${String(seqParAn[an]).padStart(5, '0')}`;
    f.jeton = crypto.randomBytes(12).toString('hex');
    f.createdAt = f.updatedAt = f.date;
  }
  for (let i = 0; i < factures.length; i += 500) await Facture.insertMany(factures.slice(i, i + 500), { timestamps: false });
  for (const [an, n] of Object.entries(seqParAn)) await Compteur.updateOne({ _id: `DEMO-FA-${an}` }, { $set: { seq: n } }, { upsert: true });

  // ── Caisses : encaissements et clôtures du soir ──
  enCours.etape = 'Caisses';
  for (const m of mouvements) { m.colis = m.colisRef._id; m.numeroSuivi = m.colisRef.numeroSuivi; delete m.colisRef; }
  const parAgentJour = new Map();
  for (const m of mouvements) {
    const cle = `${m.agent}|${new Date(m.le).toISOString().slice(0, 10)}`;
    if (!parAgentJour.has(cle)) parAgentJour.set(cle, []);
    parAgentJour.get(cle).push(m);
  }
  const aujourdhui = new Date(maintenant).toISOString().slice(0, 10);
  const clotures = [];
  for (const [cle, liste] of parAgentJour) {
    const [agent, jour] = cle.split('|');
    if (jour === aujourdhui || R.proba(0.03)) continue; // aujourd'hui : caisse encore ouverte ; parfois oubliée
    const totaux = {};
    for (const m of liste) { totaux[m.devise] = totaux[m.devise] || {}; totaux[m.devise][m.methode] = Math.round(((totaux[m.devise][m.methode] || 0) + m.montant) * 100) / 100; }
    const ecart = { EUR: 0, GNF: 0 };
    if (R.proba(0.06)) { if (totaux.EUR?.especes) ecart.EUR = -R.ent(1, 10); if (totaux.GNF?.especes) ecart.GNF = -R.ent(1, 5) * 5000; }
    const esp = { EUR: (totaux.EUR?.especes || 0) + ecart.EUR, GNF: (totaux.GNF?.especes || 0) + ecart.GNF };
    clotures.push({ demo: true, agent, lieu: liste[0].lieu, totaux, especesComptees: esp, ecart, nbMouvements: liste.length, createdAt: new Date(`${jour}T19:30:00`), updatedAt: new Date(`${jour}T19:30:00`), _liste: liste });
  }
  const clotDocs = await Cloture.insertMany(clotures.map(({ _liste, ...c }) => c), { timestamps: false });
  clotDocs.forEach((d, i) => clotures[i]._liste.forEach(m => { m.cloture = d._id; }));
  await Mouvement.insertMany(mouvements.map(m => ({ ...m, createdAt: m.le, updatedAt: m.le })), { timestamps: false });

  // ── Réclamations ──
  enCours.etape = 'Réclamations';
  for (const c of remisesPourReclamations) {
    const motif = R.pondere([['abime', 4], ['incomplet', 3], ['retard', 2], ['autre', 1]]);
    const statut = R.pondere([['ouverte', 3], ['en_cours', 3], ['acceptee', 2], ['refusee', 1], ['close', 2]]);
    const le = new Date(new Date(c.remise.le).getTime() + R.entre(2, 48) * H);
    if (le.getTime() > maintenant) continue;
    try {
      await Reclamation.create({
        demo: true, colis: c._id, numeroSuivi: c.numeroSuivi, motif, statut,
        description: { abime: 'Le carton est arrivé abîmé, une partie du contenu est cassée.', incomplet: 'Il manque un sac par rapport à ce que j\'ai envoyé.', retard: 'Le colis est arrivé avec beaucoup de retard.', autre: 'Problème avec le retrait du colis.' }[motif],
        montantDemande: R.ent(2, 15) * 10, deviseDemande: 'EUR',
        demandeur: { nom: c.expediteur.nom, telephone: c.expediteur.telephone, role: 'expediteur' },
        suivi: [{ auteur: 'client', nom: c.expediteur.nom.split(' ')[0], texte: 'Bonjour, merci de regarder ma réclamation.', le }],
        createdAt: le,
      });
    } catch (e) { /* motif inconnu dans cette version : ignoré */ }
  }

  // ── Quelques paiements mobile money à vérifier (récents) ──
  const recents = await Colis.find({ demo: true, statut: { $in: [STATUTS.DEPOSE, STATUTS.CHARGE, STATUTS.EN_TRANSIT] }, sens: 'GN-FR' }).limit(6);
  for (const c of recents) {
    c.declarations = [{ methode: R.proba(0.7) ? 'orange_money' : 'mtn_momo', objet: 'global', montantGnf: R.ent(5, 40) * 10000, reference: `PP${R.ent(100000, 999999)}.${R.ent(1000, 9999)}`, telephone: c.expediteur.telephone, le: new Date(maintenant - R.entre(1, 20) * H) }];
    await c.save();
  }

  const resultat = await compter();
  enCours.etape = 'Terminé';
  return resultat;
}

module.exports = { lancer, etat, effacer, compter };
