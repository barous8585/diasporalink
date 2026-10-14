// ─────────────────────────────────────────────────────────────
//  Notifications push (Web Push, comme sur Glow) : gratuites, sans fournisseur.
//  Les clés VAPID identifient notre serveur (variables VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
//  Sans clés, rien n'est envoyé et rien ne casse.
// ─────────────────────────────────────────────────────────────
const webpush = require('web-push');
const PushAbonnement = require('../models/PushAbonnement');
const { APP_NOM_COURT } = require('../config/constants');

const PUBLIQUE = process.env.VAPID_PUBLIC_KEY || '';
const PRIVEE = process.env.VAPID_PRIVATE_KEY || '';
const actif = () => !!(PUBLIQUE && PRIVEE);
if (actif()) webpush.setVapidDetails(process.env.VAPID_SUJET || 'mailto:contact@talibmultiservices.fr', PUBLIQUE, PRIVEE);

const URLS = {
  client: () => process.env.FRONTEND_URL || '',
  agent: () => process.env.AGENT_URL || '',
  admin: () => process.env.ADMIN_URL || '',
};

async function envoyer(abonnements, { titre = APP_NOM_COURT, corps, chemin = '/', etiquette } = {}) {
  if (!actif() || !abonnements.length) return 0;
  let ok = 0;
  await Promise.all(abonnements.map(async (a) => {
    const url = `${URLS[a.app]?.() || ''}${chemin}`;
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: a.cles }, JSON.stringify({ titre, corps, url, etiquette }), { TTL: 24 * 3600 });
      ok++;
      if (a.echecs) await PushAbonnement.updateOne({ _id: a._id }, { echecs: 0 });
    } catch (e) {
      // 404 / 410 : l'abonnement n'existe plus (appli désinstallée, notifications coupées)
      if (e.statusCode === 404 || e.statusCode === 410) await PushAbonnement.deleteOne({ _id: a._id });
      else await PushAbonnement.updateOne({ _id: a._id }, { $inc: { echecs: 1 } });
    }
  }));
  return ok;
}

// Clients : tous les appareils liés à ce numéro de téléphone
async function auTelephone(telephone, message) {
  if (!actif() || !telephone) return 0;
  return envoyer(await PushAbonnement.find({ app: 'client', telephone }).lean(), message);
}
// Agents (et livreurs si demandé) d'une agence
async function aLAgence(lieu, message, { roles = ['agent'] } = {}) {
  if (!actif() || !lieu) return 0;
  return envoyer(await PushAbonnement.find({ app: 'agent', lieu, role: { $in: roles } }).lean(), message);
}
// Agents de toutes les agences d'un pays
async function auxAgencesDuPays(pays, message) {
  if (!actif()) return 0;
  const Config = require('../models/Config');
  const lieux = ((await Config.get()).agences || []).filter(a => a.pays === pays).map(a => a.code);
  return envoyer(await PushAbonnement.find({ app: 'agent', role: 'agent', lieu: { $in: lieux } }).lean(), message);
}
async function auxAdmins(message) {
  if (!actif()) return 0;
  return envoyer(await PushAbonnement.find({ app: 'admin' }).lean(), message);
}
async function aLUtilisateur(userId, message) {
  if (!actif()) return 0;
  return envoyer(await PushAbonnement.find({ user: userId }).lean(), message);
}

// Lancer sans attendre ni faire échouer l'opération en cours
const sansAttendre = (p) => { Promise.resolve(p).catch(e => console.error('[push]', e.message)); };

module.exports = { actif, PUBLIQUE, envoyer, auTelephone, aLAgence, auxAgencesDuPays, auxAdmins, aLUtilisateur, sansAttendre };
