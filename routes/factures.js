// ─────────────────────────────────────────────────────────────
//  Factures : consultation (lien partageable ou compte), émission, registre
// ─────────────────────────────────────────────────────────────
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const Facture = require('../models/Facture');
const Colis = require('../models/Colis');
const { auth, role } = require('../middleware/auth');
const { ah } = require('../utils/http');
const { ROLES } = require('../config/constants');
const svc = require('../services/colisService');
const fact = require('../services/factureService');

const lienLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { succes: false, message: 'Trop de demandes, patientez une minute.' } });

async function avecEtat(facture) {
  const colis = await Colis.findById(facture.colis);
  const toutes = colis ? await fact.facturesDuColis(colis) : [];
  return toutes.find(f => f.numero === facture.numero) || facture;
}

// ── GET /api/factures/public/:numero?t=jeton ── lien envoyé au client (WhatsApp…)
router.get('/public/:numero', lienLimiter, ah(async (req, res) => {
  const f = await Facture.findOne({ numero: String(req.params.numero).toUpperCase() }).lean();
  if (!f || !req.query.t || req.query.t !== f.jeton) return res.status(404).json({ succes: false, message: 'Facture introuvable.' });
  res.json({ succes: true, facture: await avecEtat(f) });
}));

// ── GET /api/factures/mes ── toutes les factures des colis du client (envoyés et reçus)
router.get('/mes', auth, ah(async (req, res) => {
  const u = req.user;
  const liste = await Colis.find({ $or: [{ client: u._id }, { 'expediteur.telephone': u.telephone }, { 'destinataire.telephone': u.telephone }, { 'tiersAutorise.telephone': u.telephone }] }).select('_id client expediteur destinataire tiersAutorise').limit(1000);
  const niveaux = await Promise.all(liste.map(c => svc.niveauAcces(c, u)));
  const complets = liste.filter((c, i) => niveaux[i] === 'complet').map(c => c._id);
  const restreints = liste.filter((c, i) => niveaux[i] === 'restreint').map(c => c._id);
  // Numéro non vérifié : seulement les factures établies à son nom
  const factures = await Facture.find({ $or: [{ colis: { $in: complets } }, { colis: { $in: restreints }, 'client.telephone': u.telephone }] }).sort({ date: -1 }).limit(500).lean();
  res.json({ succes: true, factures: await Promise.all(factures.map(avecEtat)) });
}));

// ── GET /api/factures/colis/:numero ── factures d'un colis (client lié, équipe)
router.get('/colis/:numero', auth, ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() });
  const niveau = await svc.niveauAcces(colis, req.user);
  if (!niveau) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  const toutes = await fact.facturesDuColis(colis);
  res.json({ succes: true, factures: niveau === 'complet' ? toutes : toutes.filter(f => f.client?.telephone === req.user.telephone) });
}));

// ── POST /api/factures/colis/:numero/emettre ── équipe : facturer ce qui ne l'est pas encore
router.post('/colis/:numero/emettre', auth, role(ROLES.AGENT, ROLES.ADMIN), ah(async (req, res) => {
  const colis = await Colis.findOne({ numeroSuivi: req.params.numero.toUpperCase() });
  if (!colis || !(await svc.agentVoitColis(colis, req.user))) return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
  if (!colis.tarif || colis.tarif.estime) return res.status(409).json({ succes: false, message: 'Le colis n\'est pas encore pesé.' });
  const moment = colis.statut === 'remis' ? 'remise' : 'depot';
  const f = await fact.emettre(colis, { moment, agent: req.user });
  if (!f) return res.status(409).json({ succes: false, message: 'Tout est déjà facturé pour ce colis.' });
  res.status(201).json({ succes: true, facture: f });
}));

// ── Registre (admin) : GET /api/factures?debut=2026-10-01&fin=2026-10-31
function filtrePeriode(q) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(new Date(v));
  const debut = ok(q.debut) ? new Date(q.debut) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const fin = ok(q.fin) ? new Date(q.fin) : new Date();
  fin.setHours(23, 59, 59, 999);
  return { date: { $gte: debut, $lte: fin } };
}
router.get('/', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  // Liste : seulement l'en-tête de chaque facture (le détail s'ouvre à part)
  const factures = await Facture.find(filtrePeriode(req.query)).sort({ date: -1 }).limit(2000)
    .select('numero type date numeroSuivi client agence devise totalHT totalTVA totalTTC totalGnf factureOrigine jeton colis demo').lean();
  res.json({ succes: true, factures });
}));

// ── GET /api/factures/export.csv ── registre pour l'expert-comptable (séparateur « ; »)
router.get('/export.csv', auth, role(ROLES.ADMIN), ah(async (req, res) => {
  const factures = await Facture.find(filtrePeriode(req.query)).sort({ date: 1 }).lean();
  const n = (x) => (x === undefined || x === null ? '' : String(x).replace('.', ','));
  const cell = (s) => { let t = String(s ?? ''); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  const lignes = [['Numéro', 'Type', 'Date', 'Colis', 'Client', 'Téléphone', 'Agence', 'Devise', 'Total HT', 'TVA', 'Total TTC', 'Taux de TVA', 'Facture d\'origine'].map(cell).join(';')];
  for (const f of factures) {
    const signe = f.type === 'avoir' ? -1 : 1;
    lignes.push([
      cell(f.numero), cell(f.type === 'avoir' ? 'Avoir' : 'Facture'), cell(new Date(f.date).toLocaleDateString('fr-FR')), cell(f.numeroSuivi),
      cell(f.client?.nom), cell(f.client?.telephone), cell(f.agence?.nom), cell(f.devise),
      n(signe * f.totalHT), n(signe * f.totalTVA), n(signe * f.totalTTC),
      cell((f.parTaux || []).map(p => `${Math.round(p.taux * 1000) / 10} %`).join(' + ')), cell(f.factureOrigine || ''),
    ].join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="factures-${(req.query.debut || '').slice(0, 10) || 'mois'}.csv"`);
  res.send('﻿' + lignes.join('\r\n'));
}));

module.exports = router;
