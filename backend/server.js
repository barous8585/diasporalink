require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');

const app = express();

// ── Connexion BDD ──────────────────────────────────────────
connectDB();

// ── Middlewares globaux ────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ──────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives de connexion.' }
});
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ── Routes ─────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/pickups',       require('./routes/pickups'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/tracking',      require('./routes/tracking'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/users',         require('./routes/users'));

// ── Health check ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', env: process.env.NODE_ENV });
});

// ── Webhook Stripe (avant express.json !) ──────────────────
app.post('/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  require('./routes/payments').webhook
);

// ── 404 ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// ── Gestionnaire d'erreurs global ──────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erreur serveur interne'
      : err.message
  });
});

// ── Démarrage ──────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 DiasporaLink API démarrée sur le port ${PORT} [${process.env.NODE_ENV}]`);
});

module.exports = app;
