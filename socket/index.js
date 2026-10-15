const jwt = require('jsonwebtoken');
const User = require('../models/User');

const initSocket = (io) => {
  // Authentification Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Token manquant'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      const user = await User.findById(decoded.id).select('-otp');
      if (!user || !user.actif || (decoded.v || 0) !== (user.jetonVersion || 0)) return next(new Error('Session invalide'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connecté : ${socket.user.nomComplet}`);

    // Rejoindre la salle d'un colis spécifique
    // Seule l'équipe peut suivre un colis en direct (aucune donnée client n'y transite pour l'instant)
    socket.on('rejoindre-colis', (colisId) => {
      if (!['agent', 'admin', 'livreur'].includes(socket.user.role)) return;
      socket.join(`colis-${String(colisId).slice(0, 40)}`);
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
