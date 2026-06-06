const { validationResult } = require('express-validator');
const Colis = require('../models/Colis');
const { calculerTarif } = require('../utils/tarif');
const { notifierStatut } = require('../utils/sms');
const { STATUTS, PAYS } = require('../config/constants');

// ── POST /api/colis ───────────────────────
// Créer une demande de pick-up
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

    // Calculer le tarif
    const tarif = calculerTarif(paysDestination, poidsKg, valeurDeclare);

    // Créer le colis
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

    // Initialiser les étapes
    colis.initEtapes();

    await colis.save();

    res.status(201).json({ succes: true, colis });

  } catch (err) {
    console.error(err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis ────────────────────────
// Tous les colis du client connecté
const mesColis = async (req, res) => {
  try {
    const colis = await Colis.find({ client: req.user._id })
      .sort({ createdAt: -1 });
    res.json({ succes: true, colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis/:id ────────────────────
// Détail d'un colis
const unColis = async (req, res) => {
  try {
    const colis = await Colis.findOne({
      _id: req.params.id,
      client: req.user._id,
    }).populate('livreur', 'prenom nom telephone');

    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }

    res.json({ succes: true, colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis/suivi/:numero ──────────
// Suivi public par numéro (pas besoin d'être connecté)
const suiviPublic = async (req, res) => {
  try {
    const colis = await Colis.findOne({ numeroSuivi: req.params.numero })
      .select('numeroSuivi statut statutLabel etapes paysDestination villeDestination nomDestinataire createdAt');

    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Numéro de suivi introuvable.' });
    }

    res.json({ succes: true, colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── PATCH /api/colis/:id/statut ───────────
// Mettre à jour le statut (livreur ou admin)
const mettreAJourStatut = async (req, res) => {
  try {
    const { statut, indexEtape, detailEtape } = req.body;
    const colis = await Colis.findById(req.params.id).populate('client', 'telephone');

    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }

    // Mettre à jour le statut global
    colis.statut = statut;

    // Mettre à jour l'étape correspondante
    if (indexEtape !== undefined && colis.etapes[indexEtape]) {
      colis.etapes[indexEtape].statut = 'fait';
      colis.etapes[indexEtape].completeLe = new Date();
      if (detailEtape) colis.etapes[indexEtape].detail = detailEtape;

      // Passer l'étape suivante en "en_cours"
      if (colis.etapes[indexEtape + 1]) {
        colis.etapes[indexEtape + 1].statut = 'en_cours';
      }
    }

    await colis.save();

    // Notifier le client par SMS
    if (colis.client?.telephone) {
      await notifierStatut(colis.client.telephone, colis.numeroSuivi, colis.statutLabel);
    }

    res.json({ succes: true, colis });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── GET /api/colis/tarif ──────────────────
// Calculer le tarif avant commande
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
