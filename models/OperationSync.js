const mongoose = require('mongoose');

// Journal des opérations envoyées par l'app agent (scans, remises).
// L'app renvoie la même opération tant qu'elle n'a pas reçu de réponse :
// si l'opId existe déjà, on renvoie le résultat enregistré sans rien refaire.
const operationSchema = new mongoose.Schema({
  opId:     { type: String, required: true, unique: true },
  agent:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type:     { type: String },
  resultat: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

module.exports = mongoose.model('OperationSync', operationSchema);
