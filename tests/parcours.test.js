// Test de bout en bout de l'API.
// Nécessite une base MongoDB : MONGODB_URI=mongodb://127.0.0.1:27017/kolis_test npm run test:parcours
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 5099;
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
async function connexion(telephone, prenom, nom) {
  let r = await appel('POST', '/auth/connexion', { telephone, motDePasse: telephone === ADMIN_TEL ? ADMIN_MDP : MDP });
  if (r.status === 401 && prenom) r = await appel('POST', '/auth/inscription', { telephone, prenom, nom, motDePasse: MDP });
  assert.ok(r.token, r.message);
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
    env: { ...process.env, PORT, MONGODB_URI: uri, JWT_SECRET: 'test', NODE_ENV: 'development', ADMIN_TELEPHONES: ADMIN_TEL, ADMIN_MOT_DE_PASSE: ADMIN_MDP, AUTH_MODE: '' },
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
  const resa = await appel('POST', '/colis', {
    mode: 'air', typeColis: 'vetements', poidsEstime: 6, depot: 'PARIS', guichet: 'KALOUM',
    destinataire: { nom: 'Alpha Barry', telephone: '621000111' },
  }, client);
  assert.strictEqual(resa.status, 201, resa.message);
  const numero = resa.colis.numeroSuivi;
  assert.match(numero, /^TMS-\d{2}-\d{5}$/);
  assert.strictEqual(resa.colis.statut, 'reserve');

  // Dépôt : pesée (6,4 kg), paiement espèces en euros
  const dep = await appel('POST', '/agent/depot', {
    numeroSuivi: numero, poidsReel: 6.4,
    paiement: { montant: 76.8, devise: 'EUR', methode: 'especes', objet: 'transport' }, opId: 'dep-1',
  }, agentParis);
  assert.strictEqual(dep.status, 201, dep.message);
  assert.strictEqual(dep.colis.statut, 'depose');
  assert.strictEqual(dep.colis.tarif.totalEur, 76.8);
  assert.strictEqual(dep.colis.solde.soldeGnf, 0);
  assert.strictEqual(dep.ecartPoids, 0.4);
  // Rejouer la même opération ne crée pas de doublon
  const dep2 = await appel('POST', '/agent/depot', { numeroSuivi: numero, poidsReel: 6.4, opId: 'dep-1' }, agentParis);
  assert.ok(dep2.rejoue);

  // Dépôt sans réservation, en bateau, payé à l'arrivée
  const dep3 = await appel('POST', '/agent/depot', {
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
  const dep = await appel('POST', '/agent/depot', {
    poidsReel: 4, mode: 'air', typeColis: 'vetements', guichet: 'LABE',
    expediteur: { nom: 'Saliou Diallo', telephone: '0611111111' },
    destinataire: { nom: 'Kadiatou Bah', telephone: '625555555' },
    paiement: { montant: 48, devise: 'EUR', methode: 'especes' },
  }, agentParis);
  assert.strictEqual(dep.status, 201, dep.message);
  assert.strictEqual(dep.colis.sens, 'FR-GN');
  const numero = dep.colis.numeroSuivi;

  // Une agence de retrait dans le même pays que le départ est refusée
  const memePays = await appel('POST', '/agent/depot', {
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
  const retour = await appel('POST', '/agent/depot', {
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
