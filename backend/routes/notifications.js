// ── routes/notifications.js ────────────────────────────────
const notifRouter = require('express').Router();
const webpush = require('web-push');
const auth = require('../middleware/auth');
const User = require('../models/User');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// POST /api/notifications/subscribe — enregistrer un token push
notifRouter.post('/subscribe', auth, async (req, res) => {
  try {
    const { subscription } = req.body;
    const token = JSON.stringify(subscription);
    if (!req.user.pushTokens.includes(token)) {
      req.user.pushTokens.push(token);
      await req.user.save();
    }
    res.json({ message: 'Abonnement push enregistré.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/notifications/send — envoyer une notification (admin)
notifRouter.post('/send', auth, async (req, res) => {
  try {
    const { userId, title, body, url } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const payload = JSON.stringify({ title, body, url: url || '/' });
    const results = await Promise.allSettled(
      user.pushTokens.map(token =>
        webpush.sendNotification(JSON.parse(token), payload)
      )
    );

    res.json({ sent: results.filter(r => r.status === 'fulfilled').length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur envoi notification.' });
  }
});

// GET /api/notifications/vapid-public-key — clé publique VAPID pour le frontend
notifRouter.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

module.exports = notifRouter;
