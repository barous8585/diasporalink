const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Vérifier le token JWT
const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ succes: false, message: 'Token manquant.' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    const user = await User.findById(decoded.id).select('-otp -__v');
    if (!user || !user.actif) {
      return res.status(401).json({ succes: false, message: 'Utilisateur introuvable.' });
    }
    // Session fermée si le mot de passe a été changé ou réinitialisé depuis
    if ((decoded.v || 0) !== (user.jetonVersion || 0)) {
      return res.status(401).json({ succes: false, message: 'Session expirée, reconnectez-vous.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ succes: false, message: 'Token invalide ou expiré.' });
  }
};

// Vérifier le rôle
const role = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ succes: false, message: 'Accès refusé.' });
  }
  next();
};

module.exports = { auth, role };
