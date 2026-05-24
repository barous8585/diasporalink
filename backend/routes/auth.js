const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const User = require('../models/User');
const auth = require('../middleware/auth');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ── POST /api/auth/send-otp ────────────────────────────────
// Envoie un OTP par SMS au numéro fourni
router.post('/send-otp', [
  body('phone').isMobilePhone().withMessage('Numéro de téléphone invalide'),
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { phone, firstName, lastName } = req.body;

    let user = await User.findOne({ phone });
    if (!user) {
      if (!firstName || !lastName) {
        return res.status(400).json({ error: 'Prénom et nom requis pour l\'inscription.' });
      }
      user = new User({ phone, firstName, lastName });
    }

    const code = user.generateOTP();
    await user.save();

    // Envoi SMS via Twilio
    if (process.env.NODE_ENV === 'production') {
      await twilioClient.messages.create({
        body: `Votre code DiasporaLink : ${code}\nValable 10 minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
      });
    } else {
      // En dev, afficher le code dans la console
      console.log(`🔑 OTP pour ${phone} : ${code}`);
    }

    res.json({ message: 'Code envoyé par SMS.', isNewUser: !user.isVerified });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi du SMS.' });
  }
});

// ── POST /api/auth/verify-otp ──────────────────────────────
// Vérifie l'OTP et retourne un JWT
router.post('/verify-otp', [
  body('phone').isMobilePhone(),
  body('code').isLength({ min: 6, max: 6 }).isNumeric()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { phone, code } = req.body;
    const user = await User.findOne({ phone });

    if (!user || !user.verifyOTP(code)) {
      return res.status(401).json({ error: 'Code invalide ou expiré.' });
    }

    user.isVerified = true;
    user.otp = undefined;
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });

    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/logout ──────────────────────────────────
router.post('/logout', auth, async (req, res) => {
  // Côté client, supprimer le token du localStorage
  res.json({ message: 'Déconnexion réussie.' });
});

module.exports = router;
