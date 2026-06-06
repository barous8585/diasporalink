const { validationResult } = require('express-validator');
const User = require('../models/User');
const Colis = require('../models/Colis');

// ── GET /api/utilisateurs/moi ─────────────
// Profil complet avec statistiques
const monProfil = async (req, res) => {
  try {
    const [totalEnvois, totalDepense] = await Promise.all([
      Colis.countDocuments({ client: req.user._id, paiementStatut: 'paye' }),
      Colis.aggregate([
        { $match: { client: req.user._id, paiementStatut: 'paye' } },
        { $group: { _id: null, total: { $sum: '$tarif.total' } } },
      ]),
    ]);

    res.json({
      succes: true,
      utilisateur: req.user,
      stats: {
        totalEnvois,
        totalDepense: totalDepense[0]?.total || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── PATCH /api/utilisateurs/moi ───────────
// Mettre à jour le profil
const mettreAJourProfil = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ succes: false, erreurs: errors.array() });
  }

  try {
    const champs = ['prenom', 'nom', 'email', 'adresse', 'ville', 'codePostal'];
    champs.forEach(champ => {
      if (req.body[champ] !== undefined) {
        req.user[champ] = req.body[champ];
      }
    });
    await req.user.save();

    res.json({ succes: true, utilisateur: req.user });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

module.exports = { monProfil, mettreAJourProfil };
