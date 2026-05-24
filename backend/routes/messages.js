const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const Pickup = require('../models/Pickup');

// GET /api/messages/:pickupId — historique du chat
router.get('/:pickupId', auth, async (req, res) => {
  try {
    const pickup = await Pickup.findOne({ _id: req.params.pickupId, user: req.user._id });
    if (!pickup) return res.status(404).json({ error: 'Colis introuvable.' });

    const messages = await Message.find({ pickup: req.params.pickupId })
      .populate('from', 'firstName lastName initials')
      .sort({ createdAt: 1 });

    // Marquer comme lus
    await Message.updateMany(
      { pickup: req.params.pickupId, from: { $ne: req.user._id }, readAt: null },
      { readAt: new Date() }
    );

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/messages/:pickupId — envoyer un message
router.post('/:pickupId', auth, [
  body('text').trim().notEmpty().isLength({ max: 1000 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const pickup = await Pickup.findOne({ _id: req.params.pickupId, user: req.user._id });
    if (!pickup) return res.status(404).json({ error: 'Colis introuvable.' });

    const message = await Message.create({
      pickup: req.params.pickupId,
      from: req.user._id,
      fromRole: 'user',
      text: req.body.text
    });

    const populated = await message.populate('from', 'firstName lastName initials');
    res.status(201).json({ message: populated });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
