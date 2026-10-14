// ─────────────────────────────────────────────────────────────
//  Purge des données de test (une seule fois par jeton)
//
//  Déclenchée au démarrage par PURGE_COLIS_TEST=<jeton> (ex. 2026-10-14).
//  Supprime tous les colis (anciens DiasporaLink compris), leurs messages et
//  remboursements, les lots, mouvements de caisse, clôtures, opérations de
//  synchronisation et remet les numéros à zéro. Garde les comptes et les réglages.
//  Le jeton est noté en base : un redémarrage ne relance pas la purge.
// ─────────────────────────────────────────────────────────────
const mongoose = require('mongoose');

const COLLECTIONS = ['colis', 'messages', 'remboursements', 'lots', 'mouvements', 'clotures', 'operationsyncs', 'courses'];

async function purgerSiDemande() {
  const jeton = (process.env.PURGE_COLIS_TEST || '').trim();
  if (!jeton) return null;
  const db = mongoose.connection.db;
  const marque = `purge:${jeton}`;
  const compteurs = db.collection('compteurs');
  if (await compteurs.findOne({ _id: marque })) {
    console.log(`ℹ️  Purge « ${jeton} » déjà faite, rien à faire.`);
    return null;
  }
  const bilan = {};
  for (const nom of COLLECTIONS) {
    const r = await db.collection(nom).deleteMany({});
    bilan[nom] = r.deletedCount;
  }
  // Numéros de suivi, de lot et de course repartent de 1
  const r = await compteurs.deleteMany({ _id: { $not: /^purge:/ } });
  bilan.compteurs = r.deletedCount;
  await compteurs.insertOne({ _id: marque, seq: 0, faiteLe: new Date(), bilan });
  console.log(`🧹 Purge « ${jeton} » faite :`, JSON.stringify(bilan));
  return bilan;
}

module.exports = { purgerSiDemande, COLLECTIONS };
