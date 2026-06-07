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
      process.env.LIVREUR_URL,
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
  require('./controllers/paiementController').webhookStripe
);

// ── Middlewares ───────────────────────────
app.use(helmet());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/colis',          require('./routes/colis'));
app.use('/api/paiements',      require('./routes/paiements'));
app.use('/api/messages',       require('./routes/messages'));
app.use('/api/utilisateurs',   require('./routes/utilisateurs'));
app.use('/api/config',         require('./routes/config'));
app.use('/api/remboursements', require('./routes/remboursements'));

// ── Health check ──────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    succes: true,
    message: 'DiasporaLink API opérationnelle',
    version: '1.0.0',
    env: process.env.NODE_ENV,
  });
});

// ── 404 ───────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ succes: false, message: 'Route introuvable.' });
});

// ── Erreurs globales ──────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    succes: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Erreur serveur interne.'
      : err.message,
  });
});

// ── Démarrage ─────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 DiasporaLink API — port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;
