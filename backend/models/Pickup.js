const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  label:     { type: String, required: true },
  detail:    { type: String },
  status:    { type: String, enum: ['done', 'active', 'todo'], default: 'todo' },
  completedAt: { type: Date }
}, { _id: false });

const pickupSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trackingId: { type: String, unique: true },

  // Collecte
  pickupAddress:  { type: String, required: true },
  pickupCity:     { type: String, required: true },
  pickupDate:     { type: Date, required: true },
  pickupSlot:     { type: String, enum: ['morning', 'afternoon', 'evening'], required: true },

  // Destination
  destinationCountry: { type: String, required: true },
  destinationCity:    { type: String, required: true },
  recipientName:      { type: String, required: true },
  recipientPhone:     { type: String, required: true },

  // Colis
  packageType:   { type: String, required: true },
  weightKg:      { type: Number, required: true, min: 0.1 },
  declaredValue: { type: Number, default: 0 },

  // Tarifs
  pricing: {
    pickupFee:   { type: Number, required: true },
    transport:   { type: Number, required: true },
    insurance:   { type: Number, default: 0 },
    total:       { type: Number, required: true }
  },

  // Statut
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'picked_up', 'in_transit', 'arrived', 'delivered', 'cancelled'],
    default: 'pending'
  },
  steps: [stepSchema],

  // Livreur
  carrier: {
    name:  String,
    phone: String,
    id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },

  // Paiement
  paymentId:     { type: String },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' }

}, {
  timestamps: true,
  toJSON: { virtuals: true, transform: (_, obj) => { delete obj.__v; return obj; } }
});

// Génère l'identifiant de tracking DL-XXXX
pickupSchema.pre('save', async function (next) {
  if (!this.trackingId) {
    const count = await mongoose.model('Pickup').countDocuments();
    this.trackingId = `DL-${String(count + 1000).padStart(4, '0')}`;
  }
  next();
});

// Statut lisible
pickupSchema.virtual('statusLabel').get(function () {
  const labels = {
    pending:    'En attente',
    confirmed:  'Confirmé',
    picked_up:  'Pick-up effectué',
    in_transit: 'En transit',
    arrived:    'Arrivé',
    delivered:  'Livré',
    cancelled:  'Annulé'
  };
  return labels[this.status] || this.status;
});

module.exports = mongoose.model('Pickup', pickupSchema);
