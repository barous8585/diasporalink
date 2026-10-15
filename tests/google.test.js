// Connexion avec Google : la vérification du jeton par Google est simulée,
// tout le reste (comptes, liaison, sécurité) passe par le vrai code et une vraie base.
// MONGODB_URI=mongodb://127.0.0.1:27017/kolis_google node --test tests/google.test.js
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const mongoose = require('mongoose');

process.env.GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-de-test-assez-long-pour-les-tests-1234';
// Faux Google : le « jeton » est un JSON { sub, email } ; « faux » = refusé
const charger = Module._load;
Module._load = function (demande, ...reste) {
  if (demande === 'google-auth-library') {
    return { OAuth2Client: class { async verifyIdToken({ idToken, audience }) {
      if (audience !== process.env.GOOGLE_CLIENT_ID || idToken.startsWith('faux')) throw new Error('jeton invalide');
      const p = JSON.parse(idToken); return { getPayload: () => ({ email_verified: true, given_name: 'Awa', family_name: 'Barry', ...p }) };
    } } };
  }
  return charger.call(this, demande, ...reste);
};
const { googleCtrl, lierGoogleCtrl } = require('../controllers/authController');
const User = require('../models/User');

const appel = async (ctrl, body, user) => {
  const res = { statusCode: 200, corps: null, status(c) { this.statusCode = c; return this; }, json(o) { this.corps = o; return this; } };
  try { await ctrl({ body, user }, res); } catch (e) { res.statusCode = e.status || 500; res.corps = { message: e.message }; }
  return res;
};
const jeton = (o) => JSON.stringify({ sub: 'g-1', email: 'awa@gmail.com', ...o }).padEnd(30, ' ');

test('connexion avec Google', async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kolis_google');
  await mongoose.connection.db.dropDatabase();
  await User.syncIndexes();

  // Jeton refusé par Google
  assert.strictEqual((await appel(googleCtrl, { credential: 'faux-jeton-xxxxxxxxxxxxxxxx' })).statusCode, 401);

  // Première fois : le téléphone est demandé, prénom/nom pré-remplis
  let r = await appel(googleCtrl, { credential: jeton() });
  assert.strictEqual(r.corps.besoinTelephone, true);
  assert.strictEqual(r.corps.profil.prenom, 'Awa');

  // Numéro libre : compte créé, non vérifié, relié à Google
  r = await appel(googleCtrl, { credential: jeton(), telephone: '0611223344', prenom: 'Awa', nom: 'Barry' });
  assert.strictEqual(r.statusCode, 201, r.corps.message);
  assert.ok(r.corps.token);
  const u = await User.findOne({ telephone: '+33611223344' });
  assert.strictEqual(u.googleId, 'g-1');
  assert.strictEqual(u.verifie, false);
  assert.strictEqual(r.corps.utilisateur.toJSON ? r.corps.utilisateur.toJSON().googleId : undefined, undefined);

  // Fois suivantes : connexion directe
  r = await appel(googleCtrl, { credential: jeton() });
  assert.ok(r.corps.token && !r.corps.besoinTelephone);

  // Numéro qui a déjà un compte : mot de passe exigé pour relier Google
  const existant = new User({ telephone: '+224622000111', prenom: 'Mamadou', nom: 'Diallo', role: 'client' });
  await existant.definirMotDePasse('motdepasse123'); await existant.save();
  const autre = jeton({ sub: 'g-2', email: 'mamadou@gmail.com' });
  r = await appel(googleCtrl, { credential: autre, telephone: '622000111', prenom: 'X', nom: 'Y' });
  assert.strictEqual(r.statusCode, 409);
  assert.strictEqual(r.corps.code, 'compte_existant');
  r = await appel(googleCtrl, { credential: autre, telephone: '622000111', motDePasse: 'mauvais-mdp' });
  assert.strictEqual(r.statusCode, 401);
  r = await appel(googleCtrl, { credential: autre, telephone: '622000111', motDePasse: 'motdepasse123' });
  assert.strictEqual(r.statusCode, 200, r.corps.message);
  assert.strictEqual((await User.findOne({ telephone: '+224622000111' })).googleId, 'g-2');

  // Un compte de l'équipe ne peut pas être pris par Google
  const agent = new User({ telephone: '+224620000999', prenom: 'Agent', nom: 'Z', role: 'agent', lieu: 'KALOUM' });
  await agent.definirMotDePasse('motdepasse123'); await agent.save();
  r = await appel(googleCtrl, { credential: jeton({ sub: 'g-3', email: 'x@gmail.com' }), telephone: '620000999', motDePasse: 'motdepasse123' });
  assert.strictEqual(r.statusCode, 403);

  // Relier depuis « Mon compte » ; un compte Google ne peut servir qu'à un seul compte
  const sansGoogle = new User({ telephone: '+33699887766', prenom: 'Sira', nom: 'Bah', role: 'client' });
  await sansGoogle.save();
  r = await appel(lierGoogleCtrl, { credential: jeton() }, sansGoogle);
  assert.strictEqual(r.statusCode, 409, 'g-1 est déjà relié à Awa');
  r = await appel(lierGoogleCtrl, { credential: jeton({ sub: 'g-4', email: 'sira@gmail.com' }) }, sansGoogle);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(sansGoogle.email, 'sira@gmail.com');

  await mongoose.disconnect();
});
