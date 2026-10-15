// ─────────────────────────────────────────────────────────────
//  Back-office : tableau de bord, recherche, statuts en masse, relances
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body } = require('express-validator');
const Colis = require('../models/Colis');
const Lot = require('../models/Lot');
const Config = require('../models/Config');
const { Mouvement } = require('../models/Mouvement');
const { auth, role } = require('../middleware/auth');
const { ah, valider } = require('../utils/http');
const { calculerSolde } = require('../utils/tarif');
const { notifier, MESSAGES } = require('../utils/sms');
const { ROLES, STATUTS, STATUTS_LOT } = require('../config/constants');
const svc = require('../services/colisService');

router.use(auth, role(ROLES.ADMIN));

const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── GET /api/admin/tableau?jours=30 ── tout ce qu'il faut pour piloter l'entreprise
// Calculé en JavaScript sur les colis de la période (portable, assez rapide pour quelques
// dizaines de milliers de colis).
router.get('/tableau', ah(async (req, res) => {
  const config = await Config.get();
  const jours = Math.min(Math.max(parseInt(req.query.jours, 10) || 30, 1), 366);
  const maintenant = new Date();
  const debut = new Date(maintenant.getTime() - jours * 86400000);
  const debutPrec = new Date(debut.getTime() - jours * 86400000);
  const tauxDuJour = config.tauxEurGnf || 10000;
  const enEur = (m, d, taux) => (d === 'EUR' ? m : m / (taux || tauxDuJour));
  const r2 = (n) => Math.round(n * 100) / 100;
  const premier = (c, statut) => (c.historique || []).find(h => h.statut === statut && !h.annule)?.le;
  const dans = (d, a, b) => d && new Date(d) >= a && new Date(d) < b;
  const cleJour = (d) => new Date(d).toISOString().slice(0, 10);

  const debutLecture = new Date(Math.min(debutPrec, new Date(maintenant.getFullYear(), maintenant.getMonth() - 11, 1)));
  const colis = await Colis.find({ $or: [{ updatedAt: { $gte: debutLecture } }, { statut: { $nin: [STATUTS.REMIS, STATUTS.ANNULE] } }] })
    .select('numeroSuivi statut sens mode depot guichet expediteur destinataire poidsReel poidsEstime tarif paiements historique createdAt ramassage livraison arriveGuichetLe fraisDouaneGnf avoirsGnf declarations remise.le')
    .lean();

  // Jours de la période (graphiques)
  const serieJours = [];
  for (let k = jours - 1; k >= 0; k--) serieJours.push(cleJour(new Date(maintenant.getTime() - k * 86400000)));
  const parJour = Object.fromEntries(serieJours.map(j => [j, { express: 0, air: 0, mer: 0, encaisseEur: 0 }]));

  const kpi = { deposes: 0, deposesPrec: 0, kg: 0, kgPrec: 0, caEur: 0, caEurPrec: 0, encaisseEur: 0, encaisseEurPrec: 0, remis: 0, remisPrec: 0, reservations: 0, reservationsPrec: 0 };
  const encaisse = { EUR: 0, GNF: 0 };
  const parMethode = {};
  const agences = Object.fromEntries((config.agences || []).map(a => [a.code, { code: a.code, nom: a.nom, pays: a.pays, deposes: 0, kg: 0, caEur: 0, encaisse: { EUR: 0, GNF: 0 }, aRetirer: 0, impayes: 0, impayesGnf: 0, gardeLongue: 0 }]));
  const lignes = {}; // sens|mode
  const clients = {};
  const delais = { express: [], air: [], mer: [] };
  const bloques = [];
  let impayesGuichet = 0, impayesGuichetGnf = 0, domicileCaEur = 0, coursesFaites = 0, creancesEur = 0, creancesNb = 0;
  // 12 derniers mois : encaissé (paiements) et facturé (factures)
  const mois = [];
  const cleMois = (d) => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  for (let k = 11; k >= 0; k--) mois.push(cleMois(new Date(maintenant.getFullYear(), maintenant.getMonth() - k, 1)));
  const parMois = Object.fromEntries(mois.map(m => [m, { factureEur: 0, encaisseEur: 0 }]));
  const debut12 = new Date(maintenant.getFullYear(), maintenant.getMonth() - 11, 1);
  const seuilGarde = config.magasinage?.joursGratuits ?? 10;

  for (const c of colis) {
    const taux = c.tarif?.taux || tauxDuJour;
    const dDepot = premier(c, STATUTS.DEPOSE);
    const prix = c.tarif && !c.tarif.estime ? (c.tarif.totalEur || 0) : 0;
    if (dans(c.createdAt, debut, maintenant)) kpi.reservations++;
    else if (dans(c.createdAt, debutPrec, debut)) kpi.reservationsPrec++;
    if (dans(dDepot, debut, maintenant)) {
      kpi.deposes++; kpi.kg += c.poidsReel || 0; kpi.caEur += prix;
      const j = cleJour(dDepot); if (parJour[j]) parJour[j][c.mode] = (parJour[j][c.mode] || 0) + 1;
      const ag = agences[c.depot]; if (ag) { ag.deposes++; ag.kg += c.poidsReel || 0; ag.caEur += prix; }
      const k = `${c.sens || 'FR-GN'}|${c.mode}`;
      lignes[k] = lignes[k] || { sens: c.sens || 'FR-GN', mode: c.mode, nb: 0, kg: 0, caEur: 0 };
      lignes[k].nb++; lignes[k].kg += c.poidsReel || 0; lignes[k].caEur += prix;
      const tel = c.expediteur?.telephone || '?';
      clients[tel] = clients[tel] || { nom: c.expediteur?.nom, telephone: tel, nb: 0, kg: 0, caEur: 0 };
      clients[tel].nb++; clients[tel].kg += c.poidsReel || 0; clients[tel].caEur += prix;
    } else if (dans(dDepot, debutPrec, debut)) { kpi.deposesPrec++; kpi.kgPrec += c.poidsReel || 0; kpi.caEurPrec += prix; }
    const dRemis = premier(c, STATUTS.REMIS);
    if (dans(dRemis, debut, maintenant)) kpi.remis++; else if (dans(dRemis, debutPrec, debut)) kpi.remisPrec++;
    // Délai dépôt → disponible à l'agence de retrait
    const dPret = premier(c, STATUTS.PRET);
    if (dDepot && dPret && dans(dPret, debut, maintenant) && delais[c.mode]) delais[c.mode].push((new Date(dPret) - new Date(dDepot)) / 86400000);
    // Encaissements
    for (const p of c.paiements || []) {
      const e = enEur(p.montant, p.devise, taux);
      if (dans(p.le, debut, maintenant)) {
        kpi.encaisseEur += e; encaisse[p.devise] = (encaisse[p.devise] || 0) + p.montant;
        const m = p.lieu === 'EN_LIGNE' ? `${p.methode}_en_ligne` : p.methode;
        parMethode[m] = (parMethode[m] || 0) + e;
        const j = cleJour(p.le); if (parJour[j]) parJour[j].encaisseEur += e;
        const ag = agences[p.lieu]; if (ag) ag.encaisse[p.devise] = (ag.encaisse[p.devise] || 0) + p.montant;
        if (p.objet === 'domicile') domicileCaEur += e;
      } else if (dans(p.le, debutPrec, debut)) kpi.encaisseEurPrec += e;
      const m = p.le && cleMois(p.le);
      if (parMois[m]) parMois[m].encaisseEur += e;
    }
    for (const t of ['ramassage', 'livraison']) if (dans(c[t]?.faiteLe, debut, maintenant)) coursesFaites++;
    // Ce que les clients doivent encore (colis pesés, pas terminés)
    if (![STATUTS.REMIS, STATUTS.ANNULE].includes(c.statut) && !c.tarif?.estime) {
      const sd = calculerSolde(c, config);
      if (sd.soldeGnf > 0) { creancesNb++; creancesEur += sd.soldeGnf / taux; }
    }
    // État actuel
    if ([STATUTS.PRET, STATUTS.EN_LIVRAISON].includes(c.statut)) {
      const ag = agences[c.guichet];
      const solde = calculerSolde(c, config);
      if (ag) { ag.aRetirer++; if (solde.magasinage.jours > seuilGarde) ag.gardeLongue++; }
      if (solde.soldeGnf > 0) { impayesGuichet++; impayesGuichetGnf += solde.soldeGnf; if (ag) { ag.impayes++; ag.impayesGnf += solde.soldeGnf; } }
    }
    // Colis qui n'avancent plus
    const dernier = [...(c.historique || [])].reverse().find(h => h.statut && !h.annule)?.le || c.createdAt;
    const immobile = (maintenant - new Date(dernier)) / 86400000;
    const limite = { reserve: 14, depose: 5, charge: 7, en_transit: c.mode === 'mer' ? 50 : c.mode === 'express' ? 4 : 10, arrive: 5, acheminement: 4, en_livraison: 2 }[c.statut];
    if (limite && immobile > limite) bloques.push({ numeroSuivi: c.numeroSuivi, statut: c.statut, mode: c.mode, jours: Math.floor(immobile), expediteur: c.expediteur?.nom, lieu: c.statut === 'reserve' || c.statut === 'depose' || c.statut === 'charge' ? c.depot : c.guichet });
  }

  // Chiffre d'affaires facturé : factures moins avoirs, par devise, par nature et par agence
  const Facture = require('../models/Facture');
  const factures = await Facture.find({ date: { $gte: new Date(Math.min(debutPrec, debut12)) } }).select('type date devise taux totalTTC totalHT totalTVA lignes agence').lean();
  const NATURE = (cle) => (String(cle).startsWith('article:') ? 'articles' : ({ transport: 'transport', supplement: 'transport', arrondi: 'transport', assurance: 'assurance', ramassage: 'domicile', livraison: 'domicile', garde: 'garde', douane: 'douane', remboursement: 'avoirs' })[cle] || 'autres');
  const ca = { ttc: { EUR: 0, GNF: 0 }, eur: 0, eurPrec: 0, htEur: 0, tvaEur: 0, avoirsEur: 0, nbFactures: 0, parNature: {}, parAgence: {} };
  for (const f of factures) {
    const signe = f.type === 'avoir' ? -1 : 1;
    const e = enEur(f.totalTTC || 0, f.devise, f.taux) * signe;
    const m = cleMois(f.date);
    if (parMois[m]) parMois[m].factureEur += e;
    if (dans(f.date, debut, maintenant)) {
      ca.ttc[f.devise] = (ca.ttc[f.devise] || 0) + (f.totalTTC || 0) * signe;
      ca.eur += e; ca.htEur += enEur(f.totalHT || 0, f.devise, f.taux) * signe; ca.tvaEur += enEur(f.totalTVA || 0, f.devise, f.taux) * signe;
      if (f.type === 'avoir') ca.avoirsEur += -e; else ca.nbFactures++;
      for (const l of f.lignes || []) {
        const n = NATURE(l.cle);
        ca.parNature[n] = (ca.parNature[n] || 0) + enEur(l.montantTTC || 0, f.devise, f.taux) * (f.type === 'avoir' ? -1 : 1);
      }
      const code = f.agence?.code || 'EN_LIGNE';
      ca.parAgence[code] = (ca.parAgence[code] || 0) + e;
    } else if (dans(f.date, debutPrec, debut)) ca.eurPrec += e;
  }

  const parStatut = await Colis.aggregate([{ $group: { _id: '$statut', nb: { $sum: 1 } } }]);
  const moy = (l) => (l.length ? Math.round((l.reduce((a, b) => a + b, 0) / l.length) * 10) / 10 : null);
  const Reclamation = require('../models/Reclamation');
  const [reclamationsOuvertes, lots, caissesEnRetard] = await Promise.all([
    Reclamation.countDocuments({ statut: { $in: ['ouverte', 'en_cours'] } }),
    Lot.find({ statut: { $in: [STATUTS_LOT.PREPARATION, STATUTS_LOT.PARTI, STATUTS_LOT.ARRIVE] } }).sort({ createdAt: -1 }).limit(12).lean(),
    Mouvement.distinct('agent', { cloture: null, le: { $lt: new Date(new Date().setHours(0, 0, 0, 0)) } }),
  ]);
  const nbLot = await Promise.all(lots.map(l => Promise.all([Colis.countDocuments({ lot: l._id }), Colis.countDocuments({ lot: l._id, statut: { $nin: [STATUTS.CHARGE, STATUTS.EN_TRANSIT] } })])));
  const coursesOuvertes = colis.reduce((n, c) => n + ['ramassage', 'livraison'].filter(t => c[t]?.demande && ['a_planifier', 'assignee', 'en_route'].includes(c[t].statut)).length, 0);
  const coursesSansLivreur = colis.reduce((n, c) => n + ['ramassage', 'livraison'].filter(t => c[t]?.demande && c[t].statut === 'a_planifier').length, 0);
  const aVerifier = colis.reduce((n, c) => n + (c.declarations || []).filter(d => d.statut === 'a_verifier').length, 0);

  res.json({
    succes: true, jours, taux: tauxDuJour, tauxMisAJourLe: config.tauxMisAJourLe,
    kpi: Object.fromEntries(Object.entries(kpi).map(([k, v]) => [k, r2(v)])),
    ca: {
      ttc: { EUR: r2(ca.ttc.EUR || 0), GNF: Math.round(ca.ttc.GNF || 0) }, eur: r2(ca.eur), eurPrec: r2(ca.eurPrec), htEur: r2(ca.htEur), tvaEur: r2(ca.tvaEur),
      avoirsEur: r2(ca.avoirsEur), nbFactures: ca.nbFactures,
      parNature: Object.entries(ca.parNature).filter(([n]) => n !== 'avoirs').map(([n, v]) => ({ nature: n, eur: r2(v) })).sort((a, b) => b.eur - a.eur),
      parAgence: Object.entries(ca.parAgence).map(([code, v]) => ({ code, eur: r2(v) })).sort((a, b) => b.eur - a.eur),
      creancesEur: r2(creancesEur), creancesNb,
      parMois: mois.map(m => ({ mois: m, factureEur: r2(parMois[m].factureEur), encaisseEur: r2(parMois[m].encaisseEur) })),
    },
    encaisse: { EUR: r2(encaisse.EUR || 0), GNF: Math.round(encaisse.GNF || 0) },
    parMethode: Object.entries(parMethode).map(([k, v]) => ({ methode: k, eur: r2(v) })).sort((a, b) => b.eur - a.eur),
    parJour: serieJours.map(j => ({ jour: j, ...parJour[j], encaisseEur: r2(parJour[j].encaisseEur) })),
    pipeline: Object.fromEntries(parStatut.map(x => [x._id, x.nb])),
    agences: Object.values(agences).map(a => ({ ...a, kg: r2(a.kg), caEur: r2(a.caEur) })),
    lignes: Object.values(lignes).map(l => ({ ...l, kg: r2(l.kg), caEur: r2(l.caEur) })).sort((a, b) => b.caEur - a.caEur),
    clients: Object.values(clients).sort((a, b) => b.caEur - a.caEur || b.nb - a.nb).slice(0, 8).map(x => ({ ...x, kg: r2(x.kg), caEur: r2(x.caEur) })),
    delais: Object.fromEntries(Object.entries(delais).map(([m, l]) => [m, { moyenne: moy(l), nb: l.length }])),
    bloques: bloques.sort((a, b) => b.jours - a.jours).slice(0, 15),
    nbBloques: bloques.length,
    guichets: { impayes: impayesGuichet, impayesGnf: impayesGuichetGnf },
    domicile: { ouvertes: coursesOuvertes, sansLivreur: coursesSansLivreur, faites: coursesFaites, encaisseEur: r2(domicileCaEur) },
    aFaire: { reclamations: reclamationsOuvertes, paiementsAVerifier: aVerifier, caissesEnRetard: caissesEnRetard.length },
    lots: lots.map((l, i) => ({ code: l.code, sens: l.sens, mode: l.mode, statut: l.statut, reference: l.reference, dateArriveePrevue: l.dateArriveePrevue, nb: nbLot[i][0], recus: nbLot[i][1] })),
  });
}));

// ── Exports pour Excel ─────────────────────────────────────
// Date mise dans un nom de fichier : chiffres et tirets seulement
const dateFichier = (v, defaut) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : defaut);
const periodeExport = (q) => {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(new Date(`${v}T00:00:00`));
  const fin = ok(q.fin) ? new Date(`${q.fin}T23:59:59`) : new Date();
  const debut = ok(q.debut) ? new Date(`${q.debut}T00:00:00`) : new Date(fin.getTime() - 30 * 86400000);
  return { debut, fin };
};
// GET /api/admin/export/colis.csv?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ ── tous les colis créés sur la période
router.get('/export/colis.csv', ah(async (req, res) => {
  const { envoyerCsv, dateFr } = require('../utils/csv');
  const { debut, fin } = periodeExport(req.query);
  const config = await Config.get();
  const liste = await Colis.find({ createdAt: { $gte: debut, $lte: fin } }).sort({ createdAt: 1 }).limit(20000).lean();
  const nom = (code) => (config.agences || []).find(a => a.code === code)?.nom || code || '';
  const lignes = liste.map(c => {
    const sd = calculerSolde(c, config);
    return [c.numeroSuivi, dateFr(c.createdAt), require('../config/constants').STATUTS_LABELS[c.statut] || c.statut, c.sens || 'FR-GN', require('../config/constants').libMode(c.mode),
      c.expediteur?.nom, c.expediteur?.telephone, c.destinataire?.nom, c.destinataire?.telephone, nom(c.depot), nom(c.guichet),
      c.poidsEstime ?? '', c.poidsReel ?? '', (c.articles || []).map(a => `${a.quantite} ${a.label}`).join(', '), c.typeColis,
      c.tarif?.estime ? 'estimé' : 'définitif', c.tarif?.totalEur ?? '', c.tarif?.totalGnf ?? '', sd.payeGnf, sd.soldeGnf,
      c.ramassage?.demande && c.ramassage.statut !== 'annulee' ? 'oui' : 'non', c.livraison?.demande && c.livraison.statut !== 'annulee' ? 'oui' : 'non', c.lotCode || '', c.payeurArrivee ? 'oui' : 'non'];
  });
  envoyerCsv(res, `colis-TMS-${dateFichier(req.query.debut, 'debut')}-au-${dateFichier(req.query.fin, 'aujourdhui')}.csv`,
    ['Numéro', 'Créé le', 'Statut', 'Sens', 'Mode', 'Expéditeur', 'Tél. expéditeur', 'Destinataire', 'Tél. destinataire', 'Agence de départ', 'Agence de retrait',
      'Poids annoncé (kg)', 'Poids pesé (kg)', 'Articles à la pièce', 'Type', 'Prix', 'Prix (€)', 'Prix (GNF)', 'Payé (GNF)', 'Reste à payer (GNF)',
      'Ramassage', 'Livraison à domicile', 'Lot', 'Payé à l\'arrivée'], lignes);
}));
// GET /api/admin/export/encaissements.csv?debut&fin ── chaque paiement (comptoir, livreur, en ligne)
router.get('/export/encaissements.csv', ah(async (req, res) => {
  const { envoyerCsv, dateFr, heureFr } = require('../utils/csv');
  const { debut, fin } = periodeExport(req.query);
  const config = await Config.get();
  const User = require('../models/User');
  const liste = await Colis.find({ 'paiements.le': { $gte: debut, $lte: fin } }).select('numeroSuivi paiements expediteur tarif').lean();
  const agents = Object.fromEntries((await User.find({ role: { $in: ['agent', 'livreur', 'admin'] } }).select('prenom nom').lean()).map(u => [String(u._id), `${u.prenom} ${u.nom}`]));
  const nom = (code) => (code === 'EN_LIGNE' ? 'En ligne' : (config.agences || []).find(a => a.code === code)?.nom || code || '');
  const LIB = Object.fromEntries(require('../config/constants').METHODES_PAIEMENT.map(m => [m.key, m.label]));
  const lignes = [];
  for (const c of liste) {
    for (const p of c.paiements || []) {
      if (!(new Date(p.le) >= debut && new Date(p.le) <= fin)) continue;
      const taux = c.tarif?.taux || config.tauxEurGnf;
      lignes.push([dateFr(p.le), heureFr(p.le), c.numeroSuivi, c.expediteur?.nom, nom(p.lieu), agents[String(p.agent)] || (p.lieu === 'EN_LIGNE' ? 'Client' : ''),
        LIB[p.methode] || p.methode, p.objet === 'domicile' ? 'Ramassage / livraison' : 'Colis', p.devise, p.montant, p.devise === 'EUR' ? p.montant : p.montant / taux, p.reference || '']);
    }
  }
  lignes.sort((a, b) => a[0].split('/').reverse().join('').localeCompare(b[0].split('/').reverse().join('')) || a[1].localeCompare(b[1]));
  envoyerCsv(res, `encaissements-TMS-${dateFichier(req.query.debut, 'debut')}-au-${dateFichier(req.query.fin, 'aujourdhui')}.csv`,
    ['Date', 'Heure', 'Colis', 'Client', 'Lieu', 'Encaissé par', 'Moyen', 'Pour', 'Devise', 'Montant', 'Équivalent €', 'Référence'], lignes);
}));

// ── GET /api/admin/stats
router.get('/stats', ah(async (req, res) => {
  const config = await Config.get();
  const debut = new Date(); debut.setHours(0, 0, 0, 0);

  const parStatut = await Colis.aggregate([{ $group: { _id: '$statut', nb: { $sum: 1 } } }]);
  const nb = Object.fromEntries(parStatut.map(s => [s._id, s.nb]));

  const aux = await Colis.find({ statut: STATUTS.PRET }).lean();
  const seuil = config.magasinage?.joursGratuits ?? 10;
  const anciens = [];
  let impayes = 0;
  for (const c of aux) {
    const s = calculerSolde(c, config);
    if (s.magasinage.jours > seuil) anciens.push({ numeroSuivi: c.numeroSuivi, destinataire: c.destinataire, guichet: c.guichet, jours: s.magasinage.jours });
    if (s.soldeGnf > 0) impayes++;
  }

  // Écarts de pesée > 1 kg sur les 30 derniers jours
  const il30j = new Date(Date.now() - 30 * 86400000);
  const deposes = await Colis.find({ poidsEstime: { $gt: 0 }, poidsReel: { $gt: 0 }, updatedAt: { $gte: il30j } })
    .select('numeroSuivi poidsEstime poidsReel expediteur statut').lean();
  const ecartsPesee = deposes
    .map(c => ({ ...c, ecart: Math.round((c.poidsReel - c.poidsEstime) * 10) / 10 }))
    .filter(c => Math.abs(c.ecart) >= 1)
    .slice(0, 20);

  const mvtsJour = await Mouvement.find({ le: { $gte: debut } }).lean();
  const encaisseJour = { EUR: 0, GNF: 0 };
  mvtsJour.forEach(m => { encaisseJour[m.devise] = Math.round((encaisseJour[m.devise] + m.montant) * 100) / 100; });
  const caissesEnRetard = (await Mouvement.distinct('agent', { cloture: null, le: { $lt: debut } })).length;

  const lots = await Lot.find({ statut: { $in: [STATUTS_LOT.PREPARATION, STATUTS_LOT.PARTI] } }).lean();

  const jours = config.tauxMisAJourLe ? Math.floor((Date.now() - new Date(config.tauxMisAJourLe)) / 86400000) : null;

  res.json({
    succes: true,
    compteurs: {
      reserves: nb.reserve || 0,
      auDepot: (nb.depose || 0) + (nb.charge || 0),
      enRoute: (nb.en_transit || 0) + (nb.arrive || 0) + (nb.acheminement || 0),
      auxGuichets: (nb.pret || 0) + (nb.en_livraison || 0),
      anciensGuichet: anciens.length,
      impayes,
      remis: nb.remis || 0,
    },
    lotsEnCours: { preparation: lots.filter(l => l.statut === 'preparation').length, partis: lots.filter(l => l.statut === 'parti').length },
    encaisseJour,
    alertes: {
      anciens: anciens.sort((a, b) => b.jours - a.jours).slice(0, 30),
      ecartsPesee,
      caissesEnRetard,
      tauxAgeJours: jours,
    },
  });
}));

// ── GET /api/admin/colis?q=&statut=&guichet=&lot=&page=
router.get('/colis', ah(async (req, res) => {
  const { q, statut, guichet, lot } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filtre = {};
  if (statut) filtre.statut = statut;
  if (guichet) filtre.guichet = guichet;
  if (lot) filtre.lotCode = String(lot).toUpperCase();
  if (q && String(q).trim()) {
    const t = String(q).trim();
    const re = new RegExp(echapperRegex(t), 'i');
    filtre.$or = [
      { numeroSuivi: t.toUpperCase() },
      { 'expediteur.telephone': svc.normTel(t) },
      { 'destinataire.telephone': svc.normTel(t) },
      { 'expediteur.nom': re },
      { 'destinataire.nom': re },
    ];
  }
  const config = await Config.get();
  const [liste, total] = await Promise.all([
    Colis.find(filtre).sort({ updatedAt: -1 }).skip((page - 1) * 50).limit(50),
    Colis.countDocuments(filtre),
  ]);
  res.json({
    succes: true, total, page,
    colis: liste.map(c => ({ ...c.toJSON(), solde: calculerSolde(c, config) })),
  });
}));

// ── GET /api/admin/colis/:numero ── fiche avec code de retrait (support téléphonique)
router.get('/colis/:numero', ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() }).select('+codeRetrait +codeEssais')
    .populate('historique.agent', 'prenom nom');
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const vue = await svc.vueComplete(colis, { avecCode: true });
  vue.codeEssais = colis.codeEssais;
  res.json({ succes: true, colis: vue });
}));

// ── POST /api/admin/colis/statut ── { numeros: [], statut }
router.post('/colis/statut', [
  body('numeros').isArray({ min: 1, max: 500 }).withMessage('Sélection vide'),
  body('statut').isIn([STATUTS.EN_TRANSIT, STATUTS.ARRIVE, STATUTS.PRET, STATUTS.ANNULE]).withMessage('Statut non autorisé ici'),
], valider, ah(async (req, res) => {
  const resultats = await svc.changerStatutMasse(req.body.numeros.map(n => String(n).toUpperCase()), req.body.statut, req.user);
  res.json({ succes: true, resultats, nbOk: resultats.filter(r => r.ok).length });
}));

// ── POST /api/admin/colis/:numero/debloquer ── remet le compteur de codes faux à zéro, renvoie le code
router.post('/colis/:numero/debloquer', ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() }).select('+codeRetrait +codeEssais');
  if (!colis || colis.statut !== STATUTS.PRET) return res.status(404).json({ succes: false, message: 'Colis non disponible au guichet.' });
  colis.codeEssais = 0;
  await colis.save();
  res.json({ succes: true, message: 'Colis débloqué.' });
}));

// ── PATCH /api/admin/colis/:numero ── corrections (destinataire, guichet, notes, douane)
router.patch('/colis/:numero', ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const b = req.body;
  if (b.destinataire?.nom) colis.destinataire.nom = b.destinataire.nom;
  if (b.destinataire?.telephone) colis.destinataire.telephone = svc.normTel(b.destinataire.telephone);
  if (b.guichet) {
    const config = await Config.get();
    const nouvelle = config.agences.find(g => g.code === b.guichet);
    if (!nouvelle) return res.status(400).json({ succes: false, message: 'Agence inconnue.' });
    if (nouvelle.pays !== svc.paysArriveeDe(colis.sens)) return res.status(400).json({ succes: false, message: 'L\'agence de retrait doit rester dans le pays de destination.' });
    colis.guichet = b.guichet;
    if (colis.livraison?.demande && colis.livraison.statut !== 'annulee' && colis.livraison.agence !== b.guichet) {
      if (colis.statut === STATUTS.EN_LIVRAISON) return res.status(409).json({ succes: false, message: 'Le colis est en cours de livraison.' });
      colis.livraison.livreur = undefined; colis.livraison.livreurNom = undefined; colis.livraison.statut = 'a_planifier';
      await require('../services/domicileService').demanderCourse(colis, 'livraison', { demande: true, adresse: colis.livraison.adresse, jour: colis.livraison.jour, moment: colis.livraison.moment });
    }
  }
  if (b.notesAdmin !== undefined) colis.notesAdmin = b.notesAdmin;
  if (b.fraisDouaneGnf !== undefined) colis.fraisDouaneGnf = Math.max(0, Math.round(parseFloat(b.fraisDouaneGnf) || 0));
  colis.historique.push({ label: 'Modifié par l\'administration', agent: req.user._id, le: new Date() });
  await colis.save();
  res.json({ succes: true, colis: await svc.vueComplete(colis) });
}));

// ── Courses à domicile ──────────────────────────────────────
const dom = require('../services/domicileService');
const User = require('../models/User');

// GET /api/admin/courses?agence= ── courses ouvertes + livreurs pour l'assignation
router.get('/courses', ah(async (req, res) => {
  const [courses, livreurs] = await Promise.all([
    dom.coursesOuvertes({ agence: req.query.agence || undefined }),
    User.find({ role: ROLES.LIVREUR, actif: true }).select('prenom nom telephone lieu').lean(),
  ]);
  // Courses terminées récemment, avec l'écart GPS (contrôle)
  const il7j = new Date(Date.now() - 7 * 86400000);
  const config = await Config.get();
  const faites = [];
  for (const type of dom.COURSES) {
    const liste = await Colis.find({ [`${type}.statut`]: 'faite', [`${type}.faiteLe`]: { $gte: il7j } }).sort({ [`${type}.faiteLe`]: -1 }).limit(100);
    for (const c of liste) faites.push(await dom.vueCourse(c, type, config));
  }
  faites.sort((a, b) => new Date(b.faiteLe) - new Date(a.faiteLe));
  res.json({ succes: true, courses, livreurs, faites });
}));

// POST /api/admin/courses/assigner ── { numero, type, livreur: id | null }
router.post('/courses/assigner', [
  body('numero').trim().notEmpty(),
  body('type').isIn(dom.COURSES),
], valider, ah(async (req, res) => {
  let livreur = null;
  if (req.body.livreur) {
    livreur = await User.findOne({ _id: req.body.livreur, role: ROLES.LIVREUR, actif: true });
    if (!livreur) return res.status(404).json({ succes: false, message: 'Livreur introuvable.' });
  }
  // Une course à domicile se paie d'avance : on prévient avant d'envoyer un livreur
  if (livreur && !req.body.force) {
    const c0 = await Colis.findOne({ numeroSuivi: String(req.body.numero).trim().toUpperCase() });
    const v = c0?.[req.body.type] ? await dom.vueCourse(c0, req.body.type, await Config.get()) : null;
    if (v && !v.payee) return res.status(409).json({ succes: false, code: 'non_payee', message: 'Cette course n\'est pas encore payée par le client.' });
  }
  const colis = await dom.assigner(req.body.numero, req.body.type, livreur, { par: req.user });
  if (livreur) { const push = require('../utils/push'); push.sansAttendre(push.aLUtilisateur(livreur._id, { titre: 'Course pour vous', corps: `${req.body.type === 'ramassage' ? 'Ramassage' : 'Livraison'} ${colis.numeroSuivi}${colis[req.body.type]?.adresse?.quartier ? ` à ${colis[req.body.type].adresse.quartier}` : ''}.`, chemin: '/#/courses' })); }
  res.json({ succes: true, course: await dom.vueCourse(colis, req.body.type, await Config.get()) });
}));

// POST /api/admin/courses/adresse ── { numero, type, demande, adresse: {…, lien}, jour, moment }
router.post('/courses/adresse', [
  body('numero').trim().notEmpty(),
  body('type').isIn(dom.COURSES),
], valider, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.body.numero.trim().toUpperCase() });
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  if ([STATUTS.REMIS, STATUTS.ANNULE].includes(colis.statut)) return res.status(409).json({ succes: false, message: 'Colis terminé.' });
  if (req.body.type === 'ramassage' && colis.statut !== STATUTS.RESERVE) return res.status(409).json({ succes: false, message: 'Colis déjà déposé.' });
  await dom.demanderCourse(colis, req.body.type, req.body.demande === false ? { demande: false } : { ...req.body, demande: true });
  colis.markModified(req.body.type);
  colis.historique.push({ label: 'Course modifiée par l\'administration', agent: req.user._id, le: new Date() });
  await colis.save();
  res.json({ succes: true, colis: await svc.vueComplete(colis) });
}));

// ── POST /api/admin/relances ── relance des colis au guichet depuis longtemps
router.post('/relances', ah(async (req, res) => {
  const config = await Config.get();
  const seuil = config.magasinage?.joursGratuits ?? 10;
  const liste = await Colis.find({ statut: STATUTS.PRET });
  let envoyes = 0;
  for (const c of liste) {
    const s = calculerSolde(c, config);
    if (s.magasinage.jours > seuil) {
      const guichet = (await Config.lieu(c.guichet))?.nom || c.guichet;
      notifier(c.destinataire.telephone, MESSAGES.relance(c, guichet, s.magasinage.jours));
      envoyes++;
    }
  }
  res.json({ succes: true, envoyes });
}));

// ── Données de démonstration (simulation de 30 jours, effaçable) ──
const simulation = require('../services/simulationService');
router.get('/demo', ah(async (req, res) => res.json({ succes: true, ...simulation.etat(), compte: await simulation.compter() })));
router.post('/demo/generer', ah(async (req, res) => {
  const jours = Math.min(Math.max(parseInt(req.body?.jours, 10) || 30, 7), 60);
  res.status(202).json({ succes: true, ...simulation.lancer({ jours }) });
}));
router.delete('/demo', ah(async (req, res) => res.json({ succes: true, efface: await simulation.effacer() })));

module.exports = router;
