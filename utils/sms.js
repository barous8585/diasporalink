const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Envoyer un SMS
 * @param {string} to - Numéro destinataire
 * @param {string} body - Contenu du SMS
 */
const envoyerSMS = async (to, body) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📱 [SMS DEV] → ${to} : ${body}`);
    return true;
  }

  try {
    await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
    return true;
  } catch (err) {
    console.error('Erreur SMS Twilio :', err.message);
    return false;
  }
};

/**
 * Envoyer un OTP par SMS
 */
const envoyerOTP = async (telephone, code) => {
  const message = `Votre code DiasporaLink : ${code}\nValable 10 minutes. Ne le partagez pas.`;
  return envoyerSMS(telephone, message);
};

/**
 * Notifier le client d'un changement de statut
 */
const notifierStatut = async (telephone, numeroSuivi, statutLabel) => {
  const message = `DiasporaLink — Colis #${numeroSuivi} : ${statutLabel}. Suivez votre colis sur diasporalinkafrique.netlify.app`;
  return envoyerSMS(telephone, message);
};

module.exports = { envoyerSMS, envoyerOTP, notifierStatut };
