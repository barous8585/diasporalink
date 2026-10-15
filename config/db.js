const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Filtres : les champs inconnus du modèle sont ignorés (défense contre les requêtes forgées)
    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`✅ MongoDB connecté : ${conn.connection.host}`);
    try {
      await require('../scripts/purge-test').purgerSiDemande();
    } catch (e) {
      console.error('❌ Purge des données de test :', e.message);
    }
    require('../scripts/retention').planifierRetention();
  } catch (err) {
    console.error('❌ Erreur MongoDB :', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
