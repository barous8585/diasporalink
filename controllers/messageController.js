const { validationResult } = require('express-validator');
const Message = require('../models/Message');
const Colis = require('../models/Colis');

// ── GET /api/messages/:colisId ────────────
const lireMessages = async (req, res) => {
  try {
    // Vérifier que le colis appartient au client ou est assigné au livreur
    const colis = await Colis.findById(req.params.colisId);
    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }

    const estAutorise =
      colis.client.toString() === req.user._id.toString() ||
      colis.livreur?.toString() === req.user._id.toString() ||
      req.user.role === 'admin';

    if (!estAutorise) {
      return res.status(403).json({ succes: false, message: 'Accès refusé.' });
    }

    const messages = await Message.find({ colis: req.params.colisId })
      .populate('expediteur', 'prenom nom initiales role')
      .sort({ createdAt: 1 });

    // Marquer comme lus
    await Message.updateMany(
      { colis: req.params.colisId, expediteur: { $ne: req.user._id }, lu: false },
      { lu: true, luLe: new Date() }
    );

    res.json({ succes: true, messages });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

// ── POST /api/messages/:colisId ───────────
const envoyerMessage = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ succes: false, erreurs: errors.array() });
  }

  try {
    const colis = await Colis.findById(req.params.colisId);
    if (!colis) {
      return res.status(404).json({ succes: false, message: 'Colis introuvable.' });
    }

    const estAutorise =
      colis.client.toString() === req.user._id.toString() ||
      colis.livreur?.toString() === req.user._id.toString() ||
      req.user.role === 'admin';

    if (!estAutorise) {
      return res.status(403).json({ succes: false, message: 'Accès refusé.' });
    }

    const message = await Message.create({
      colis: req.params.colisId,
      expediteur: req.user._id,
      role: req.user.role,
      texte: req.body.texte,
    });

    const populated = await message.populate('expediteur', 'prenom nom initiales role');

    // Émettre via Socket.io si disponible
    const io = req.app.get('io');
    if (io) {
      io.to(`colis-${req.params.colisId}`).emit('nouveau-message', populated);
    }

    res.status(201).json({ succes: true, message: populated });
  } catch (err) {
    res.status(500).json({ succes: false, message: 'Erreur serveur.' });
  }
};

module.exports = { lireMessages, envoyerMessage };
