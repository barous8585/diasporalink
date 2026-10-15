// ─────────────────────────────────────────────────────────────
//  Paiement en ligne par carte (Stripe) du solde d'un colis.
//  Orange Money / MTN MoMo : à brancher en v2 (agrégateur local).
// ─────────────────────────────────────────────────────────────
const Colis  = require('../models/Colis');
const Config = require('../models/Config');
const { calculerSolde } = require('../utils/tarif');
const { APP_NOM, STATUTS } = require('../config/constants');

let stripe = null;
const getStripe = () => {
  if (!stripe && process.env.STRIPE_SECRET_KEY) stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripe;
};

const { domicileAPayerGnf, enGnf } = require('../utils/tarif');
const { PAYS } = require('../config/constants');
const LIB = { carte: 'Carte bancaire', orange_money: 'Orange Money', mtn_momo: 'MTN MoMo' };

const trouver = (numero) => Colis.findOne({ numeroSuivi: String(numero || '').trim().toUpperCase() });
const tauxDe = (colis, config) => colis.tarif?.taux || config.tauxEurGnf;
const versEur = (gnf, taux) => Math.ceil((gnf / taux) * 100) / 100;

/** Moyens de paiement en ligne proposés, par pays d'où l'on paie. */
function moyensEnLigne(config) {
  const p = config.paiements || {};
  const res = {};
  for (const pays of Object.keys(PAYS)) {
    const liste = [];
    for (const m of ['carte', 'orange_money', 'mtn_momo']) {
      if (!p[pays]?.[m]) continue;
      if (m === 'carte') { if (process.env.STRIPE_SECRET_KEY) liste.push({ key: m, label: LIB[m], devise: 'EUR' }); continue; }
      const compte = p.comptes?.[m];
      if (compte?.numero) liste.push({ key: m, label: LIB[m], devise: 'GNF', numero: compte.numero, titulaire: compte.titulaire || '' });
    }
    res[pays] = liste;
  }
  return res;
}

/** Ce qui peut être payé en ligne sur un colis : courses à domicile d'avance, et le solde après pesée. */
async function aPayer(colis, config) {
  const taux = tauxDe(colis, config);
  const domicileGnf = domicileAPayerGnf(colis);
  const { soldeGnf } = calculerSolde(colis, config);
  const fini = [STATUTS.REMIS, STATUTS.ANNULE].includes(colis.statut);
  // Le client peut tout payer en ligne dès la réservation (prix estimé) : la différence
  // éventuelle est réglée à la pesée (complément au comptoir, ou trop-payé rendu).
  const soldePayable = !fini && soldeGnf > 0;
  const enAttente = (colis.declarations || []).filter(d => d.statut === 'a_verifier');
  return {
    domicile: { gnf: fini ? 0 : domicileGnf, eur: versEur(domicileGnf, taux) },
    solde: { gnf: soldePayable ? soldeGnf : 0, eur: soldePayable ? versEur(soldeGnf, taux) : 0, estime: !!colis.tarif?.estime },
    enAttente: enAttente.map(d => ({ id: d._id, methode: d.methode, objet: d.objet, montantGnf: d.montantGnf, reference: d.reference, le: d.le })),
    taux,
  };
}

/** Répartit un paiement d'avance sur les courses pas encore payées (ramassage d'abord). */
function appliquerDomicile(colis, montantGnf) {
  let reste = montantGnf;
  for (const k of ['ramassage', 'livraison']) {
    const c = colis[k];
    if (!c?.demande || c.statut === 'annulee' || !(c.prixGnf > 0)) continue;
    const du = Math.max(0, c.prixGnf - (c.payeGnf || 0));
    const part = Math.min(du, reste);
    if (part <= 0) continue;
    c.payeGnf = (c.payeGnf || 0) + part;
    if (c.payeGnf >= c.prixGnf) c.payeeLe = new Date();
    reste -= part;
    colis.markModified(k);
  }
}

/** Enregistre un paiement en ligne (carte ou mobile money validé). */
async function enregistrerEnLigne(colis, { montant, devise, methode, reference, objet }) {
  if (colis.paiements.some(p => p.reference === reference)) return colis;
  const config = await Config.get();
  const montantGnf = enGnf(montant, devise, tauxDe(colis, config));
  colis.paiements.push({ montant, devise, methode, lieu: 'EN_LIGNE', reference, objet: objet === 'domicile' ? 'domicile' : 'global', le: new Date() });
  // Un paiement global couvre d'abord les courses à domicile : elles sont alors programmées
  const avantCourses = (colis.ramassage?.payeGnf || 0) + (colis.livraison?.payeGnf || 0);
  appliquerDomicile(colis, montantGnf);
  const coursesPayees = (colis.ramassage?.payeGnf || 0) + (colis.livraison?.payeGnf || 0) > avantCourses;
  colis.historique.push({
    label: objet === 'domicile' ? 'Livraison / ramassage payés en ligne' : 'Paiement en ligne reçu',
    detail: `${devise === 'EUR' ? `${String(montant).replace('.', ',')} €` : `${montant.toLocaleString('fr-FR')} GNF`} · ${LIB[methode] || methode}`,
    le: new Date(),
  });
  await colis.save();
  if (objet === 'domicile' || coursesPayees) await require('../services/factureService').emettreSansBloquer(colis, { moment: 'domicile' });
  return colis;
}

// Enregistre un paiement Stripe une seule fois (webhook et vérification peuvent arriver tous les deux)
async function enregistrerPaiementStripe(session) {
  const colis = await Colis.findById(session.metadata?.colisId);
  if (!colis) return null;
  return enregistrerEnLigne(colis, { montant: session.amount_total / 100, devise: 'EUR', methode: 'carte', reference: session.id, objet: session.metadata?.objet });
}

// ── GET /api/paiements/a-payer/:numero ── montants payables en ligne et moyens proposés
const resumeAPayer = async (req, res) => {
  const colis = await trouver(req.params.numero);
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const config = await Config.get();
  res.json({ succes: true, ...(await aPayer(colis, config)), moyens: moyensEnLigne(config), sens: colis.sens || 'FR-GN', payeurArrivee: !!colis.payeurArrivee });
};

// ── POST /api/paiements/creer-session ── { numero, objet: 'solde' | 'domicile' }
const creerSession = async (req, res) => {
  if (!getStripe()) return res.status(503).json({ succes: false, message: 'Paiement par carte non configuré.' });
  const colis = await trouver(req.body.numero);
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const config = await Config.get();
  const objet = req.body.objet === 'domicile' ? 'domicile' : 'solde';
  const dus = await aPayer(colis, config);
  const montant = objet === 'domicile' ? dus.domicile : dus.solde;
  const centimes = Math.round(montant.eur * 100);
  if (centimes < 50) return res.status(400).json({ succes: false, message: 'Rien à payer.' });

  const session = await getStripe().checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    locale: 'fr',
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: centimes,
        product_data: { name: objet === 'domicile' ? `${APP_NOM} · livraison à domicile, colis ${colis.numeroSuivi}` : `${APP_NOM} · colis ${colis.numeroSuivi}` },
      },
      quantity: 1,
    }],
    metadata: { colisId: colis._id.toString(), numeroSuivi: colis.numeroSuivi, objet },
    success_url: `${process.env.FRONTEND_URL}/paiement-succes.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.FRONTEND_URL}/#/suivi/${colis.numeroSuivi}`,
  });
  res.json({ succes: true, url: session.url });
};

// ── POST /api/paiements/mobile ── { numero, objet, methode, reference, telephone }
// Le client a envoyé l'argent sur le compte marchand TMS : on note sa déclaration,
// l'équipe vérifie la réception puis valide.
const declarerMobile = async (req, res) => {
  const { methode, objet } = req.body;
  const reference = String(req.body.reference || '').trim().slice(0, 60);
  if (!['orange_money', 'mtn_momo'].includes(methode)) return res.status(400).json({ succes: false, message: 'Moyen de paiement inconnu.' });
  if (reference.length < 4) return res.status(400).json({ succes: false, message: 'Indiquez la référence de la transaction reçue par SMS.' });
  const colis = await trouver(req.body.numero);
  if (!colis) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const config = await Config.get();
  if (!Object.values(moyensEnLigne(config)).flat().some(m => m.key === methode)) return res.status(400).json({ succes: false, message: `${LIB[methode]} n'est pas proposé pour le moment.` });
  const dus = await aPayer(colis, config);
  const obj = objet === 'domicile' ? 'domicile' : 'global';
  const montantGnf = obj === 'domicile' ? dus.domicile.gnf : dus.solde.gnf;
  if (!(montantGnf > 0)) return res.status(400).json({ succes: false, message: 'Rien à payer.' });
  if ((colis.declarations || []).some(d => d.reference.toUpperCase() === reference.toUpperCase())) return res.status(409).json({ succes: false, message: 'Cette référence a déjà été envoyée. Elle est en cours de vérification.' });
  // Anti-abus : pas plus de 3 paiements en attente de vérification sur un même colis
  if ((colis.declarations || []).filter(d => d.statut === 'a_verifier').length >= 3) return res.status(429).json({ succes: false, message: 'Des paiements sont déjà en vérification pour ce colis. Patientez ou contactez l\'agence.' });
  colis.declarations = colis.declarations || [];
  colis.declarations.push({ methode, objet: obj, montantGnf, reference, telephone: String(req.body.telephone || '').trim().slice(0, 30) });
  colis.historique.push({ label: 'Paiement mobile money envoyé, en vérification', detail: `${montantGnf.toLocaleString('fr-FR')} GNF · ${LIB[methode]}`, le: new Date() });
  await colis.save();
  const push = require('../utils/push');
  push.sansAttendre(push.auxAdmins({ titre: 'Paiement à vérifier', corps: `${colis.numeroSuivi} : ${montantGnf.toLocaleString('fr-FR')} GNF par ${LIB[methode]} (réf. ${reference}).`, chemin: '/#/caisses' }));
  res.status(201).json({ succes: true, ...(await aPayer(colis, config)) });
};

// ── GET /api/paiements/declarations ── (admin) paiements mobile money à vérifier
const listeDeclarations = async (req, res) => {
  const liste = await Colis.find({ 'declarations.statut': 'a_verifier' }).select('numeroSuivi expediteur destinataire declarations sens').limit(200);
  const res2 = [];
  for (const c of liste) {
    for (const d of c.declarations.filter(x => x.statut === 'a_verifier')) {
      res2.push({ id: d._id, numeroSuivi: c.numeroSuivi, expediteur: c.expediteur?.nom, destinataire: c.destinataire?.nom, methode: d.methode, methodeLabel: LIB[d.methode], objet: d.objet, montantGnf: d.montantGnf, reference: d.reference, telephone: d.telephone, le: d.le });
    }
  }
  res.json({ succes: true, declarations: res2.sort((a, b) => new Date(a.le) - new Date(b.le)) });
};

// ── POST /api/paiements/declarations/:id ── (admin) { decision: 'valider' | 'refuser', motif }
const traiterDeclaration = async (req, res) => {
  const colis = await Colis.findOne({ 'declarations._id': req.params.id });
  if (!colis) return res.status(404).json({ succes: false, message: 'Déclaration introuvable.' });
  const d = colis.declarations.id(req.params.id);
  if (d.statut !== 'a_verifier') return res.status(409).json({ succes: false, message: 'Déjà traitée.' });
  const valider = req.body.decision === 'valider';
  d.statut = valider ? 'valide' : 'refuse';
  d.traiteLe = new Date(); d.traitePar = req.user._id;
  d.motif = String(req.body.motif || '').slice(0, 200);
  const { notifier } = require('../utils/sms');
  if (valider) {
    await enregistrerEnLigne(colis, { montant: d.montantGnf, devise: 'GNF', methode: d.methode, reference: d.reference, objet: d.objet });
    notifier(colis.expediteur.telephone, `${APP_NOM} : paiement de ${d.montantGnf.toLocaleString('fr-FR')} GNF bien reçu pour le colis ${colis.numeroSuivi}. Merci !`);
  } else {
    colis.historique.push({ label: 'Paiement mobile money non reçu', detail: d.motif || `Réf. ${d.reference}`, le: new Date() });
    await colis.save();
    notifier(colis.expediteur.telephone, `${APP_NOM} : nous n'avons pas trouvé le paiement (réf. ${d.reference}) pour le colis ${colis.numeroSuivi}. ${d.motif || 'Vérifiez la référence ou contactez l\'agence.'}`);
  }
  res.json({ succes: true });
};

// ── POST /api/paiements/webhook ── (raw body, monté dans server.js)
const webhookStripe = async (req, res) => {
  if (!getStripe()) return res.status(503).end();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed' && event.data.object.payment_status === 'paid') {
    await enregistrerPaiementStripe(event.data.object);
  }
  res.json({ received: true });
};

// ── GET /api/paiements/verifier/:sessionId
const verifierSession = async (req, res) => {
  if (!getStripe()) return res.status(503).json({ succes: false, message: 'Paiement par carte non configuré.' });
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(String(req.params.sessionId))) return res.status(404).json({ succes: false, message: 'Paiement introuvable.' });
  const session = await getStripe().checkout.sessions.retrieve(req.params.sessionId).catch(() => null);
  if (!session || !session.metadata?.colisId) return res.status(404).json({ succes: false, message: 'Paiement introuvable.' });
  if (session.payment_status !== 'paid') return res.json({ succes: true, paye: false });
  const colis = await enregistrerPaiementStripe(session);
  res.json({ succes: true, paye: true, numeroSuivi: colis?.numeroSuivi });
};

module.exports = { creerSession, webhookStripe, verifierSession, resumeAPayer, declarerMobile, listeDeclarations, traiterDeclaration, moyensEnLigne, appliquerDomicile };
