const { validationResult } = require('express-validator');
const Colis = require('../models/Colis');
const { calculerTarif } = require('../utils/tarif');
const { notifierStatut } = require('../utils/sms');
const { STATUTS, PAYS } = require('../config/constants');

// ── POST /api/colis ───────────────────────
const creerColis = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ succes: false, erreurs: errors.array() });
  }
  try {
    const {
      adresseCollecte, villeCollecte, dateCollecte, creneau,
      paysDestination, villeDestination, nomDestinataire, telDestinataire,
      typeColis, poidsKg, valeurDeclare, description,
    } = req.body;

    // calculerTarif est maintenant async
    const tarif = await calculerTarif(paysDestination, poidsKg, valeurDeclare);

    const colis = new Colis({
      client: req.user._id,
      adresseCollecte, villeCollecte,
      dateCollecte: new Date(dateCollecte),
      creneau,
      paysDestination, villeDestination,
      nomDestinataire, telDestinataire,
      typeColis, poidsKg, valeurDeclare, description,
      tarif,
    });
    colis.initEtapes();
    await colis.save();
    res.status(201).json({ succes: true, colis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis ────────────────────────
const mesColis = async (req, res) => {
  try {
    const filtre = req.user.role === 'admin'
      ? {}
      : req.user.role === 'livreur'
        ? { livreur: req.user._id }
        : { client: req.user._id };

    const colis = await Colis.find(filtre)
      .populate('client',  'prenom nom telephone')
      .populate('livreur', 'prenom nom telephone')
      .sort({ createdAt: -1 });
    res.json({ succes: true, colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis/:id ────────────────────
const unColis = async (req, res) => {
  try {
    const filtre = req.user.role === 'admin'
      ? { _id: req.params.id }
      : req.user.role === 'livreur'
        ? { _id: req.params.id, livreur: req.user._id }
        : { _id: req.params.id, client: req.user._id };

    const colis = await Colis.findOne(filtre)
      .populate('client',  'prenom nom telephone')
      .populate('livreur', 'prenom nom telephone');

    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }
    res.json({ succes: true, colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis/suivi/:numero ──────────
const suiviPublic = async (req, res) => {
  try {
    const colis = await Colis.findOne({ numeroSuivi: req.params.numero })
      .select('numeroSuivi statut statutLabel etapes paysDestination villeDestination nomDestinataire adresseCollecte poidsKg typeColis createdAt dateCollecte');
    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Numéro de suivi introuvable.' });
    }
    res.json({ succes: true, colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── PATCH /api/colis/:id/statut ───────────
const mettreAJourStatut = async (req, res) => {
  try {
    const { statut, indexEtape, detailEtape } = req.body;
    const colis = await Colis.findById(req.params.id).populate('client', 'telephone');
    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }

    colis.statut = statut;

    if (indexEtape !== undefined && colis.etapes[indexEtape]) {
      colis.etapes[indexEtape].statut     = 'fait';
      colis.etapes[indexEtape].completeLe = new Date();
      if (detailEtape) colis.etapes[indexEtape].detail = detailEtape;
      if (colis.etapes[indexEtape + 1]) {
        colis.etapes[indexEtape + 1].statut = 'en_cours';
      }
    }

    colis.markModified('etapes');
    await colis.save();

    if (colis.client?.telephone) {
      await notifierStatut(colis.client.telephone, colis.numeroSuivi, colis.statutLabel);
    }

    res.json({ succes: true, colis });
  } catch (err) {
    console.error('Erreur mettreAJourStatut:', err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── PATCH /api/colis/:id/assigner ─────────
const assignerLivreur = async (req, res) => {
  try {
    const { livreurId } = req.body;
    if (!livreurId) {
      return res.status(400).json({ succes: false, message: 'Livreur requis.' });
    }

    const colis = await Colis.findById(req.params.id);
    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }

    const User    = require('../models/User');
    const livreur = await User.findById(livreurId);
    if (!livreur) {
      return res.status(404).json({ succes: false, message: 'Livreur introuvable.' });
    }

    colis.livreur = livreurId;

    if (colis.statut === 'en_attente') {
      colis.statut = 'confirme';
      if (colis.etapes[0]) {
        colis.etapes[0].statut     = 'fait';
        colis.etapes[0].completeLe = new Date();
      }
      if (colis.etapes[1]) {
        colis.etapes[1].statut = 'en_cours';
      }
      colis.markModified('etapes');
    }

    await colis.save();

    const populated = await colis.populate([
      { path: 'client',  select: 'prenom nom telephone' },
      { path: 'livreur', select: 'prenom nom telephone' },
    ]);

    res.json({ succes: true, colis: populated });
  } catch (err) {
    console.error('Erreur assignerLivreur:', err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis/tarif ──────────────────
const calculerTarifCtrl = async (req, res) => {
  try {
    const { pays, poids, valeur } = req.query;
    if (!pays || !poids) {
      return res.status(400).json({ succes: false, message: 'Pays et poids requis.' });
    }
    const tarif = await calculerTarif(pays, poids, valeur);
    res.json({ succes: true, tarif });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

module.exports = {
  creerColis,
  mesColis,
  unColis,
  suiviPublic,
  mettreAJourStatut,
  calculerTarifCtrl,
  assignerLivreur,
};
