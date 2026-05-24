const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: 'diasporalink'
    });
    console.log(`✅ MongoDB connecté : ${conn.connection.host}`);
  } catch (err) {
    console.error('❌ Erreur connexion MongoDB :', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
