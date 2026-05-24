const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  pickup:   { type: mongoose.Schema.Types.ObjectId, ref: 'Pickup', required: true },
  from:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fromRole: { type: String, enum: ['user', 'carrier', 'system'], required: true },
  text:     { type: String, required: true, maxlength: 1000 },
  readAt:   { type: Date }
}, {
  timestamps: true,
  toJSON: { transform: (_, obj) => { delete obj.__v; return obj; } }
});

module.exports = mongoose.model('Message', messageSchema);
