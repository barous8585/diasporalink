const { validationResult } = require('express-validator');
const Remboursement = require('../models/Remboursement');
const Colis = require('../models/Colis');

const creerDemande = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ succes: false, erreurs: errors.array() });
  }
  try {
    const { colisId, motif, description } = req.body;
    const colis = await Colis.findOne({ _id: colisId, client: req.user._id });
    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }
    const existante = await Remboursement.findOne({
      colis: colisId,
      statut: { $in: ['en_attente', 'en_cours'] },
    });
    if (existante) {
      return res.status(400).json({ succes: false, message: 'Une demande est déjà en cours pour ce colis.' });
    }
    const demande = await Remboursement.create({
      colis: colisId,
      client: req.user._id,
      motif,
      description,
      montant: colis.tarif?.total,
    });
    const populated = await demande.populate([
      { path: 'colis', select: 'numeroSuivi villeDestination paysDestination tarif' },
    ]);
    res.status(201).json({ succes: true, remboursement: populated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

const mesDemandes = async (req, res) => {
  try {
    const demandes = await Remboursement.find({ client: req.user._id })
      .populate('colis', 'numeroSuivi villeDestination paysDestination tarif statut')
      .sort({ createdAt: -1 });
    res.json({ succes: true, remboursements: demandes });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

const toutesLesDemandes = async (req, res) => {
  try {
    const demandes = await Remboursement.find()
      .populate('colis',  'numeroSuivi villeDestination paysDestination tarif statut')
      .populate('client', 'prenom nom telephone')
      .sort({ createdAt: -1 });
    res.json({ succes: true, remboursements: demandes });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

const traiterDemande = async (req, res) => {
  try {
    const { statut, noteAdmin, montantApprouve } = req.body;
    const demande = await Remboursement.findById(req.params.id);
    if (!demande) {
      return res.status(404).json({ succes: false, message: 'Demande introuvable.' });
    }
    demande.statut          = statut;
    demande.noteAdmin       = noteAdmin;
    demande.montantApprouve = montantApprouve;
    demande.traitePar       = req.user._id;
    demande.traiteAt        = new Date();
    await demande.save();
    res.json({ succes: true, remboursement: demande });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

module.exports = { creerDemande, mesDemandes, toutesLesDemandes, traiterDemande };
