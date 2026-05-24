const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Pickup = require('../models/Pickup');

// GET /api/users/me — profil complet avec stats
router.get('/me', auth, async (req, res) => {
  try {
    const [totalShipments, totalSpent] = await Promise.all([
      Pickup.countDocuments({ user: req.user._id, paymentStatus: 'paid' }),
      Pickup.aggregate([
        { $match: { user: req.user._id, paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$pricing.total' } } }
      ])
    ]);

    res.json({
      user: req.user,
      stats: {
        totalShipments,
        totalSpent: totalSpent[0]?.total || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/me — mettre à jour le profil
router.patch('/me', auth, [
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('email').optional().isEmail(),
  body('address').optional().trim(),
  body('city').optional().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const allowed = ['firstName', 'lastName', 'email', 'address', 'city'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) req.user[field] = req.body[field];
    });
    await req.user.save();
    res.json({ user: req.user });
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour profil.' });
  }
});

module.exports = router;
