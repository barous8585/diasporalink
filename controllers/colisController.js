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

    const tarif = calculerTarif(paysDestination, poidsKg, valeurDeclare);

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
    // Admin voit tous les colis
    const filtre = req.user.role === 'admin' ? {} : { client: req.user._id };
    const colis = await Colis.find(filtre)
      .populate('client', 'prenom nom telephone')
      .sort({ createdAt: -1 });
    res.json({ succes: true, colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis/:id ────────────────────
const unColis = async (req, res) => {
  try {
    // Admin peut voir n'importe quel colis
    const filtre = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, client: req.user._id };

    const colis = await Colis.findOne(filtre)
      .populate('client', 'prenom nom telephone')
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

    // Mettre à jour le statut global
    colis.statut = statut;

    // Mettre à jour les étapes
    if (indexEtape !== undefined && colis.etapes[indexEtape]) {
      colis.etapes[indexEtape].statut    = 'fait';
      colis.etapes[indexEtape].completeLe = new Date();
      if (detailEtape) colis.etapes[indexEtape].detail = detailEtape;

      if (colis.etapes[indexEtape + 1]) {
        colis.etapes[indexEtape + 1].statut = 'en_cours';
      }
    }

    // IMPORTANT : forcer la détection des changements dans le tableau
    colis.markModified('etapes');
    await colis.save();

    // Notifier le client par SMS
    if (colis.client?.telephone) {
      await notifierStatut(colis.client.telephone, colis.numeroSuivi, colis.statutLabel);
    }

    res.json({ succes: true, colis });
  } catch (err) {
    console.error('Erreur mettreAJourStatut:', err);
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
    const tarif = calculerTarif(pays, poids, valeur);
    res.json({ succes: true, tarif });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

module.exports = { creerColis, mesColis, unColis, suiviPublic, mettreAJourStatut, calculerTarifCtrl };
