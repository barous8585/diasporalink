require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const initSocket = require('./socket');

const app = express();
const server = http.createServer(app);

// ── Trust proxy ────────────────────────────
app.set('trust proxy', 1);

// ── CORS ───────────────────────────────────
const corsOptions = {
  origin: function(origin, callback) {
    const allowed = [
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
      process.env.AGENT_URL,
      'http://localhost:5000',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
    ].filter(Boolean);
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS non autorisé : ' + origin));
    }
  },
  credentials: true,
};

// ── Socket.io ─────────────────────────────
const io = new Server(server, { cors: corsOptions });
initSocket(io);
app.set('io', io);

// ── Connexion BDD ─────────────────────────
connectDB();

// ── Webhook Stripe AVANT express.json ─────
app.post(
  '/api/paiements/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => require('./controllers/paiementController').webhookStripe(req, res).catch(next)
);

// ── Middlewares ───────────────────────────
// L'API ne sert que du JSON ; la CSP est gérée par les apps (Netlify).
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600, // les agents scannent beaucoup
  message: { succes: false, message: 'Trop de requêtes. Réessayez dans 15 minutes.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { succes: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ── Routes ────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/config',       require('./routes/config'));
app.use('/api/colis',        require('./routes/colis'));
app.use('/api/paiements',    require('./routes/paiements'));
app.use('/api/agent',        require('./routes/agent'));
app.use('/api/livreur',      require('./routes/livreur'));
app.use('/api/push',         require('./routes/push'));
app.use('/api/factures',     require('./routes/factures'));
app.use('/api/reclamations', require('./routes/reclamations'));
app.use('/api/photos',       require('./routes/photos'));
app.use('/api/lots',         require('./routes/lots'));
app.use('/api/caisse',       require('./routes/caisse'));
app.use('/api/admin',        require('./routes/admin'));
app.use('/api/utilisateurs', require('./routes/utilisateurs'));

// ── Apps statiques (pratique en local : un seul serveur) ──
if (process.env.SERVIR_APPS === '1') {
  const path = require('path');
  app.use('/agent', express.static(path.join(__dirname, 'agent')));
  app.use('/admin', express.static(path.join(__dirname, 'admin')));
  app.use('/', express.static(path.join(__dirname, 'frontend')));
}

// ── Health check ──────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    succes: true,
    message: `${require('./config/constants').APP_NOM} API opérationnelle`,
    version: '1.0.0',
    env: process.env.NODE_ENV,
  });
});

// ── 404 ───────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ succes: false, message: 'Route introuvable.' });
});

// ── Erreurs globales ──────────────────────
app.use((err, req, res, next) => {
  // Erreurs métier (ErreurMetier) : message clair pour l'utilisateur
  if (err.name === 'ErreurMetier' || (err.status && err.status < 500 && err.expose !== false && !err.type)) {
    return res.status(err.status).json({ succes: false, message: err.message, code: err.code });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ succes: false, message: Object.values(err.errors)[0]?.message || 'Données invalides.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ succes: false, message: 'JSON invalide.' });
  }
  console.error(err.stack);
  res.status(err.status || 500).json({
    succes: false,
    message: process.env.NODE_ENV === 'production' ? 'Erreur serveur interne.' : err.message,
  });
});

// ── Démarrage ─────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 API — port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;
