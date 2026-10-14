// ─────────────────────────────────────────────────────────────
//  Notifications : SMS (Twilio) + WhatsApp (à brancher en v2)
//  En développement, tout est affiché dans la console.
// ─────────────────────────────────────────────────────────────
const { APP_NOM_COURT: APP_NOM } = require('../config/constants'); // nom court : SMS ≤ 160 caractères

let twilioClient = null;
const getTwilio = () => {
  if (!twilioClient && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
};

const envoyerSMS = async (to, body) => {
  if (!to) return false;
  if (process.env.NODE_ENV !== 'production' || !getTwilio()) {
    console.log(`📱 [SMS] → ${to} : ${body}`);
    return true;
  }
  try {
    await getTwilio().messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to });
    return true;
  } catch (err) {
    console.error('Erreur SMS :', err.message);
    return false;
  }
};

// WhatsApp : brancher ici la WhatsApp Business Cloud API (Meta) en v2.
const envoyerWhatsApp = async (to, body) => {
  if (!to) return false;
  console.log(`💬 [WhatsApp — non branché] → ${to} : ${body}`);
  return false;
};

const notifier = async (to, body) => {
  const ok = await envoyerWhatsApp(to, body);
  if (!ok) return envoyerSMS(to, body);
  return true;
};

const urlSuivi = (numero) => `${process.env.FRONTEND_URL || ''}/?suivi=${encodeURIComponent(numero)}`;

const envoyerOTP = (telephone, code) =>
  envoyerSMS(telephone, `${APP_NOM} : votre code de connexion est ${code}. Valable 10 minutes. Ne le partagez pas.`);

const MESSAGES = {
  depose: (c) => `${APP_NOM} : colis ${c.numeroSuivi} bien reçu au dépôt (${c.poidsReel} kg). Suivi : ${urlSuivi(c.numeroSuivi)}`,
  en_transit: (c, pays = 'destination') => `${APP_NOM} : votre colis ${c.numeroSuivi} est parti, direction ${pays}. Suivi : ${urlSuivi(c.numeroSuivi)}`,
  arrive: (c, pays = '') => `${APP_NOM} : le colis ${c.numeroSuivi} est arrivé${pays ? ` en ${pays}` : ''}. Nous vous prévenons dès qu'il est à votre agence.`,
  acheminement: (c, agence) => `${APP_NOM} : le colis ${c.numeroSuivi} est en route vers ${agence}. Vous recevrez le code de retrait à son arrivée.`,
  // reste : texte déjà formaté dans la devise du pays (« 45 000 GNF » ou « 12,50 € »), ou vide
  pret: (c, code, agence, reste) =>
    `${APP_NOM} : le colis ${c.numeroSuivi} vous attend à ${agence}. Code de retrait : ${code}. ` +
    (reste ? `Reste à payer : ${reste}. ` : '') +
    `Venez avec une pièce d'identité.`,
  remis: (c) => `${APP_NOM} : le colis ${c.numeroSuivi} a été remis. Merci de votre confiance !`,
  tiers: (c, nom) => `${APP_NOM} : ${nom} est autorisé(e) à retirer le colis ${c.numeroSuivi}.`,
  relance: (c, guichet, jours) =>
    `${APP_NOM} : le colis ${c.numeroSuivi} vous attend à ${guichet} depuis ${jours} jours. Des frais de garde s'appliquent.`,
};

module.exports = { envoyerSMS, envoyerWhatsApp, notifier, envoyerOTP, MESSAGES, urlSuivi };
