const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`✅ MongoDB connecté : ${conn.connection.host}`);
    try {
      await require('../scripts/purge-test').purgerSiDemande();
    } catch (e) {
      console.error('❌ Purge des données de test :', e.message);
    }
  } catch (err) {
    console.error('❌ Erreur MongoDB :', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
