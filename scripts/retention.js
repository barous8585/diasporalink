// ─────────────────────────────────────────────────────────────
//  Durées de conservation (politique de confidentialité)
//  • photos de dépôt, signatures, positions GPS des livreurs : 1 an après la remise
//  • colis et réclamations : 3 ans après la remise (les factures, elles, restent 10 ans)
//  Tourne au démarrage puis chaque jour. Jamais pendant une réclamation en cours.
// ─────────────────────────────────────────────────────────────
const Colis = require('../models/Colis');
const Photo = require('../models/Photo');
const Reclamation = require('../models/Reclamation');

const JOUR = 86400000;

async function appliquerRetention(maintenant = new Date()) {
  const unAn = new Date(maintenant - 365 * JOUR);
  const troisAns = new Date(maintenant - 3 * 365 * JOUR);
  const enCours = new Set((await Reclamation.find({ statut: { $in: ['ouverte', 'en_cours'] } }).distinct('colis')).map(String));
  const bilan = { photos: 0, colisAllégés: 0, colisSupprimés: 0 };

  const anciens = await Colis.find({ statut: 'remis', 'remise.le': { $lt: unAn } }).select('_id photoDepot remise ramassage livraison');
  for (const c of anciens) {
    if (enCours.has(String(c._id))) continue;
    if (!c.photoDepot && !c.remise?.signature && !c.ramassage?.positionLivreur && !c.livraison?.positionLivreur) continue;
    const r = await Photo.deleteMany({ colis: c._id });
    bilan.photos += r.deletedCount;
    await Colis.updateOne({ _id: c._id }, { $unset: { photoDepot: 1, 'remise.signature': 1, 'ramassage.positionLivreur': 1, 'livraison.positionLivreur': 1, 'ramassage.adresse.position': 1, 'livraison.adresse.position': 1 } });
    bilan.colisAllégés++;
  }

  const tresAnciens = await Colis.find({ statut: { $in: ['remis', 'annule'] }, updatedAt: { $lt: troisAns } }).select('_id');
  for (const c of tresAnciens) {
    if (enCours.has(String(c._id))) continue;
    await Photo.deleteMany({ colis: c._id });
    await Reclamation.deleteMany({ colis: c._id });
    await Colis.deleteOne({ _id: c._id });
    bilan.colisSupprimés++;
  }
  if (bilan.photos || bilan.colisAllégés || bilan.colisSupprimés) console.log('🗄️  Conservation :', JSON.stringify(bilan));
  return bilan;
}

function planifierRetention() {
  const lancer = () => appliquerRetention().catch(e => console.error('[conservation]', e.message));
  setTimeout(lancer, 60 * 1000);
  setInterval(lancer, JOUR).unref();
}

module.exports = { appliquerRetention, planifierRetention };
