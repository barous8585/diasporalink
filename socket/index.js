const jwt = require('jsonwebtoken');
const User = require('../models/User');

const initSocket = (io) => {
  // Authentification Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Token manquant'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-otp');
      if (!user) return next(new Error('Utilisateur introuvable'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connecté : ${socket.user.nomComplet}`);

    // Rejoindre la salle d'un colis spécifique
    socket.on('rejoindre-colis', (colisId) => {
      socket.join(`colis-${colisId}`);
    });

    // Quitter la salle
    socket.on('quitter-colis', (colisId) => {
      socket.leave(`colis-${colisId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket déconnecté : ${socket.user.nomComplet}`);
    });
  });
};

module.exports = initSocket;
