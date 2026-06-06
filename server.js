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

// ── Trust proxy (Render est derrière un proxy) ─
app.set('trust proxy', 1);

// ── Socket.io ─────────────────────────────
const io = new Server(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      process.env.ADMIN_URL || 'http://localhost:3001',
    ],
    credentials: true,
  },
});
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
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    process.env.ADMIN_URL || 'http://localhost:3001',
  ],
  credentials: true,
}));
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
  max: 10,
  message: { succes: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ── Routes ────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/colis',         require('./routes/colis'));
app.use('/api/paiements',     require('./routes/paiements'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/utilisateurs',  require('./routes/utilisateurs'));
app.use('/api/config',        require('./routes/config'));

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
