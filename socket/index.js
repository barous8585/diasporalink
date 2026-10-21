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

  require('../utils/temps-reel').brancher(io);

  io.on('connection', async (socket) => {
    // Chaque app rejoint les « salles » qui la concernent : elle sera prévenue des changements
    const u = socket.user;
    try {
      if (u.role === 'admin') socket.join('admins');
      if (['agent', 'livreur'].includes(u.role) && u.lieu) {
        socket.join(`agence:${u.lieu}`);
        const lieu = await require('../models/Config').lieu(u.lieu);
        if (u.role === 'agent' && lieu?.plateforme) socket.join(`pays:${lieu.pays}`);
      }
      socket.join(`user:${u._id}`);
      // Les avis clients sont communs à tous : chaque app ouverte est prévenue d'un nouvel avis
      socket.join('avis');
      // Numéro vérifié, ou client : prévenu pour les colis à son numéro (les données restent filtrées par l'API)
      if (u.role === 'client' && u.telephone) socket.join(`tel:${u.telephone}`);
    } catch (e) { console.error('[socket]', e.message); }

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

    socket.on('disconnect', () => {});
  });
};

module.exports = initSocket;
