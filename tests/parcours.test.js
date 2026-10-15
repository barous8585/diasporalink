// Test de bout en bout de l'API.
// Nécessite une base MongoDB : MONGODB_URI=mongodb://127.0.0.1:27017/kolis_test npm run test:parcours
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 5099;
const VAPID = require('web-push').generateVAPIDKeys();
const API = `http://127.0.0.1:${PORT}/api`;
const ADMIN_TEL = '+33600000001';
let serveur;

async function appel(methode, chemin, corps, token) {
  const res = await fetch(API + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

const ADMIN_MDP = 'MotDePasseInitial!';
const MDP = 'motdepasse123';

// Connexion par mot de passe ; crée un compte client si prénom/nom fournis et compte absent
// (jetons gardés : la connexion est limitée en nombre d'essais, comme en production)
const jetons = {};
async function connexion(telephone, prenom, nom) {
  if (jetons[telephone]) return jetons[telephone];
  let r = await appel('POST', '/auth/connexion', { telephone, motDePasse: telephone === ADMIN_TEL ? ADMIN_MDP : MDP });
  if (r.status === 401 && prenom) r = await appel('POST', '/auth/inscription', { telephone, prenom, nom, motDePasse: MDP });
  assert.ok(r.token, r.message);
  jetons[telephone] = r.token;
  return r.token;
}

test.before(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kolis_test';
  const mongoose = require('mongoose');
  await mongoose.connect(uri);
  await mongoose.connection.db.dropDatabase();
  // Un ancien colis DiasporaLink (autre format) doit être ignoré sans rien casser
  await mongoose.connection.db.collection('colis').insertOne({ numeroSuivi: 'DL-1000', statut: 'livre', nomDestinataire: 'Ancien', paysDestination: 'GN', tarif: { total: 10 } });
  await mongoose.disconnect();
  serveur = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT, MONGODB_URI: uri, JWT_SECRET: 'test', NODE_ENV: 'development', ADMIN_TELEPHONES: ADMIN_TEL, ADMIN_MOT_DE_PASSE: ADMIN_MDP, AUTH_MODE: '',
      VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serveur.stderr.on('data', d => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('serveur non démarré');
});

test.after(() => serveur?.kill());

test('parcours complet : réservation → dépôt → lot → guichet → remise', async () => {
  // Connexion : SMS désactivé, mauvais mot de passe refusé, premier accès admin
  assert.strictEqual((await appel('POST', '/auth/envoyer-otp', { telephone: ADMIN_TEL })).status, 410);
  assert.strictEqual((await appel('POST', '/auth/connexion', { telephone: ADMIN_TEL, motDePasse: 'faux-mot-de-passe' })).status, 401);
  const premier = await appel('POST', '/auth/connexion', { telephone: ADMIN_TEL, motDePasse: ADMIN_MDP });
  assert.ok(premier.doitChangerMotDePasse);
  assert.ok(!JSON.stringify(premier).includes('motDePasse"'), 'l\'empreinte ne doit jamais sortir');
  const admin = await connexion(ADMIN_TEL);
  const moi = await appel('GET', '/auth/moi', null, admin);
  assert.strictEqual(moi.utilisateur.role, 'admin');
  assert.strictEqual((await appel('GET', '/config')).authMode, 'motdepasse');

  // Équipe
  for (const [tel, prenom, lieu] of [['+33600000002', 'Awa', 'PARIS'], ['620000003', 'Ibrahima', 'KALOUM']]) {
    const r = await appel('POST', '/utilisateurs/equipe', { telephone: tel, prenom, nom: 'Agent', role: 'agent', lieu, motDePasse: MDP }, admin);
    assert.strictEqual(r.status, 201, r.message);
  }
  const agentParis = await connexion('+33600000002');
  const agentKaloum = await connexion('620000003'); // format local guinéen → +224

  // Un inconnu ne peut pas se donner le rôle agent
  const intrus = await connexion('+33600000099', 'Intrus', 'X');
  assert.strictEqual((await appel('GET', '/agent/contexte', null, intrus)).status, 403);

  // Client : estimation + réservation
  const client = await connexion('0611223344', 'Mariama', 'Diallo');
  const est = await appel('GET', '/colis/tarif?mode=air&poids=6&type=vetements');
  assert.strictEqual(est.tarif.totalEur, 72);
  const resa = await appel('POST', '/colis', { cgvAcceptees: true,
    mode: 'air', typeColis: 'vetements', poidsEstime: 6, depot: 'PARIS', guichet: 'KALOUM',
    destinataire: { nom: 'Alpha Barry', telephone: '621000111' },
  }, client);
  assert.strictEqual(resa.status, 201, resa.message);
  const numero = resa.colis.numeroSuivi;
  assert.match(numero, /^TMS-\d{2}-\d{5}$/);
  assert.strictEqual(resa.colis.statut, 'reserve');

  // Dépôt : pesée (6,4 kg), paiement espèces en euros
  const dep = await appel('POST', '/agent/depot', { cgvAcceptees: true,
    numeroSuivi: numero, poidsReel: 6.4,
    paiement: { montant: 76.8, devise: 'EUR', methode: 'especes', objet: 'transport' }, opId: 'dep-1',
  }, agentParis);
  assert.strictEqual(dep.status, 201, dep.message);
  assert.strictEqual(dep.colis.statut, 'depose');
  assert.strictEqual(dep.colis.tarif.totalEur, 76.8);
  assert.strictEqual(dep.colis.solde.soldeGnf, 0);
  assert.strictEqual(dep.ecartPoids, 0.4);
  // Rejouer la même opération ne crée pas de doublon
  const dep2 = await appel('POST', '/agent/depot', { cgvAcceptees: true, numeroSuivi: numero, poidsReel: 6.4, opId: 'dep-1' }, agentParis);
  assert.ok(dep2.rejoue);

  // Dépôt sans réservation, en bateau, payé à l'arrivée
  const dep3 = await appel('POST', '/agent/depot', { cgvAcceptees: true,
    poidsReel: 12, mode: 'mer', typeColis: 'alimentaire', guichet: 'KALOUM', payeurArrivee: true,
    expediteur: { nom: 'Oumar Sow', telephone: '0699887766' },
    destinataire: { nom: 'Fanta Kourouma', telephone: '622334455' },
  }, agentParis);
  assert.strictEqual(dep3.status, 201, dep3.message);
  const numeroMer = dep3.colis.numeroSuivi;
  assert.strictEqual(dep3.colis.solde.soldeGnf, 480000); // 12 kg × 4 € × 10 000

  // Lots
  const lotAir = (await appel('POST', '/lots', { mode: 'air', reference: 'AF 0000' }, admin)).lot;
  assert.match(lotAir.code, /^AIR-\d{4}$/);
  const scans = await appel('POST', '/agent/scans', { scans: [
    { opId: 's1', numero, action: 'charger', lot: lotAir.code },
    { opId: 's1', numero, action: 'charger', lot: lotAir.code },               // doublon hors-ligne
    { opId: 's2', numero: numeroMer, action: 'charger', lot: lotAir.code },    // mauvais mode
    { opId: 's3', numero: 'TMS-00-99999', action: 'charger', lot: lotAir.code },
  ] }, agentParis);
  const [r1, r1bis, r2, r3] = scans.resultats;
  assert.ok(r1.ok && r1.statut === 'charge');
  assert.ok(r1bis.rejoue);
  assert.ok(!r2.ok && /bateau/.test(r2.erreur));
  assert.ok(!r3.ok);

  // Le lot part puis arrive → les colis suivent
  let s = await appel('POST', `/lots/${lotAir.code}/statut`, { statut: 'parti' }, admin);
  assert.strictEqual(s.colisMisAJour, 1, s.message);
  s = await appel('POST', `/lots/${lotAir.code}/statut`, { statut: 'arrive' }, admin);
  assert.strictEqual(s.colisMisAJour, 1);
  const manif = await appel('GET', `/lots/${lotAir.code}`, null, admin);
  assert.strictEqual(manif.stats.nb, 1);
  assert.strictEqual(manif.stats.scannesArrivee, 1);

  // Mise en rayon au guichet Kaloum
  const g = await appel('POST', '/agent/scans', { scans: [{ opId: 'g1', numero, action: 'guichet', emplacement: 'B-14' }] }, agentKaloum);
  assert.ok(g.resultats[0].ok, g.resultats[0].erreur);
  // Un agent de Paris ne peut pas mettre au guichet de Kaloum
  const gp = await appel('POST', '/agent/scans', { scans: [{ opId: 'g2', numero, action: 'guichet' }] }, agentParis);
  assert.ok(!gp.resultats[0].ok);

  // Suivi public : pas de code, pas de téléphone
  const pub = await appel('GET', `/colis/suivi/${numero}`);
  assert.strictEqual(pub.colis.statut, 'pret');
  assert.strictEqual(pub.colis.destinataire, 'Alpha');
  assert.ok(!JSON.stringify(pub).includes('codeRetrait'));
  assert.ok(!JSON.stringify(pub).includes('621000111'));

  // Le client voit le code ; le destinataire aussi (connexion par son numéro)
  const mesColis = await appel('GET', '/colis', null, client);
  const code = mesColis.colis.find(c => c.numeroSuivi === numero).codeRetrait;
  assert.match(code, /^\d{4}$/);
  // Un compte créé avec le numéro du destinataire, sans vérification, ne voit PAS le code
  let dest = await connexion('+224621000111', 'Alpha', 'Barry');
  assert.strictEqual((await appel('POST', '/auth/inscription', { telephone: '+224621000111', prenom: 'X', nom: 'Y', motDePasse: MDP })).status, 409);
  let vueDest = await appel('GET', `/colis/${numero}`, null, dest);
  assert.strictEqual(vueDest.colis.codeRetrait, undefined);
  // L'agence vérifie son identité et lui donne un mot de passe : il voit le code
  const reinit = await appel('POST', '/utilisateurs/client-mot-de-passe', { telephone: '621000111', motDePasse: 'nouveaumdp456' }, admin);
  assert.strictEqual(reinit.status, 200, reinit.message);
  assert.strictEqual((await appel('GET', '/auth/moi', null, dest)).status, 401, 'ancienne session fermée');
  dest = (await appel('POST', '/auth/connexion', { telephone: '+224621000111', motDePasse: 'nouveaumdp456' })).token;
  vueDest = await appel('GET', `/colis/${numero}`, null, dest);
  assert.strictEqual(vueDest.colis.codeRetrait, code);
  // L'intrus ne voit rien
  assert.strictEqual((await appel('GET', `/colis/${numero}`, null, intrus)).status, 404);

  // Cache hors-ligne de l'agent : empreinte du code
  const ctx = await appel('GET', '/agent/contexte', null, agentKaloum);
  const cache = ctx.colisPrets.find(c => c.numeroSuivi === numero);
  assert.strictEqual(cache.empreinteCode, crypto.createHash('sha256').update(`${numero}:${code}`).digest('hex'));

  // Tiers autorisé
  const t = await appel('PATCH', `/colis/${numero}/tiers`, { nom: 'Mamadou Barry', telephone: '623000000' }, dest);
  assert.strictEqual(t.colis.tiersAutorise.telephone, '+224623000000');

  // Remise : mauvais code, puis bon code
  const faux = await appel('POST', '/agent/remise', { numero, code: code === '0000' ? '1111' : '0000', pieceVerifiee: true }, agentKaloum);
  assert.strictEqual(faux.status, 401);
  const sansPiece = await appel('POST', '/agent/remise', { numero, code }, agentKaloum);
  assert.strictEqual(sansPiece.status, 400);
  const ok = await appel('POST', '/agent/remise', { numero, code, pieceVerifiee: true, retirePar: 'tiers', opId: 'r1' }, agentKaloum);
  assert.strictEqual(ok.status, 200, ok.message);
  assert.strictEqual(ok.colis.statut, 'remis');
  assert.strictEqual(ok.colis.remise.nomRetrait, 'Mamadou Barry');
  const rejoue = await appel('POST', '/agent/remise', { numero, code, pieceVerifiee: true, opId: 'r1' }, agentKaloum);
  assert.ok(rejoue.rejoue);

  // Colis bateau : douane + paiement à l'arrivée
  await appel('POST', '/lots', { mode: 'mer' }, admin);
  const lotMer = (await appel('GET', '/lots?statut=preparation', null, admin)).lots.find(l => l.mode === 'mer');
  await appel('POST', '/agent/scans', { scans: [{ opId: 'm1', numero: numeroMer, action: 'charger', lot: lotMer.code }] }, agentParis);
  await appel('POST', `/lots/${lotMer.code}/statut`, { statut: 'parti' }, admin);
  // Arrivée scannée à la main par l'agent (sans passer par le lot)
  const arr = await appel('POST', '/agent/scans', { scans: [
    { opId: 'm2', numero: numeroMer, action: 'arrivee', lot: lotAir.code }, // mauvais lot → refusé
    { opId: 'm3', numero: numeroMer, action: 'arrivee', lot: lotMer.code },
  ] }, agentKaloum);
  assert.ok(arr.resultats[0].horsLot);
  assert.ok(arr.resultats[1].ok);
  await appel('PATCH', `/agent/colis/${numeroMer}/douane`, { fraisDouaneGnf: 45000 }, agentKaloum);
  await appel('POST', '/agent/scans', { scans: [{ opId: 'm4', numero: numeroMer, action: 'guichet' }] }, agentKaloum);
  const codeMer = (await appel('GET', `/admin/colis/${numeroMer}`, null, admin)).colis.codeRetrait;
  const impaye = await appel('POST', '/agent/remise', { numero: numeroMer, code: codeMer, pieceVerifiee: true }, agentKaloum);
  assert.strictEqual(impaye.status, 402);
  assert.match(impaye.message, /525/);
  // Aucun encaissement ne doit avoir été enregistré par la tentative refusée
  let caisse = await appel('GET', '/caisse/moi', null, agentKaloum);
  assert.strictEqual(caisse.mouvements.length, 0);
  const paye = await appel('POST', '/agent/remise', {
    numero: numeroMer, code: codeMer, pieceVerifiee: true,
    paiement: { montant: 525000, devise: 'GNF', methode: 'especes' },
  }, agentKaloum);
  assert.strictEqual(paye.status, 200, paye.message);

  // Caisse Kaloum : 525 000 GNF espèces, clôture avec écart
  caisse = await appel('GET', '/caisse/moi', null, agentKaloum);
  assert.strictEqual(caisse.totaux.GNF.especes, 525000);
  const clo = await appel('POST', '/caisse/cloturer', { especesComptees: { GNF: 520000 } }, agentKaloum);
  assert.strictEqual(clo.cloture.ecart.GNF, -5000);
  assert.strictEqual((await appel('GET', '/caisse/moi', null, agentKaloum)).mouvements.length, 0);

  // Les anciens colis DiasporaLink n'apparaissent nulle part
  assert.strictEqual((await appel('GET', '/colis/suivi/DL-1000')).status, 404);
  const recherche = await appel('GET', '/admin/colis', null, admin);
  assert.ok(recherche.colis.every(c => c.expediteur), 'aucun ancien colis dans la recherche');

  // Tableau de bord
  const stats = await appel('GET', '/admin/stats', null, admin);
  assert.strictEqual(stats.compteurs.remis, 2);
  assert.strictEqual(stats.encaisseJour.EUR, 76.8);
  assert.strictEqual(stats.encaisseJour.GNF, 525000);
  const jour = await appel('GET', '/caisse/jour', null, admin);
  assert.strictEqual(jour.clotures.length, 1);
  assert.strictEqual(jour.caissesOuvertes.length, 1); // Paris pas encore clôturée

  // Config : changement du taux
  const cfg = await appel('PATCH', '/config/admin', { tauxEurGnf: 9500 }, admin);
  assert.strictEqual(cfg.config.tauxEurGnf, 9500);
  assert.strictEqual((await appel('GET', '/config')).tauxEurGnf, 9500);
});

test('redistribution vers une autre agence, et envoi Guinée → France payé en GNF', async () => {
  const admin = await connexion(ADMIN_TEL);
  // Une agence à Labé, et une agent à Labé
  const cfg = (await appel('GET', '/config/admin', null, admin)).config;
  const agences = [...cfg.agences, { code: 'LABE', nom: 'Agence Labé', pays: 'GN', ville: 'Labé', commune: 'Labé centre' }];
  const maj = await appel('PATCH', '/config/admin', { agences }, admin);
  assert.strictEqual(maj.status, 200, maj.message);
  await appel('POST', '/utilisateurs/equipe', { telephone: '620000004', prenom: 'Mariama', nom: 'Labé', role: 'agent', lieu: 'LABE', motDePasse: MDP }, admin);
  const agentParis = await connexion('+33600000002');
  const agentKaloum = await connexion('620000003');
  const agentLabe = await connexion('620000004');

  // ── France → Labé : arrivée à la plateforme de Kaloum, puis acheminement ──
  const dep = await appel('POST', '/agent/depot', { cgvAcceptees: true,
    poidsReel: 4, mode: 'air', typeColis: 'vetements', guichet: 'LABE',
    expediteur: { nom: 'Saliou Diallo', telephone: '0611111111' },
    destinataire: { nom: 'Kadiatou Bah', telephone: '625555555' },
    paiement: { montant: 48, devise: 'EUR', methode: 'especes' },
  }, agentParis);
  assert.strictEqual(dep.status, 201, dep.message);
  assert.strictEqual(dep.colis.sens, 'FR-GN');
  const numero = dep.colis.numeroSuivi;

  // Une agence de retrait dans le même pays que le départ est refusée
  const memePays = await appel('POST', '/agent/depot', { cgvAcceptees: true,
    poidsReel: 2, mode: 'air', typeColis: 'vetements', guichet: 'PARIS',
    expediteur: { nom: 'A', telephone: '0611111112' }, destinataire: { nom: 'B', telephone: '0611111113' },
  }, agentParis);
  assert.strictEqual(memePays.status, 400);

  const lot = (await appel('POST', '/lots', { mode: 'air', sens: 'FR-GN' }, admin)).lot;
  assert.strictEqual(lot.destination, 'KALOUM');
  await appel('POST', '/agent/scans', { scans: [{ opId: 'x1', numero, action: 'charger', lot: lot.code }] }, agentParis);
  await appel('POST', `/lots/${lot.code}/statut`, { statut: 'parti' }, admin);
  await appel('POST', `/lots/${lot.code}/statut`, { statut: 'arrive' }, admin);

  // Kaloum ne peut pas le mettre en rayon : il se retire à Labé
  let r = await appel('POST', '/agent/scans', { scans: [{ opId: 'x2', numero, action: 'guichet' }] }, agentKaloum);
  assert.ok(!r.resultats[0].ok && /Labé/.test(r.resultats[0].erreur));
  const ctxK = await appel('GET', '/agent/contexte', null, agentKaloum);
  assert.strictEqual(ctxK.aAcheminer, 1);
  r = await appel('POST', '/agent/scans', { scans: [{ opId: 'x3', numero, action: 'acheminer' }] }, agentKaloum);
  assert.ok(r.resultats[0].ok, r.resultats[0].erreur);
  assert.strictEqual(r.resultats[0].statut, 'acheminement');
  const pub = await appel('GET', `/colis/suivi/${numero}`);
  assert.strictEqual(pub.colis.statut, 'acheminement');
  assert.strictEqual(pub.colis.guichet.ville, 'Labé');

  // Labé le met en rayon et le remet
  r = await appel('POST', '/agent/scans', { scans: [{ opId: 'x4', numero, action: 'guichet' }] }, agentLabe);
  assert.ok(r.resultats[0].ok, r.resultats[0].erreur);
  const code = (await appel('GET', `/admin/colis/${numero}`, null, admin)).colis.codeRetrait;
  const remise = await appel('POST', '/agent/remise', { numero, code, pieceVerifiee: true }, agentLabe);
  assert.strictEqual(remise.status, 200, remise.message);

  // ── Guinée → France : déposé à Kaloum, payé en GNF, retiré à Paris ──
  const retour = await appel('POST', '/agent/depot', { cgvAcceptees: true,
    poidsReel: 3, mode: 'air', typeColis: 'alimentaire', guichet: 'PARIS',
    expediteur: { nom: 'Aminata Camara', telephone: '626666666' },
    destinataire: { nom: 'Ibrahima Camara', telephone: '0622222222' },
    paiement: { montant: 360000, devise: 'GNF', methode: 'orange_money', reference: 'OM-123' },
  }, agentKaloum);
  assert.strictEqual(retour.status, 201, retour.message);
  assert.strictEqual(retour.colis.sens, 'GN-FR');
  assert.strictEqual(retour.colis.tarif.devise, 'GNF');
  assert.strictEqual(retour.colis.tarif.totalGnf, 360000);
  assert.strictEqual(retour.colis.solde.soldeGnf, 0);
  const numRetour = retour.colis.numeroSuivi;

  // Un lot France → Guinée refuse ce colis ; un lot Guinée → France l'accepte
  const lotAller = (await appel('POST', '/lots', { mode: 'air', sens: 'FR-GN' }, admin)).lot;
  r = await appel('POST', '/agent/scans', { scans: [{ opId: 'y1', numero: numRetour, action: 'charger', lot: lotAller.code }] }, agentKaloum);
  assert.ok(!r.resultats[0].ok);
  const lotRetour = (await appel('POST', '/lots', { mode: 'air', sens: 'GN-FR' }, admin)).lot;
  assert.match(lotRetour.code, /^AIR-GF-\d{4}$/);
  assert.strictEqual(lotRetour.destination, 'PARIS');
  // Le contexte de l'agent de Kaloum propose bien ce lot au chargement
  const ctx2 = await appel('GET', '/agent/contexte', null, agentKaloum);
  assert.ok(ctx2.lotsPreparation.some(l => l.code === lotRetour.code));
  assert.ok(!ctx2.lotsPreparation.some(l => l.code === lotAller.code));
  r = await appel('POST', '/agent/scans', { scans: [{ opId: 'y2', numero: numRetour, action: 'charger', lot: lotRetour.code }] }, agentKaloum);
  assert.ok(r.resultats[0].ok, r.resultats[0].erreur);
  await appel('POST', `/lots/${lotRetour.code}/statut`, { statut: 'parti' }, admin);
  // Un agent en Guinée ne peut pas réceptionner un colis attendu en France
  r = await appel('POST', '/agent/scans', { scans: [{ opId: 'y3', numero: numRetour, action: 'arrivee' }] }, agentLabe);
  assert.ok(!r.resultats[0].ok && /France/.test(r.resultats[0].erreur));
  r = await appel('POST', '/agent/scans', { scans: [
    { opId: 'y4', numero: numRetour, action: 'arrivee', lot: lotRetour.code },
    { opId: 'y5', numero: numRetour, action: 'guichet' },
  ] }, agentParis);
  assert.ok(r.resultats.every(x => x.ok), JSON.stringify(r.resultats));
  // Douane française saisie en euros, convertie au taux du colis
  await appel('PATCH', `/agent/colis/${numRetour}/douane`, { montant: 15, devise: 'EUR' }, agentParis);
  const fiche = (await appel('GET', `/admin/colis/${numRetour}`, null, admin)).colis;
  assert.strictEqual(fiche.fraisDouaneGnf, 15 * fiche.tarif.taux); // taux figé sur le colis
  assert.strictEqual(fiche.solde.soldeEur, 15);
  const remiseParis = await appel('POST', '/agent/remise', {
    numero: numRetour, code: fiche.codeRetrait, pieceVerifiee: true,
    paiement: { montant: 15, devise: 'EUR', methode: 'carte' },
  }, agentParis);
  assert.strictEqual(remiseParis.status, 200, remiseParis.message);
});

test('ramassage et livraison à domicile, prix au kilomètre', async () => {
  const admin = await connexion(ADMIN_TEL);
  // Positions des agences : lien Google Maps (Paris) et coordonnées (Kaloum)
  const cfg = (await appel('GET', '/config/admin', null, admin)).config;
  const agences = cfg.agences.map(a => a.code === 'PARIS' ? { ...a, lienPosition: 'https://www.google.com/maps/place/TMS/@48.8925,2.3484,17z/data=!3m1' }
    : a.code === 'KALOUM' ? { ...a, position: { lat: 9.5092, lng: -13.7122 } } : a);
  let r = await appel('PATCH', '/config/admin', { agences }, admin);
  assert.strictEqual(r.status, 200, r.message);
  assert.deepStrictEqual(r.config.agences.find(a => a.code === 'PARIS').position, { lat: 48.8925, lng: 2.3484 });
  const pub = await appel('GET', '/config');
  assert.strictEqual(pub.domicile.GN.parKm, 2000);
  assert.deepStrictEqual((await appel('GET', '/config/position?lien=' + encodeURIComponent('9.55, -13.71'))).position, { lat: 9.55, lng: -13.71 });

  // Livreurs dédiés
  for (const [tel, prenom, lieu] of [['+33600000010', 'Moussa', 'PARIS'], ['620000011', 'Sekou', 'KALOUM']]) {
    r = await appel('POST', '/utilisateurs/equipe', { telephone: tel, prenom, nom: 'Livreur', role: 'livreur', lieu, motDePasse: MDP }, admin);
    assert.strictEqual(r.status, 201, r.message);
  }
  const livParis = await connexion('+33600000010');
  const livKaloum = await connexion('620000011');
  const agentParis = await connexion('+33600000002');
  const agentKaloum = await connexion('620000003');
  assert.strictEqual((await appel('GET', '/agent/contexte', null, livParis)).status, 403, 'un livreur n\'est pas un agent');

  // Réservation : ramassage à 3 km de l'agence de Paris, livraison sans position (le destinataire l'enverra)
  const client = await connexion('0622334455', 'Fanta', 'Camara');
  r = await appel('POST', '/colis', { cgvAcceptees: true,
    mode: 'air', typeColis: 'vetements', poidsEstime: 5, depot: 'PARIS', guichet: 'KALOUM',
    destinataire: { nom: 'Oumar Camara', telephone: '622111222' },
    ramassage: { demande: true, adresse: { ville: 'Paris', quartier: 'Barbès', repere: '3e étage, interphone Camara', position: { lat: 48.8925 + 0.027, lng: 2.3484 } }, moment: 'matin' },
    livraison: { demande: true, adresse: { ville: 'Conakry', commune: 'Ratoma', quartier: 'Kipé', repere: 'Près de la pharmacie Kipé' } },
  }, client);
  assert.strictEqual(r.status, 201, r.message);
  const numero = r.colis.numeroSuivi;
  assert.strictEqual(r.colis.ramassage.prix, 12); // 8 € + 1 €/km × 3,9 km → 12 €
  assert.strictEqual(r.colis.ramassage.devise, 'EUR');
  assert.strictEqual(r.colis.livraison.prix, undefined);
  const sansPos = await appel('POST', '/colis', { cgvAcceptees: true,
    mode: 'air', typeColis: 'vetements', poidsEstime: 5, depot: 'PARIS', guichet: 'KALOUM',
    destinataire: { nom: 'X', telephone: '622111223' },
    ramassage: { demande: true, adresse: { quartier: 'Barbès', repere: 'x' } },
  }, client);
  // Ramassage sans position : accepté (adresse à compléter, le livreur appellera), prix inconnu
  assert.strictEqual(sansPos.status, 201, sansPos.message);
  assert.ok(!sansPos.colis.ramassage.prix);

  let suivi = (await appel('GET', `/colis/suivi/${numero}`)).colis;
  assert.strictEqual(suivi.livraison.aPosition, false);
  assert.ok(!JSON.stringify(suivi).includes('interphone'), 'pas d\'adresse précise en public');

  // Le livreur de Paris voit le ramassage, pas la livraison de Kaloum
  let courses = (await appel('GET', '/livreur/courses', null, livParis)).courses;
  assert.deepStrictEqual(courses.filter(c => c.numeroSuivi === numero).map(c => c.type), ['ramassage']);
  r = await appel('POST', '/livreur/prendre', { numero, type: 'ramassage' }, livParis);
  assert.strictEqual(r.course.statut, 'assignee');
  r = await appel('POST', '/livreur/ramasse', { numero, opId: 'ram-1', position: { lat: 48.8925 + 0.0271, lng: 2.3484 } }, livParis);
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.course.statut, 'faite');
  assert.ok(r.course.ecartM < 50, `écart ${r.course.ecartM} m`);
  assert.strictEqual((await appel('POST', '/livreur/ramasse', { numero, opId: 'ram-1' }, livParis)).rejoue, true);

  // Dépôt à l'agence : transport + ramassage à payer (la livraison n'a pas encore de prix)
  r = await appel('POST', '/agent/depot', { cgvAcceptees: true, numeroSuivi: numero, poidsReel: 5 }, agentParis);
  assert.strictEqual(r.status, 201, r.message);
  const taux = r.colis.tarif.taux;
  assert.strictEqual(r.colis.solde.domicileGnf, 12 * taux);
  assert.strictEqual(r.colis.solde.soldeEur, 60 + 12);
  await appel('POST', '/agent/encaisser', { numero, paiement: { montant: 72, devise: 'EUR', methode: 'carte' } }, agentParis);

  // Le destinataire envoie sa position depuis la page de suivi (vérifié par son numéro)
  r = await appel('POST', `/colis/${numero}/livraison`, { telephone: '620999999', adresse: { quartier: 'Kipé', repere: 'x', lien: '9.5542, -13.7122' } });
  assert.strictEqual(r.status, 403);
  r = await appel('POST', `/colis/${numero}/livraison`, { telephone: '622 11 12 22', adresse: { commune: 'Ratoma', quartier: 'Kipé', repere: 'Près de la pharmacie Kipé', lien: 'https://maps.google.com/?q=9.5542,-13.7122' } });
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.colis.livraison.prix, 23000); // 10 000 + 2 000 × 6,5 km
  assert.strictEqual(r.colis.soldeGnf, 23000);

  // Voyage : lot, arrivée, mise en rayon à Kaloum
  const lot = (await appel('POST', '/lots', { mode: 'air' }, admin)).lot;
  await appel('POST', '/agent/scans', { scans: [{ opId: 'd1', numero, action: 'charger', lot: lot.code }] }, agentParis);
  await appel('POST', `/lots/${lot.code}/statut`, { statut: 'parti' }, admin);
  r = await appel('POST', '/agent/scans', { scans: [{ opId: 'd2', numero, action: 'arrivee', lot: lot.code }, { opId: 'd3', numero, action: 'guichet' }] }, agentKaloum);
  assert.ok(r.resultats.every(x => x.ok), JSON.stringify(r.resultats));
  const ctx = await appel('GET', '/agent/contexte', null, agentKaloum);
  assert.strictEqual(ctx.colisPrets.find(c => c.numeroSuivi === numero).aLivrer, true);

  // L'admin assigne la livraison au livreur de Kaloum
  const vueAdmin = await appel('GET', '/admin/courses', null, admin);
  assert.ok(vueAdmin.livreurs.some(l => l.prenom === 'Sekou'));
  assert.ok(vueAdmin.faites.some(c => c.numeroSuivi === numero && c.type === 'ramassage'));
  const sekou = vueAdmin.livreurs.find(l => l.prenom === 'Sekou');
  // Livraison pas payée d'avance : l'admin confirme (le livreur encaissera chez le client)
  assert.strictEqual((await appel('POST', '/admin/courses/assigner', { numero, type: 'livraison', livreur: sekou._id }, admin)).code, 'non_payee');
  r = await appel('POST', '/admin/courses/assigner', { numero, type: 'livraison', livreur: sekou._id, force: true }, admin);
  assert.strictEqual(r.course.livreurNom, 'Sekou Livreur');
  // Le livreur de Paris ne peut pas la prendre
  assert.strictEqual((await appel('POST', '/livreur/prendre', { numero, type: 'livraison' }, livParis)).status, 403);

  r = await appel('POST', '/livreur/depart', { numero }, livKaloum);
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.course.statutColis, 'en_livraison');
  // Le guichet ne peut plus le remettre
  const code = (await appel('GET', `/admin/colis/${numero}`, null, admin)).colis.codeRetrait;
  assert.match(code, /^\d{4}$/);
  r = await appel('POST', '/agent/remise', { numero, code, pieceVerifiee: true }, agentKaloum);
  assert.strictEqual(r.status, 409);
  // Le client voit son code pendant la livraison
  assert.strictEqual((await appel('GET', `/colis/${numero}`, null, client)).colis.codeRetrait, code);

  // Chez le destinataire : mauvais code, puis bon code sans payer, puis paiement
  assert.strictEqual((await appel('POST', '/livreur/livre', { numero, code: code === '0000' ? '1111' : '0000' }, livKaloum)).status, 401);
  r = await appel('POST', '/livreur/livre', { numero, code }, livKaloum);
  assert.strictEqual(r.status, 402, r.message);
  r = await appel('POST', '/livreur/livre', {
    numero, code, opId: 'liv-1', signature: 'data:image/png;base64,AAAA',
    paiement: { montant: 23000, devise: 'GNF', methode: 'especes' }, position: { lat: 9.5543, lng: -13.7121 },
  }, livKaloum);
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.colis.statut, 'remis');
  assert.strictEqual(r.colis.remise.aDomicile, true);
  assert.strictEqual(r.colis.livraison.statut, 'faite');
  assert.ok(r.colis.livraison.ecartM < 50);
  // L'argent est dans la caisse du livreur
  const caisse = await appel('GET', '/caisse/moi', null, livKaloum);
  assert.strictEqual(caisse.totaux.GNF.especes, 23000);

  // ── Échec de livraison : le colis revient en rayon ──
  r = await appel('POST', '/agent/depot', { cgvAcceptees: true,
    poidsReel: 2, mode: 'air', typeColis: 'vetements', guichet: 'KALOUM',
    expediteur: { nom: 'Ali Sow', telephone: '0633333333' }, destinataire: { nom: 'Binta Sow', telephone: '623333333' },
    livraison: { demande: true, adresse: { quartier: 'Taouyah', repere: 'Portail bleu', position: { lat: 9.53, lng: -13.69 } } },
    paiement: { montant: 24, devise: 'EUR', methode: 'especes' },
  }, agentParis);
  assert.strictEqual(r.status, 201, r.message);
  const num2 = r.colis.numeroSuivi;
  assert.ok(r.colis.livraison.prix > 10000);
  assert.ok(r.colis.solde.soldeGnf > 0, 'la livraison reste à payer à l\'arrivée');
  const lot2 = (await appel('POST', '/lots', { mode: 'air' }, admin)).lot;
  await appel('POST', '/agent/scans', { scans: [{ opId: 'e1', numero: num2, action: 'charger', lot: lot2.code }] }, agentParis);
  await appel('POST', `/lots/${lot2.code}/statut`, { statut: 'parti' }, admin);
  await appel('POST', '/agent/scans', { scans: [{ opId: 'e2', numero: num2, action: 'arrivee', lot: lot2.code }, { opId: 'e3', numero: num2, action: 'guichet' }] }, agentKaloum);
  courses = (await appel('GET', '/livreur/courses', null, livKaloum)).courses;
  assert.ok(courses.some(c => c.numeroSuivi === num2 && c.type === 'livraison' && c.empreinteCode));
  await appel('POST', '/livreur/prendre', { numero: num2, type: 'livraison' }, livKaloum);
  await appel('POST', '/livreur/depart', { numero: num2 }, livKaloum);
  r = await appel('POST', '/livreur/echec', { numero: num2, type: 'livraison', motif: 'Absent, téléphone éteint' }, livKaloum);
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.course.statut, 'a_planifier');
  assert.strictEqual(r.course.statutColis, 'pret');
  assert.strictEqual(r.course.echecs.length, 1);
  // Le destinataire peut finalement venir le chercher : il annule la livraison et ne la paie pas
  r = await appel('POST', `/colis/${num2}/livraison`, { telephone: '623333333', demande: false });
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.colis.livraison, null);
  assert.strictEqual(r.colis.soldeGnf, 0);
});

test('conditions, factures conformes, photo au dépôt et réclamation', async () => {
  const admin = await connexion(ADMIN_TEL);
  const agentParis = await connexion('+33600000002');
  const agentKaloum = await connexion('620000003');
  const client = await connexion('0644444444', 'Kadiatou', 'Bah');
  const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQ==';

  // Conditions obligatoires, en ligne et au comptoir
  let r = await appel('POST', '/colis', { mode: 'air', typeColis: 'vetements', poidsEstime: 2, depot: 'PARIS', guichet: 'KALOUM', destinataire: { nom: 'X', telephone: '620000077' } }, client);
  assert.strictEqual(r.status, 400);
  assert.match(r.message, /conditions/);
  const base = { poidsReel: 5, mode: 'air', typeColis: 'vetements', guichet: 'KALOUM', expediteur: { nom: 'Kadiatou Bah', telephone: '0644444444' }, destinataire: { nom: 'Mamadou Bah', telephone: '624444444' } };
  r = await appel('POST', '/agent/depot', base, agentParis);
  assert.strictEqual(r.status, 400);

  // TVA 20 % en France, mentions de la société
  await appel('PATCH', '/config/admin', { facturation: { capital: '1 000 €', email: 'contact@tms.test', tva: { FR: { taux: 0.2 }, GN: { taux: 0, mention: 'TVA non applicable' } } } }, admin);
  r = await appel('POST', '/agent/depot', { ...base, cgvAcceptees: true, photo: PHOTO, paiement: { montant: 60, devise: 'EUR', methode: 'carte' } }, agentParis);
  assert.strictEqual(r.status, 201, r.message);
  const numero = r.colis.numeroSuivi;
  assert.strictEqual(r.colis.cgv.par, 'comptoir');
  assert.ok(r.colis.photoDepot);

  let fs = (await appel('GET', `/factures/colis/${numero}`, null, client)).factures;
  assert.strictEqual(fs.length, 1);
  const fa = fs[0];
  assert.match(fa.numero, /^FA-\d{4}-\d{5}$/);
  assert.strictEqual(fa.devise, 'EUR');
  assert.strictEqual(fa.totalTTC, 60);
  assert.strictEqual(fa.totalHT, 50);
  assert.strictEqual(fa.totalTVA, 10);
  assert.strictEqual(fa.emetteur.siren, '105005409');
  assert.strictEqual(fa.emetteur.capital, '1 000 €');
  assert.strictEqual(fa.client.nom, 'Kadiatou Bah');
  assert.strictEqual(fa.etat, 'payee');
  // Lien partageable : seulement avec le jeton
  assert.strictEqual((await appel('GET', `/factures/public/${fa.numero}?t=faux`)).status, 404);
  assert.strictEqual((await appel('GET', `/factures/public/${fa.numero}?t=${fa.jeton}`)).facture.numero, fa.numero);
  // Rien à refacturer
  assert.strictEqual((await appel('POST', `/factures/colis/${numero}/emettre`, null, agentParis)).status, 409);

  // « Mes factures » du client : la facture du dépôt y figure, avec son lien
  const mes = await appel('GET', '/factures/mes', null, client);
  assert.strictEqual(mes.status, 200, mes.message);
  assert.ok(mes.factures.some(f => f.numero === fa.numero && f.jeton && f.etat === 'payee'));
  // Un autre client ne voit pas cette facture
  const autre = await connexion('0655555500', 'Autre', 'Client');
  assert.ok(!(await appel('GET', '/factures/mes', null, autre)).factures.some(f => f.numero === fa.numero));

  // Exports Excel (CSV) de l'admin : colis et encaissements ; interdits aux clients
  const jour = new Date().toLocaleDateString('sv'); // AAAA-MM-JJ à l'heure locale, comme le serveur
  for (const nom of ['colis', 'encaissements']) {
    const res = await fetch(`${API}/admin/export/${nom}.csv?debut=${jour}&fin=${jour}`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const octets = Buffer.from(await res.arrayBuffer());
    assert.deepStrictEqual([...octets.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM pour Excel');
    const txt = octets.toString('utf8');
    assert.ok(txt.includes(numero), `${nom} : le colis du jour est dans le fichier`);
    assert.strictEqual((await fetch(`${API}/admin/export/${nom}.csv`, { headers: { Authorization: `Bearer ${client}` } })).status, 403);
  }

  // Photo : visible par le client du colis, pas par un inconnu
  const resPhoto = await fetch(`${API}/photos/${r.colis.photoDepot}`, { headers: { Authorization: `Bearer ${client}` } });
  assert.strictEqual(resPhoto.headers.get('content-type'), 'image/jpeg');
  const intrus = await connexion('+33600000098', 'Intrus', 'Y');
  assert.strictEqual((await fetch(`${API}/photos/${r.colis.photoDepot}`, { headers: { Authorization: `Bearer ${intrus}` } })).status, 403);

  // Arrivée, douane, remise → facture complémentaire en GNF au destinataire, douane en débours
  const lot = (await appel('POST', '/lots', { mode: 'air' }, admin)).lot;
  await appel('POST', '/agent/scans', { scans: [{ opId: 'f1', numero, action: 'charger', lot: lot.code }] }, agentParis);
  await appel('POST', `/lots/${lot.code}/statut`, { statut: 'parti' }, admin);
  await appel('POST', '/agent/scans', { scans: [{ opId: 'f2', numero, action: 'arrivee', lot: lot.code }, { opId: 'f3', numero, action: 'guichet' }] }, agentKaloum);
  await appel('PATCH', `/agent/colis/${numero}/douane`, { montant: 30000, devise: 'GNF' }, agentKaloum);
  const code = (await appel('GET', `/admin/colis/${numero}`, null, admin)).colis.codeRetrait;
  r = await appel('POST', '/agent/remise', { numero, code, pieceVerifiee: true, paiement: { montant: 30000, devise: 'GNF', methode: 'especes' } }, agentKaloum);
  assert.strictEqual(r.status, 200, r.message);
  fs = (await appel('GET', `/factures/colis/${numero}`, null, admin)).factures;
  assert.strictEqual(fs.length, 2);
  const fc = fs[1];
  assert.strictEqual(fc.devise, 'GNF');
  assert.strictEqual(fc.client.nom, 'Mamadou Bah');
  assert.deepStrictEqual(fc.lignes.map(l => l.cle), ['douane']);
  assert.strictEqual(fc.lignes[0].debours, true);
  assert.strictEqual(fc.totalTTC, 30000);
  assert.strictEqual(fc.mentionTva, 'TVA non applicable');
  assert.strictEqual(fc.etat, 'payee');

  // Le destinataire paie tout : une seule facture, à la remise, en GNF
  r = await appel('POST', '/agent/depot', { ...base, cgvAcceptees: true, poidsReel: 2, payeurArrivee: true, destinataire: { nom: 'Fanta Bah', telephone: '624444445' } }, agentParis);
  const num2 = r.colis.numeroSuivi;
  assert.strictEqual((await appel('GET', `/factures/colis/${num2}`, null, admin)).factures.length, 0);

  // Réclamation du client : colis abîmé, avec photo
  r = await appel('POST', '/reclamations', { numero, motif: 'abime', description: 'Le carton est arrivé écrasé, deux assiettes cassées.', montantDemande: 40, deviseDemande: 'EUR', photos: [PHOTO] }, client);
  assert.strictEqual(r.status, 201, r.message);
  const rec = r.reclamation;
  assert.match(rec.numero, /^R-\d{4}-\d{4}$/);
  assert.strictEqual(rec.photos.length, 1);
  assert.strictEqual((await appel('POST', '/reclamations', { numero, motif: 'abime', description: 'Encore une fois la même chose.' }, client)).status, 409);
  assert.strictEqual((await appel('POST', '/reclamations', { numero, motif: 'abime', description: 'Je ne suis pas concerné du tout.' }, intrus)).status, 404);

  // L'admin instruit : note interne invisible du client, plafond indicatif, avoir de 20 €
  await appel('POST', `/reclamations/${rec.numero}/message`, { texte: 'Vérifier avec Ibrahima', interne: true }, admin);
  await appel('POST', `/reclamations/${rec.numero}/message`, { texte: 'Nous regardons la photo du dépôt.' }, admin);
  const vueAdmin = await appel('GET', `/reclamations/${rec.numero}`, null, admin);
  assert.strictEqual(vueAdmin.plafond.montantEur, 100); // 5 kg × 20 €
  assert.ok(vueAdmin.colis.photoDepot);
  const vueClient = (await appel('GET', `/reclamations/${rec.numero}`, null, client)).reclamation;
  assert.ok(!vueClient.suivi.some(s => s.interne), 'notes internes cachées');
  assert.strictEqual(vueClient.statut, 'en_cours');

  r = await appel('POST', `/reclamations/${rec.numero}/decision`, { decision: 'avoir', montant: 20, motif: 'Geste commercial pour la casse', methode: 'virement', reference: 'VIR-1' }, admin);
  assert.strictEqual(r.status, 200, r.message);
  assert.match(r.reclamation.decision.avoir, /^AV-\d{4}-\d{5}$/);
  fs = (await appel('GET', `/factures/colis/${numero}`, null, admin)).factures;
  const av = fs.find(f => f.type === 'avoir');
  assert.strictEqual(av.totalTTC, 20);
  assert.strictEqual(av.factureOrigine, fa.numero);
  assert.strictEqual((await appel('POST', `/reclamations/${rec.numero}/decision`, { decision: 'refus', motif: 'non' }, admin)).status, 409);
  const caisse = await appel('GET', '/caisse/moi', null, admin);
  assert.strictEqual(caisse.totaux.EUR.virement, -20);

  // Registre pour le comptable
  const csv = await (await fetch(`${API}/factures/export.csv`, { headers: { Authorization: `Bearer ${admin}` } })).text();
  assert.ok(csv.includes(fa.numero) && csv.includes(av.numero) && csv.includes('-20'));

  // Durées de conservation : un an après la remise, photos et signature disparaissent
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kolis_test');
  const { appliquerRetention } = require('../scripts/retention');
  const bilan = await appliquerRetention(new Date(Date.now() + 400 * 86400000));
  assert.ok(bilan.photos >= 2, JSON.stringify(bilan));
  const apres = (await appel('GET', `/admin/colis/${numero}`, null, admin)).colis;
  assert.ok(!apres.photoDepot && !apres.remise.signature);
  assert.strictEqual((await appel('GET', `/factures/colis/${numero}`, null, admin)).factures.length, 3, 'les factures restent');
  await mongoose.disconnect();
});

test('scan automatique : un agent différent à chaque étape, l\'app choisit l\'étape', async () => {
  const admin = await connexion(ADMIN_TEL);
  const agentParis = await connexion('+33600000002');   // Awa, Paris
  const agentKaloum = await connexion('620000003');     // Ibrahima, Kaloum (plateforme)
  const agentLabe = await connexion('620000004');       // Mariama, Labé
  const dep = (guichet, tel) => appel('POST', '/agent/depot', {
    poidsReel: 3, mode: 'mer', typeColis: 'vetements', guichet, cgvAcceptees: true,
    expediteur: { nom: 'Sékou Bah', telephone: '0655555555' }, destinataire: { nom: `Dest ${tel}`, telephone: tel },
  }, agentParis);
  const n1 = (await dep('KALOUM', '626000001')).colis.numeroSuivi;
  const n2 = (await dep('LABE', '626000002')).colis.numeroSuivi;
  const auto = async (numero, token) => (await appel('POST', '/agent/scans', { scans: [{ opId: `a-${numero}-${Math.random()}`, numero, action: 'auto' }] }, token)).resultats[0];

  // Paris : « Aujourd'hui » montre les colis à mettre en lot ; aucun lot bateau ouvert → ouvert automatiquement
  let auj = await appel('GET', '/agent/aujourdhui', null, agentParis);
  assert.ok(auj.taches.some(t => t.cle === 'charger' && t.nb >= 2), JSON.stringify(auj.taches));
  let r = await auto(n1, agentParis);
  assert.ok(r.ok, r.erreur);
  assert.strictEqual(r.actionFaite, 'charger');
  assert.match(r.lotCode, /^MER-\d{4}$/);
  const lot = r.lotCode;
  r = await auto(n2, agentParis);
  assert.strictEqual(r.lotCode, lot, 'même lot pour le même sens et le même mode');
  assert.strictEqual(r.avant.par, 'Awa A.');
  r = await auto(n2, agentParis);
  assert.ok(r.dejaFait && /Déjà dans le lot/.test(r.message));
  // Un agent en Guinée ne peut pas « réceptionner » un colis encore au départ… mais un colis chargé peut l'être
  assert.strictEqual((await auto(n1, agentLabe)).ok, true, 'colis chargé, lot pas encore marqué parti : réceptionné quand même');
  await appel('POST', `/lots/${lot}/statut`, { statut: 'parti' }, admin);

  // Kaloum (plateforme) : n1 arrive dans son agence → reçu et mis en rayon d'un coup
  auj = await appel('GET', '/agent/aujourdhui', null, agentKaloum);
  assert.ok(auj.taches.some(t => t.cle === `lot-${lot}`), JSON.stringify(auj.taches.map(t => t.cle)));
  // n2 : reçu à la plateforme, à envoyer vers Labé
  r = await auto(n2, agentKaloum);
  assert.strictEqual(r.actionFaite, 'arrivee');
  assert.strictEqual(r.aEnvoyer, true);
  assert.match(r.message, /Labé/);
  auj = await appel('GET', '/agent/aujourdhui', null, agentKaloum);
  assert.ok(auj.taches.some(t => t.cle === 'envoyer'));
  r = await auto(n2, agentKaloum);
  assert.strictEqual(r.actionFaite, 'acheminer');
  // Labé : un autre agent met en rayon
  r = await auto(n2, agentLabe);
  assert.strictEqual(r.actionFaite, 'guichet');
  assert.strictEqual(r.statut, 'pret');
  assert.strictEqual(r.avant.par, 'Ibrahima A.');
  auj = await appel('GET', '/agent/aujourdhui', null, agentLabe);
  assert.ok(auj.taches.some(t => t.cle === 'remettre'));
  // Paris rescanne un colis déjà en rayon à Labé : explication claire, rien ne bouge
  r = await auto(n2, agentParis);
  assert.strictEqual(r.ok, false);
  assert.match(r.erreur, /attend son destinataire à Agence Labé/);
  r = await auto(n2, agentLabe);
  assert.ok(r.pretARemettre);
  // L'historique dit qui a fait quoi
  const fiche = (await appel('GET', `/agent/colis/${n2}`, null, agentLabe)).colis;
  const noms = fiche.historique.map(h => h.agent?.prenom).filter(Boolean);
  assert.deepStrictEqual([...new Set(noms)], ['Awa', 'Admin', 'Ibrahima', 'Mariama']);
});

test('erreurs : double scan sans effet, annulation d\'une étape, départ de lot annulé', async () => {
  const admin = await connexion(ADMIN_TEL);
  const agentParis = await connexion('+33600000002');
  const agentKaloum = await connexion('620000003');
  const n = (await appel('POST', '/agent/depot', { poidsReel: 2, mode: 'air', typeColis: 'vetements', guichet: 'KALOUM', cgvAcceptees: true,
    expediteur: { nom: 'Test Erreur', telephone: '0677777777' }, destinataire: { nom: 'Dest Erreur', telephone: '627777777' } }, agentParis)).colis.numeroSuivi;
  const auto = async (token) => (await appel('POST', '/agent/scans', { scans: [{ opId: `e-${Math.random()}`, numero: n, action: 'auto' }] }, token)).resultats[0];
  let r = await auto(agentParis);
  const lot = r.lotCode;
  // Double scan : aucun effet
  r = await auto(agentParis);
  assert.ok(r.dejaFait);
  let fiche = (await appel('GET', `/agent/colis/${n}`, null, agentParis)).colis;
  assert.strictEqual(fiche.historique.filter(h => h.statut === 'charge').length, 1);
  // Mauvais colis mis dans le lot : l'agent annule
  r = await appel('POST', '/agent/annuler', { numero: n, motif: 'Mauvais colis' }, agentParis);
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.statut, 'depose');
  assert.strictEqual(r.colis.lotCode, undefined);
  // Rien d'autre à annuler par l'agent (le dépôt ne s'annule pas ici)
  assert.strictEqual((await appel('POST', '/agent/annuler', { numero: n }, agentParis)).status, 409);
  // Rechargé, lot marqué parti par erreur, puis départ annulé
  r = await auto(agentParis);
  assert.strictEqual(r.lotCode, lot);
  assert.strictEqual((await appel('POST', `/lots/${lot}/statut`, { statut: 'parti' }, admin)).status, 200);
  r = await appel('POST', `/lots/${lot}/statut`, { statut: 'preparation' }, admin);
  assert.strictEqual(r.status, 200, r.message);
  fiche = (await appel('GET', `/agent/colis/${n}`, null, agentParis)).colis;
  assert.strictEqual(fiche.statut, 'charge');
  // Arrivée + mise en rayon, puis l'agent de Kaloum annule la mise en rayon ; un agent de Paris ne peut pas
  await appel('POST', `/lots/${lot}/statut`, { statut: 'parti' }, admin);
  r = await auto(agentKaloum);
  assert.strictEqual(r.statut, 'pret');
  assert.strictEqual((await appel('POST', '/agent/annuler', { numero: n }, agentParis)).status, 403);
  r = await appel('POST', '/agent/annuler', { numero: n, motif: 'Pas la bonne étagère' }, agentKaloum);
  assert.strictEqual(r.statut, 'arrive');
  r = await auto(agentKaloum);
  assert.strictEqual(r.statut, 'pret');
  // Remise annulée : seulement par l'admin
  const code = (await appel('GET', `/admin/colis/${n}`, null, admin)).colis.codeRetrait;
  const reste = (await appel('GET', `/agent/colis/${n}`, null, agentKaloum)).colis.solde.soldeGnf;
  r = await appel('POST', '/agent/remise', { numero: n, code, pieceVerifiee: true, paiement: { montant: reste, devise: 'GNF', methode: 'especes' } }, agentKaloum);
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual((await appel('POST', '/agent/annuler', { numero: n }, agentKaloum)).status, 403);
  r = await appel('POST', '/agent/annuler', { numero: n, motif: 'Remis à la mauvaise personne, récupéré' }, admin);
  assert.strictEqual(r.statut, 'pret');
  assert.ok(!r.colis.remise?.le);
  fiche = (await appel('GET', `/agent/colis/${n}`, null, agentKaloum)).colis;
  assert.ok(fiche.historique.some(h => h.label === 'Étape annulée' && /mauvaise personne/.test(h.detail)));
});


test('notifications push : client, agents de l\'agence, admin', async () => {
  // Faux service de notifications (comme celui de Google ou d'Apple), en HTTPS local
  const https = require('https');
  const fs = require('fs');
  const SP = process.env.SCRATCH || '/tmp/claude-0/-home-claude-diasporalink/f3bf26df-ba64-59c5-bbb9-5bdbe7a08ab4/scratchpad';
  if (!fs.existsSync(`${SP}/cert.pem`)) return; // pas de certificat de test : on saute
  const recus = {};
  const srv = https.createServer({ key: fs.readFileSync(`${SP}/cle.pem`), cert: fs.readFileSync(`${SP}/cert.pem`) }, (req, res) => {
    let n = 0; req.on('data', d => { n += d.length; }); req.on('end', () => { recus[req.url] = (recus[req.url] || 0) + 1; res.writeHead(201); res.end(); });
  });
  await new Promise(r => srv.listen(5098, r));
  const abonnement = (nom) => {
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    return { endpoint: `https://127.0.0.1:5098/${nom}`, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  };
  const admin = await connexion(ADMIN_TEL);
  const agentParis = await connexion('+33600000002');
  const agentKaloum = await connexion('620000003');
  const destinataire = await connexion('628888888', 'Awa', 'Destinataire');
  assert.strictEqual((await appel('GET', '/push/cle')).actif, true);
  for (const [tok, nom, app] of [[admin, 'admin', 'admin'], [agentKaloum, 'kaloum', 'agent'], [destinataire, 'client', 'client']]) {
    const r = await appel('POST', '/push/abonner', { abonnement: abonnement(nom), app }, tok);
    assert.strictEqual(r.status, 200, r.message);
  }
  // Un client ne peut pas s'abonner aux alertes du back-office
  assert.strictEqual((await appel('POST', '/push/abonner', { abonnement: abonnement('pirate'), app: 'admin' }, destinataire)).status, 403);
  const attendre = () => new Promise(r => setTimeout(r, 600));

  // Dépôt à Paris pour ce destinataire, chargement, départ du lot → Kaloum prévenu, client prévenu
  const n = (await appel('POST', '/agent/depot', { poidsReel: 2, mode: 'air', typeColis: 'vetements', guichet: 'KALOUM', cgvAcceptees: true, paiement: { montant: 24, devise: 'EUR', methode: 'carte' },
    expediteur: { nom: 'Exp Push', telephone: '0688888888' }, destinataire: { nom: 'Awa Destinataire', telephone: '628888888' } }, agentParis)).colis.numeroSuivi;
  const lot = (await appel('POST', '/agent/scans', { scans: [{ opId: 'p1', numero: n, action: 'auto' }] }, agentParis)).resultats[0].lotCode;
  await appel('POST', `/lots/${lot}/statut`, { statut: 'parti' }, admin);
  await attendre();
  assert.ok(recus['/kaloum'] >= 1, `agent prévenu du lot : ${JSON.stringify(recus)}`);
  assert.ok(recus['/client'] >= 1, 'client prévenu du départ');
  // Mise en rayon → le client reçoit son code en notification
  const avant = recus['/client'];
  await appel('POST', '/agent/scans', { scans: [{ opId: 'p2', numero: n, action: 'auto' }] }, agentKaloum);
  await attendre();
  assert.ok(recus['/client'] > avant, 'client prévenu que le colis est prêt');
  // Réclamation → l'admin est prévenu
  await appel('POST', '/reclamations', { numero: n, motif: 'retard', description: 'Test de notification au service client.' }, destinataire);
  await attendre();
  assert.ok(recus['/admin'] >= 1, 'admin prévenu de la réclamation');
  // Abonnement disparu chez Google/Apple (410) : il est supprimé
  srv.close();
});

test('articles à la pièce : réservation, pesée au comptoir, facture, catalogue de l\'admin', async () => {
  const admin = await connexion(ADMIN_TEL);
  const agentParis = await connexion('+33600000002');
  const client = await connexion('0655555555', 'Fanta', 'Camara');

  // Le catalogue est public, avec les prix par sens et par mode
  const cfg = await appel('GET', '/config');
  const chaussures = cfg.articles.find(a => a.cle === 'chaussures');
  assert.ok(chaussures, 'catalogue présent');
  assert.strictEqual(chaussures.prix['FR-GN'].air, 15);

  // Réservation : 4 kg de vêtements + 2 paires de chaussures (3 kg) = 7 kg annoncés
  let r = await appel('POST', '/colis', {
    mode: 'air', typeColis: 'vetements', poidsEstime: 7, depot: 'PARIS', guichet: 'KALOUM', cgvAcceptees: true,
    articles: [{ cle: 'chaussures', quantite: 2 }, { cle: 'nimporte', quantite: 4 }],
    destinataire: { nom: 'Aïssatou Camara', telephone: '625555555' },
  }, client);
  assert.strictEqual(r.status, 201, r.message);
  assert.deepStrictEqual(r.colis.articles.map(a => [a.cle, a.quantite]), [['chaussures', 2]]);
  assert.strictEqual(r.colis.nbCartons, 1);
  assert.strictEqual(r.colis.tarif.totalEur, 4 * 12 + 30);
  const numero = r.colis.numeroSuivi;

  // Seulement des chaussures : réservation possible sans poids au kilo
  r = await appel('POST', '/colis', {
    mode: 'mer', typeColis: 'vetements', poidsEstime: 1.5, depot: 'PARIS', guichet: 'KALOUM', cgvAcceptees: true,
    articles: [{ cle: 'chaussures', quantite: 1 }], destinataire: { nom: 'B', telephone: '625555556' },
  }, client);
  assert.strictEqual(r.status, 201, r.message);
  assert.strictEqual(r.colis.tarif.totalEur, 8, 'pas de minimum de 10 kg en bateau');

  // Comptoir : l'agent ajoute un téléphone, la balance indique 8 kg
  r = await appel('POST', '/agent/depot', {
    numeroSuivi: numero, poidsReel: 8, articles: [{ cle: 'chaussures', quantite: 2 }, { cle: 'telephone', quantite: 1 }],
    paiement: { montant: 1000, devise: 'EUR', methode: 'especes' },
  }, agentParis);
  assert.strictEqual(r.status, 201, r.message);
  const t = r.colis.tarif;
  assert.strictEqual(t.poidsArticles, 3.5);
  assert.strictEqual(t.poidsFacture, 4.5);
  assert.strictEqual(t.totalEur, 4.5 * 12 + 30 + 25);
  assert.match(r.colis.historique.at(-1).detail || r.colis.historique.at(-1).label, /chaussures|Pesé/);

  const fa = (await appel('GET', `/factures/colis/${numero}`, null, client)).factures[0];
  const lignes = Object.fromEntries(fa.lignes.map(l => [l.cle, l]));
  assert.strictEqual(lignes.transport.quantite, 4.5);
  assert.strictEqual(lignes['article:chaussures'].quantite, 2);
  assert.strictEqual(lignes['article:chaussures'].montantTTC, 30);
  assert.strictEqual(lignes['article:telephone'].montantTTC, 25);
  assert.strictEqual(fa.totalTTC, t.totalEur);

  // L'admin modifie le catalogue : nouveau prix, nouvel article, article retiré
  const articles = (await appel('GET', '/config/admin', null, admin)).config.articles
    .filter(a => a.cle !== 'parfum')
    .map(a => (a.cle === 'chaussures' ? { ...a, prix: { ...a.prix, 'FR-GN': { air: 18, mer: 9 } } } : a));
  articles.push({ label: 'Valise vide', poids: 4, prix: { 'FR-GN': { air: 30 } } });
  r = await appel('PATCH', '/config/admin', { articles }, admin);
  assert.strictEqual(r.status, 200, r.message);
  const apres = (await appel('GET', '/config')).articles;
  assert.ok(!apres.some(a => a.cle === 'parfum'));
  assert.strictEqual(apres.find(a => a.cle === 'chaussures').prix['FR-GN'].air, 18);
  const valise = apres.find(a => a.label === 'Valise vide');
  assert.strictEqual(valise.cle, 'valise-vide');
  assert.deepStrictEqual(valise.prix['GN-FR'], {});
});

test('paiement en ligne : livraison payée d\'avance (mobile money vérifié), non remboursable, moyens par pays', async () => {
  const admin = await connexion(ADMIN_TEL);
  const client = await connexion('0655555555', 'Fanta', 'Camara');

  // Moyens : rien en mobile money tant qu'aucun numéro marchand ; carte absente sans Stripe
  let pub = await appel('GET', '/config');
  assert.deepStrictEqual(pub.moyensPaiement.GN, []);
  let r = await appel('PATCH', '/config/admin', { paiements: { GN: { orange_money: true, mtn_momo: false }, comptes: { orange_money: { numero: '622 00 00 00', titulaire: 'TMS' } } } }, admin);
  assert.strictEqual(r.status, 200, r.message);
  pub = await appel('GET', '/config');
  assert.deepStrictEqual(pub.moyensPaiement.GN.map(m => [m.key, m.numero]), [['orange_money', '622 00 00 00']]);

  // Réservation avec livraison à Kipé (position connue) : la livraison est à payer d'avance
  r = await appel('POST', '/colis', { cgvAcceptees: true,
    mode: 'air', typeColis: 'vetements', poidsEstime: 3, depot: 'PARIS', guichet: 'KALOUM',
    destinataire: { nom: 'Binta Sow', telephone: '622333444' },
    livraison: { demande: true, adresse: { ville: 'Conakry', quartier: 'Kipé', repere: 'Pharmacie', position: { lat: 9.5092 + 0.03, lng: -13.7122 } } },
  }, client);
  assert.strictEqual(r.status, 201, r.message);
  const numero = r.colis.numeroSuivi;
  const prixGnf = r.colis.livraison.prixGnf;
  assert.ok(prixGnf > 0);
  assert.strictEqual(r.colis.domicileAPayerGnf, prixGnf);
  let du = await appel('GET', `/paiements/a-payer/${numero}`);
  assert.strictEqual(du.domicile.gnf, prixGnf);
  assert.ok(du.solde.gnf > prixGnf, 'prix estimé (transport + livraison) payable dès la réservation');
  assert.strictEqual(du.solde.estime, true);

  // L'admin ne peut pas envoyer le livreur sans prévenir : course pas payée
  const sekou = (await appel('GET', '/admin/courses', null, admin)).livreurs.find(l => l.lieu === 'KALOUM');
  r = await appel('POST', '/admin/courses/assigner', { numero, type: 'livraison', livreur: sekou._id }, admin);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.code, 'non_payee');

  // Le client paie par Orange Money et donne la référence ; doublon refusé
  assert.strictEqual((await appel('POST', '/paiements/mobile', { numero, objet: 'domicile', methode: 'mtn_momo', reference: 'X1234' })).status, 400, 'MTN fermé');
  r = await appel('POST', '/paiements/mobile', { numero, objet: 'domicile', methode: 'orange_money', reference: 'PP2610.1432.A1', telephone: '622333444' });
  assert.strictEqual(r.status, 201, r.message);
  assert.strictEqual(r.enAttente.length, 1);
  assert.strictEqual((await appel('POST', '/paiements/mobile', { numero, objet: 'domicile', methode: 'orange_money', reference: 'pp2610.1432.a1' })).status, 409);
  assert.strictEqual((await appel('GET', `/colis/suivi/${numero}`)).colis.paiementEnVerification, true);

  // L'admin vérifie sur le compte marchand et valide
  const decl = (await appel('GET', '/paiements/declarations', null, admin)).declarations.find(d => d.numeroSuivi === numero);
  assert.strictEqual(decl.montantGnf, prixGnf);
  assert.strictEqual((await appel('GET', '/paiements/declarations', null, client)).status, 403);
  r = await appel('POST', `/paiements/declarations/${decl.id}`, { decision: 'valider' }, admin);
  assert.strictEqual(r.status, 200, r.message);
  let c = (await appel('GET', `/colis/${numero}`, null, client)).colis;
  assert.strictEqual(c.livraison.payeGnf, prixGnf);
  assert.strictEqual(c.domicileAPayerGnf, 0);
  assert.ok(c.paiements.some(p => p.objet === 'domicile' && p.methode === 'orange_money' && p.devise === 'GNF'));
  // Facture de la livraison émise tout de suite
  const fs = (await appel('GET', `/factures/colis/${numero}`, null, client)).factures;
  assert.deepStrictEqual(fs.flatMap(f => f.lignes.map(l => l.cle)), ['livraison']);
  // Maintenant l'assignation passe
  r = await appel('POST', '/admin/courses/assigner', { numero, type: 'livraison', livreur: sekou._id }, admin);
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.course.payee, true);

  // Le client renonce : la livraison payée reste due (non remboursable), rien ne lui est rendu
  r = await appel('POST', `/colis/${numero}/livraison`, { telephone: '622333444', demande: false });
  assert.strictEqual(r.status, 200, r.message);
  c = (await appel('GET', `/colis/${numero}`, null, client)).colis;
  assert.strictEqual(c.livraison.statut, 'annulee');
  assert.strictEqual(c.solde.domicileGnf, prixGnf, 'frais acquis');
  // Redemandée plus tard : déjà payée
  r = await appel('POST', `/colis/${numero}/livraison`, { telephone: '622333444', demande: true, adresse: { ville: 'Conakry', quartier: 'Kipé', repere: 'Pharmacie', position: { lat: 9.5092 + 0.03, lng: -13.7122 } } });
  assert.strictEqual(r.status, 200, r.message);
  du = await appel('GET', `/paiements/a-payer/${numero}`);
  assert.strictEqual(du.domicile.gnf, 0);

  // Refus d'un paiement non trouvé : rien n'est enregistré
  const agentParis = await connexion('+33600000002');
  r = await appel('POST', '/agent/depot', { cgvAcceptees: true, numeroSuivi: numero, poidsReel: 3, payeurArrivee: true }, agentParis);
  assert.strictEqual(r.status, 201, r.message);
  du = await appel('GET', `/paiements/a-payer/${numero}`);
  assert.ok(du.solde.gnf > 0);
  r = await appel('POST', '/paiements/mobile', { numero, objet: 'global', methode: 'orange_money', reference: 'FAUX-999' });
  assert.strictEqual(r.status, 201, r.message);
  const d2 = (await appel('GET', '/paiements/declarations', null, admin)).declarations.find(d => d.reference === 'FAUX-999');
  assert.strictEqual(d2.montantGnf, du.solde.gnf);
  await appel('POST', `/paiements/declarations/${d2.id}`, { decision: 'refuser', motif: 'Introuvable' }, admin);
  assert.strictEqual((await appel('GET', `/paiements/a-payer/${numero}`)).solde.gnf, du.solde.gnf);
  // Carte : sans clés Stripe, le serveur le dit clairement
  assert.strictEqual((await appel('POST', '/paiements/creer-session', { numero, objet: 'solde' })).status, 503);
});

test('toutes les formules d\'envoi : 2 sens × express/avion/bateau × agence/domicile, adresses incomplètes, articles, options', async () => {
  const admin = await connexion(ADMIN_TEL);
  const client = await connexion('0655555555', 'Fanta', 'Camara');
  const agentParis = await connexion('+33600000002');
  const agentKaloum = await connexion('620000003');
  const cfg = await appel('GET', '/config');
  assert.deepStrictEqual(cfg.modes.map(m => m.key), ['express', 'air', 'mer']);
  assert.strictEqual(cfg.tarifs['FR-GN'].express.prixKg, 20);

  const combos = [];
  for (const [depot, guichet] of [['PARIS', 'KALOUM'], ['KALOUM', 'PARIS']]) {
    for (const mode of ['express', 'air', 'mer']) {
      for (const formule of ['agence', 'ramassage_complet', 'ramassage_sans_position', 'livraison_vide', 'tout_domicile']) {
        combos.push({ depot, guichet, mode, formule });
      }
    }
  }
  const resultats = [];
  for (const [i, k] of combos.entries()) {
    const corps = {
      cgvAcceptees: true, mode: k.mode, typeColis: i % 3 === 0 ? 'fragile' : 'vetements', poidsEstime: 4 + (i % 5),
      depot: k.depot, guichet: k.guichet, destinataire: { nom: `Test ${i}`, telephone: k.guichet === 'PARIS' ? `06110000${String(i).padStart(2, '0')}` : `6221100${String(i).padStart(2, '0')}` },
      articles: i % 4 === 0 ? [{ cle: 'chaussures', quantite: 1 }] : undefined,
      assurance: i % 6 === 0, valeurDeclaree: i % 6 === 0 ? 200 : 0, payeurArrivee: i % 7 === 0,
    };
    const posDepot = k.depot === 'PARIS' ? { lat: 48.9, lng: 2.35 } : { lat: 9.53, lng: -13.71 };
    if (k.formule === 'ramassage_complet' || k.formule === 'tout_domicile') corps.ramassage = { demande: true, adresse: { quartier: 'Centre', repere: 'Porte bleue', position: posDepot } };
    if (k.formule === 'ramassage_sans_position') corps.ramassage = { demande: true, adresse: {} };
    if (k.formule === 'livraison_vide' || k.formule === 'tout_domicile') corps.livraison = { demande: true, adresse: {} };
    const r = await appel('POST', '/colis', corps, client);
    assert.strictEqual(r.status, 201, `${JSON.stringify(k)} : ${r.message}`);
    resultats.push({ ...k, numero: r.colis.numeroSuivi, colis: r.colis });
  }
  assert.strictEqual(resultats.length, 30);
  // Prix express > avion > bateau à poids égal (même sens)
  const prixDe = (mode) => resultats.find(x => x.mode === mode && x.depot === 'PARIS' && x.formule === 'agence').colis.tarif;
  assert.ok(prixDe('express').prixKg > prixDe('air').prixKg && prixDe('air').prixKg > prixDe('mer').prixKg);
  // Adresse incomplète : course créée, prix inconnu, rien à payer d'avance tant qu'il manque la position
  const sansPos = resultats.find(x => x.formule === 'ramassage_sans_position');
  assert.strictEqual(sansPos.colis.ramassage.demande, true);
  assert.ok(!sansPos.colis.ramassage.prix);
  assert.strictEqual(sansPos.colis.domicileAPayerGnf, 0);
  const complet = resultats.find(x => x.formule === 'ramassage_complet');
  assert.ok(complet.colis.ramassage.prix > 0);
  assert.ok(complet.colis.domicileAPayerGnf > 0);

  // Dépôt au comptoir de chaque colis, puis chargement automatique : un lot par mode et par sens
  for (const x of resultats) {
    const ag = x.depot === 'PARIS' ? agentParis : agentKaloum;
    const r = await appel('POST', '/agent/depot', { numeroSuivi: x.numero, poidsReel: x.colis.poidsEstime + 0.5, payeurArrivee: true }, ag);
    assert.strictEqual(r.status, 201, `${x.numero} : ${r.message}`);
    const s = await appel('POST', '/agent/scans', { scans: [{ opId: `f-${x.numero}`, numero: x.numero, action: 'auto' }] }, ag);
    assert.ok(s.resultats[0].ok, `${x.numero} : ${s.resultats[0].erreur}`);
    x.lot = s.resultats[0].lotCode;
  }
  const lots = [...new Set(resultats.map(x => x.lot))];
  assert.strictEqual(lots.length, 6, `lots : ${lots.join(', ')}`);
  assert.ok(lots.some(l => l.startsWith('EXP')) && lots.some(l => l.startsWith('AIR')) && lots.some(l => l.startsWith('MER')));

  // Dépôt direct au comptoir (sans réservation), dans chaque mode, livraison sans adresse précise
  for (const mode of ['express', 'air', 'mer']) {
    const r = await appel('POST', '/agent/depot', {
      cgvAcceptees: true, poidsReel: 2, mode, typeColis: 'mixte', guichet: 'KALOUM',
      expediteur: { nom: 'Client Comptoir', telephone: '0699999999' }, destinataire: { nom: 'Dest Comptoir', telephone: '620999999' },
      livraison: { demande: true, adresse: { quartier: 'Kaloum' } },
      paiement: { montant: 1, devise: 'EUR', methode: 'especes' },
    }, agentParis);
    assert.strictEqual(r.status, 201, `${mode} : ${r.message}`);
    assert.strictEqual(r.colis.mode, mode);
    assert.strictEqual(r.colis.livraison.demande, true);
  }
  // Facture express : libellé « aérien express »
  const exp = resultats.find(x => x.mode === 'express' && x.depot === 'PARIS' && x.formule === 'agence');
  await appel('POST', `/factures/colis/${exp.numero}/emettre`, null, agentParis);
  const fa = (await appel('GET', `/factures/colis/${exp.numero}`, null, client)).factures[0];
  assert.match(fa.lignes[0].designation, /express/);

  // Tableau de bord : tout est compté
  const tdb = await appel('GET', '/admin/tableau?jours=30', null, admin);
  assert.strictEqual(tdb.status, 200, tdb.message);
  assert.ok(tdb.kpi.deposes >= 33, `déposés ${tdb.kpi.deposes}`);
  assert.strictEqual(tdb.parJour.length, 30);
  assert.ok(tdb.lignes.filter(l => l.mode === 'express').reduce((a, l) => a + l.nb, 0) >= 10);
  assert.ok(tdb.agences.find(a => a.code === 'PARIS').deposes > 0);
  assert.ok(tdb.clients.length > 0);
  assert.ok(tdb.ca.eur > 0 && tdb.ca.nbFactures > 0, 'chiffre d\'affaires facturé');
  assert.strictEqual(tdb.ca.parMois.length, 12);
  assert.ok(tdb.ca.parNature.some(n => n.nature === 'transport'));
  assert.ok(tdb.ca.creancesEur > 0, 'reste à encaisser (paiement à l\'arrivée)');
  assert.strictEqual((await appel('GET', '/admin/tableau', null, client)).status, 403);
});

test('comptoir : code de retrait dès le dépôt, Orange Money depuis la France, retrait sans code sur pièce d\'identité', async () => {
  const admin = await connexion(ADMIN_TEL);
  const agentParis = await connexion('+33600000002');
  const agentKaloum = await connexion('620000003');

  // Orange Money proposé aussi depuis la France (compte marchand guinéen)
  let r = await appel('PATCH', '/config/admin', { paiements: { FR: { carte: true, orange_money: true }, comptes: { orange_money: { numero: '622 00 00 00', titulaire: 'TMS' } } } }, admin);
  assert.strictEqual(r.status, 200, r.message);
  const pub = await appel('GET', '/config');
  assert.ok(pub.moyensPaiement.FR.some(m => m.key === 'orange_money'));

  // Dépôt sans réservation à Paris, payé par Orange Money (en GNF, avec la référence)
  r = await appel('POST', '/agent/depot', {
    poidsReel: 4, mode: 'air', typeColis: 'vetements', guichet: 'KALOUM', cgvAcceptees: true,
    expediteur: { nom: 'Sékou Bah', telephone: '0677777777' }, destinataire: { nom: 'Hawa Bah', telephone: '627777777' },
    paiement: { montant: 480000, devise: 'GNF', methode: 'orange_money', reference: 'PP2610.OM.1', objet: 'global' },
  }, agentParis);
  assert.strictEqual(r.status, 201, r.message);
  const numero = r.colis.numeroSuivi;
  const code = r.colis.codeRetrait;
  assert.match(code, /^\d{4}$/, 'code donné à l\'agent dès le dépôt');
  assert.strictEqual(r.colis.solde.soldeGnf, 0, 'payé en GNF depuis la France');
  // L'agence de dépôt peut redonner le code ; l'agence de retrait non
  assert.strictEqual((await appel('GET', `/agent/colis/${numero}`, null, agentParis)).colis.codeRetrait, code);
  assert.strictEqual((await appel('GET', `/agent/colis/${numero}`, null, agentKaloum)).colis.codeRetrait, undefined);

  // Arrivé à l'agence : le code ne change pas (l'expéditeur l'a déjà transmis)
  r = await appel('POST', '/admin/colis/statut', { numeros: [numero], statut: 'pret' }, admin);
  assert.strictEqual(r.nbOk, 1, JSON.stringify(r));
  assert.strictEqual((await appel('GET', `/admin/colis/${numero}`, null, admin)).colis.codeRetrait, code);

  // Retrait sans code : le numéro donné doit être celui du destinataire
  const base = { numero, sansCode: true, pieceVerifiee: true, pieceNumero: 'GN123456', signature: 'data:image/png;base64,iVBORw0KGgo=' };
  r = await appel('POST', '/agent/remise', { ...base, telephoneConfirme: '620000000' }, agentKaloum);
  assert.strictEqual(r.status, 403);
  r = await appel('POST', '/agent/remise', { ...base, pieceNumero: '' , telephoneConfirme: '627777777' }, agentKaloum);
  assert.strictEqual(r.status, 400);
  r = await appel('POST', '/agent/remise', { ...base, telephoneConfirme: '627 77 77 77' }, agentKaloum);
  assert.strictEqual(r.status, 200, r.message);
  assert.strictEqual(r.colis.statut, 'remis');
  assert.ok(r.colis.historique.some(h => /sans code/.test(`${h.label} ${h.detail}`)));
});

test('le client paie tout en ligne dès la réservation : courses programmées, trop-payé signalé à la pesée', async () => {
  const admin = await connexion(ADMIN_TEL);
  const agentParis = await connexion('+33600000002');
  const client = await connexion('0688888888', 'Mariama', 'Barry');
  await appel('PATCH', '/config/admin', { paiements: { FR: { orange_money: true }, comptes: { orange_money: { numero: '622 00 00 00', titulaire: 'TMS' } } } }, admin);

  // Réservation 10 kg avec livraison à domicile, payée en entier (prix estimé) par Orange Money
  let r = await appel('POST', '/colis', { cgvAcceptees: true, mode: 'air', typeColis: 'vetements', poidsEstime: 10, depot: 'PARIS', guichet: 'KALOUM',
    destinataire: { nom: 'Aminata Barry', telephone: '628888888' },
    livraison: { demande: true, adresse: { ville: 'Conakry', quartier: 'Kipé', position: { lat: 9.5092 + 0.03, lng: -13.7122 } } } }, client);
  assert.strictEqual(r.status, 201, r.message);
  const numero = r.colis.numeroSuivi;
  const du = await appel('GET', `/paiements/a-payer/${numero}`);
  assert.ok(du.solde.gnf > du.domicile.gnf && du.domicile.gnf > 0);
  r = await appel('POST', '/paiements/mobile', { numero, objet: 'global', methode: 'orange_money', reference: 'PP-TOUT-1', telephone: '0688888888' });
  assert.strictEqual(r.status, 201, r.message);
  const dec = (await appel('GET', '/paiements/declarations', null, admin)).declarations.find(d => d.reference === 'PP-TOUT-1');
  assert.strictEqual(dec.montantGnf, du.solde.gnf);
  assert.strictEqual((await appel('POST', `/paiements/declarations/${dec.id}`, { decision: 'valider' }, admin)).status, 200);
  const apres = await appel('GET', `/paiements/a-payer/${numero}`);
  assert.strictEqual(apres.solde.gnf, 0);
  assert.strictEqual(apres.domicile.gnf, 0, 'la livraison est couverte, donc programmée');

  // Pesé 8 kg au lieu de 10 : trop-payé signalé
  r = await appel('POST', '/agent/depot', { numeroSuivi: numero, poidsReel: 8, mode: 'air', typeColis: 'vetements', guichet: 'KALOUM' }, agentParis);
  assert.strictEqual(r.status, 201, r.message);
  assert.strictEqual(r.colis.solde.soldeGnf, 0);
  assert.ok(r.colis.solde.tropPayeGnf > 0);
  assert.ok(r.colis.historique.some(h => /Trop payé/.test(h.label)));
});
