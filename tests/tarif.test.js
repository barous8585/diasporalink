const test = require('node:test');
const assert = require('node:assert');
const { calculerTarif, calculerMagasinage, calculerSolde } = require('../utils/tarif');
const { CONFIG_DEFAUT } = require('../config/constants');

const config = { ...CONFIG_DEFAUT, tauxEurGnf: 10000 };

test('France → Guinée en avion : prix au kilo en € et supplément électronique', () => {
  const t = calculerTarif(config, { sens: 'FR-GN', mode: 'air', poidsKg: 5, typeColis: 'electronique' });
  assert.strictEqual(t.devise, 'EUR');
  assert.strictEqual(t.transport, 60);
  assert.strictEqual(t.surcharge, 9);
  assert.strictEqual(t.totalEur, 69);
  assert.strictEqual(t.total, 69);
  assert.strictEqual(t.totalGnf, 690000);
});

test('sens par défaut : France → Guinée', () => {
  const t = calculerTarif(config, { mode: 'air', poidsKg: 1, typeColis: 'mixte' });
  assert.strictEqual(t.sens, 'FR-GN');
});

test('Guinée → France : prix en GNF, équivalent en €', () => {
  const t = calculerTarif(config, { sens: 'GN-FR', mode: 'air', poidsKg: 3, typeColis: 'alimentaire' });
  assert.strictEqual(t.devise, 'GNF');
  assert.strictEqual(t.totalGnf, 360000);
  assert.strictEqual(t.total, 360000);
  assert.strictEqual(t.totalEur, 36);
});

test('bateau : poids minimum facturé', () => {
  const t = calculerTarif(config, { sens: 'FR-GN', mode: 'mer', poidsKg: 3, typeColis: 'vetements' });
  assert.strictEqual(t.poidsFacture, 10);
  assert.strictEqual(t.totalEur, 40);
});

test('assurance seulement si demandée', () => {
  const sans = calculerTarif(config, { mode: 'air', poidsKg: 1, typeColis: 'mixte', valeurDeclaree: 1000 });
  const avec = calculerTarif(config, { mode: 'air', poidsKg: 1, typeColis: 'mixte', valeurDeclaree: 1000, assurance: true });
  assert.strictEqual(sans.assurance, 0);
  assert.strictEqual(avec.assurance, 23);
});

test('GNF arrondi aux 500 supérieurs', () => {
  const t = calculerTarif({ ...config, tauxEurGnf: 9876 }, { mode: 'air', poidsKg: 1, typeColis: 'mixte' });
  assert.strictEqual(t.totalGnf % 500, 0);
  assert.ok(t.totalGnf >= 12 * 9876);
});

test('sens inconnu refusé', () => {
  assert.throws(() => calculerTarif(config, { sens: 'FR-SN', mode: 'air', poidsKg: 1 }));
});

test('garde en Guinée : gratuit puis payant en GNF', () => {
  const arrive = new Date('2026-09-01T10:00:00Z');
  const m5 = calculerMagasinage(config, arrive, new Date('2026-09-06T10:00:00Z'));
  assert.strictEqual(m5.fraisGnf, 0);
  const m13 = calculerMagasinage(config, arrive, new Date('2026-09-14T10:00:00Z'));
  assert.strictEqual(m13.joursFactures, 3);
  assert.strictEqual(m13.fraisGnf, 15000);
});

test('garde en France : tarif en € converti au taux du colis', () => {
  const arrive = new Date('2026-09-01T10:00:00Z');
  const m = calculerMagasinage(config, arrive, new Date('2026-09-14T10:00:00Z'), { pays: 'FR', taux: 10000 });
  assert.strictEqual(m.fraisGnf, 3 * 10000);
});

test('solde : paiements en EUR et GNF au taux figé du colis', () => {
  const colis = {
    tarif: { totalGnf: 690000, taux: 10000 },
    fraisDouaneGnf: 45000,
    paiements: [{ montant: 69, devise: 'EUR' }, { montant: 20000, devise: 'GNF' }],
  };
  const s = calculerSolde(colis, config);
  assert.strictEqual(s.duGnf, 735000);
  assert.strictEqual(s.soldeGnf, 25000);
});

// ── Courses à domicile ──
const { calculerCourse, distanceKm } = require('../utils/tarif');
const kaloum = { code: 'KALOUM', nom: 'Agence Kaloum', pays: 'GN', position: { lat: 9.5092, lng: -13.7122 } };
const paris = { code: 'PARIS', nom: 'Agence Paris', pays: 'FR', position: { lat: 48.8925, lng: 2.3484 } };

test('distance à vol d\'oiseau', () => {
  const d = distanceKm(kaloum.position, { lat: 9.5092 + 0.09, lng: -13.7122 }); // ≈ 10 km au nord
  assert.ok(d > 9.9 && d < 10.1, d);
});

test('course en Guinée : base + km par la route, arrondi au millier', () => {
  const c = calculerCourse(config, kaloum, { lat: 9.5092 + 0.045, lng: -13.7122 }); // 5 km → 6,5 km par la route
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.devise, 'GNF');
  assert.strictEqual(c.distanceKm, 6.5);
  assert.strictEqual(c.prix, 23000); // 10 000 + 2 000 × 6,5
  assert.strictEqual(c.prixGnf, 23000);
});

test('course en France : en €, arrondi au demi-euro, converti en GNF', () => {
  const c = calculerCourse(config, paris, { lat: 48.8925 + 0.027, lng: 2.3484 }); // 3 km → 3,9 km
  assert.strictEqual(c.devise, 'EUR');
  assert.strictEqual(c.prix, 12); // 8 + 3,9 = 11,9 → 12
  assert.strictEqual(c.prixGnf, 120000);
});

test('course : plafond, trop loin, agence sans position', () => {
  const cfg = { ...config, domicile: { ...config.domicile, GN: { ...config.domicile.GN, plafond: 20000 } } };
  assert.strictEqual(calculerCourse(cfg, kaloum, { lat: 9.5092 + 0.09, lng: -13.7122 }).prix, 20000);
  assert.strictEqual(calculerCourse(config, kaloum, { lat: 10.5, lng: -13.7 }).raison, 'trop_loin');
  assert.strictEqual(calculerCourse(config, { ...kaloum, position: null }, { lat: 9.6, lng: -13.7 }).raison, 'agence_sans_position');
  assert.strictEqual(calculerCourse(config, kaloum, null).raison, 'sans_position');
});

test('solde : la livraison à domicile s\'ajoute, sauf annulée', () => {
  const colis = { tarif: { totalGnf: 100000, taux: 10000 }, paiements: [], livraison: { demande: true, prixGnf: 23000, statut: 'a_planifier' } };
  assert.strictEqual(calculerSolde(colis, config).soldeGnf, 123000);
  colis.livraison.statut = 'annulee';
  assert.strictEqual(calculerSolde(colis, config).soldeGnf, 100000);
});

test('articles à la pièce : prix fixe, poids forfaitaire retiré de la pesée', () => {
  // 7 kg sur la balance dont 2 paires de chaussures (2 × 1,5 kg) : 4 kg au kilo
  const t = calculerTarif(config, { sens: 'FR-GN', mode: 'air', poidsKg: 7, typeColis: 'vetements', articles: [{ cle: 'chaussures', quantite: 2 }] });
  assert.strictEqual(t.poidsArticles, 3);
  assert.strictEqual(t.poidsFacture, 4);
  assert.strictEqual(t.transport, 48);
  assert.strictEqual(t.articlesTotal, 30);
  assert.deepStrictEqual(t.articles.map(a => [a.cle, a.quantite, a.montant]), [['chaussures', 2, 30]]);
  assert.strictEqual(t.totalEur, 78);
});

test('articles seuls : pas de minimum au kilo, supplément seulement sur le kilo', () => {
  const t = calculerTarif(config, { sens: 'FR-GN', mode: 'mer', poidsKg: 0.5, typeColis: 'electronique', articles: [{ cle: 'telephone', quantite: 1 }] });
  assert.strictEqual(t.poidsFacture, 0);
  assert.strictEqual(t.transport, 0);
  assert.strictEqual(t.surcharge, 0);
  assert.strictEqual(t.totalEur, 15);
});

test('articles : inconnus ou sans prix ignorés, GNF dans le sens Guinée → France', () => {
  const cfg = { ...config, articles: [...config.articles, { cle: 'velo', label: 'Vélo', poids: 10, prix: { 'FR-GN': { mer: 40 } } }] };
  const t = calculerTarif(cfg, { sens: 'GN-FR', mode: 'air', poidsKg: 2, typeColis: 'mixte', articles: [{ cle: 'inconnu', quantite: 3 }, { cle: 'velo', quantite: 1 }, { cle: 'parfum', quantite: 2 }] });
  assert.deepStrictEqual(t.articles.map(a => a.cle), ['parfum']);
  assert.strictEqual(t.poidsFacture, 1);
  assert.strictEqual(t.totalGnf, 120000 + 200000);
});

test('courses à domicile payées d\'avance : restent dues si annulées, prix monté = reste à payer', () => {
  const { fraisDomicileGnf, domicileAPayerGnf } = require('../utils/tarif');
  const liv = { demande: true, statut: 'a_planifier', prixGnf: 30000, payeGnf: 30000 };
  assert.strictEqual(domicileAPayerGnf({ livraison: liv }), 0);
  assert.strictEqual(fraisDomicileGnf({ livraison: { ...liv, demande: false, statut: 'annulee' } }), 30000);
  assert.strictEqual(fraisDomicileGnf({ livraison: { ...liv, payeGnf: 0, demande: false, statut: 'annulee' } }), 0);
  assert.strictEqual(domicileAPayerGnf({ livraison: { ...liv, prixGnf: 40000 } }), 10000);
  assert.strictEqual(fraisDomicileGnf({ livraison: { ...liv, prixGnf: 20000 } }), 30000, 'adresse plus proche : pas de remboursement');
});

// ── Courses à domicile : distances, pays, positions ──────────
const { pointDansPays, paysDuPoint } = require('../utils/tarif');
const { positionDepuisTexte } = require('../services/domicileService');
const KALOUM = { code: 'KALOUM', nom: 'Agence Kaloum', pays: 'GN', position: { lat: 9.5092, lng: -13.7122 } };
const PARIS = { code: 'PARIS', nom: 'Agence Paris 18e', pays: 'FR', position: { lat: 48.8925, lng: 2.3484 } };
const confDom = { ...config, domicile: { majoration: 1.3, GN: { actif: true, base: 10000, parKm: 2000, plafond: 0, rayonMaxKm: 40 }, FR: { actif: true, base: 8, parKm: 1, plafond: 0, rayonMaxKm: 60 } } };

test('distance à vol d\'oiseau : valeurs connues', () => {
  // 0,045° de latitude ≈ 5,0 km
  assert.ok(Math.abs(distanceKm({ lat: 9.5092, lng: -13.7122 }, { lat: 9.5542, lng: -13.7122 }) - 5.004) < 0.01);
  // Paris centre → Saint-Denis ≈ 8,9 km
  assert.ok(Math.abs(distanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 48.9362, lng: 2.3574 }) - 8.86) < 0.05);
  // Paris → Conakry ≈ 4 600 km
  const pc = distanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 9.537, lng: -13.677 });
  assert.ok(pc > 4500 && pc < 4700, String(pc));
});

test('positions : dans quel pays ?', () => {
  assert.strictEqual(paysDuPoint({ lat: 9.537, lng: -13.677 }), 'GN');   // Conakry
  assert.strictEqual(paysDuPoint({ lat: 11.318, lng: -12.283 }), 'GN');  // Labé
  assert.strictEqual(paysDuPoint({ lat: 10.386, lng: -9.305 }), 'GN');   // Kankan
  assert.strictEqual(paysDuPoint({ lat: 47.4614, lng: -0.5473 }), 'FR'); // Angers
  assert.strictEqual(paysDuPoint({ lat: 43.2965, lng: 5.3698 }), 'FR');  // Marseille
  assert.strictEqual(paysDuPoint({ lat: 14.69, lng: -17.44 }), null);    // Dakar
  assert.strictEqual(paysDuPoint({ lat: 0, lng: 0 }), null);
  assert.ok(!pointDansPays({ lat: 47.4614, lng: -0.5473 }, 'GN'));
});

test('course : agence de Conakry placée en France → pas de prix faux', () => {
  const r = calculerCourse(confDom, { ...KALOUM, position: { lat: 47.461403, lng: -0.547412 } }, { lat: 9.55, lng: -13.65 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.raison, 'agence_mal_placee');
});

test('course : client pointé dans le mauvais pays', () => {
  const r = calculerCourse(confDom, KALOUM, { lat: 48.85, lng: 2.35 });
  assert.strictEqual(r.raison, 'hors_pays');
  assert.match(r.message, /en France, pas en Guinée/);
  assert.strictEqual(calculerCourse(confDom, PARIS, { lat: 9.55, lng: -13.65 }).raison, 'hors_pays');
});

test('course : distance par la route prioritaire, sinon estimation × 1,3, arrondis', () => {
  const client = { lat: 9.5542, lng: -13.7122 }; // 5,0 km à vol d'oiseau
  const est = calculerCourse(confDom, KALOUM, client);
  assert.strictEqual(est.ok, true);
  assert.strictEqual(est.methode, 'estimation');
  assert.strictEqual(est.distanceKm, 6.5);                 // 5,0 × 1,3
  assert.strictEqual(est.prix, 23000);                    // 10 000 + 2 000 × 6,5, au millier supérieur
  const route = calculerCourse(confDom, KALOUM, client, { routeKm: 7.84 });
  assert.strictEqual(route.methode, 'route');
  assert.strictEqual(route.distanceKm, 7.8);
  assert.strictEqual(route.prix, 26000);                  // 10 000 + 15 600 → 26 000
  assert.strictEqual(route.volOiseauKm, 5);
  // France : demi-euro supérieur
  const fr = calculerCourse(confDom, PARIS, { lat: 48.9362, lng: 2.3574 }, { routeKm: 6.3 });
  assert.strictEqual(fr.prix, 14.5);                      // 8 + 6,3 = 14,3 → 14,5
  assert.strictEqual(fr.devise, 'EUR');
  // Même point que l'agence : distance minimale, pas zéro
  assert.strictEqual(calculerCourse(confDom, KALOUM, KALOUM.position).distanceKm, 0.1);
});

test('course : rayon maximum et plafond', () => {
  const loin = calculerCourse(confDom, KALOUM, { lat: 10.05, lng: -13.7 }); // ~60 km
  assert.strictEqual(loin.raison, 'trop_loin');
  assert.match(loin.message, /maximum 40 km/);
  const plaf = calculerCourse({ ...confDom, domicile: { ...confDom.domicile, GN: { ...confDom.domicile.GN, plafond: 30000 } } }, KALOUM, { lat: 9.6, lng: -13.65 }, { routeKm: 25 });
  assert.strictEqual(plaf.prix, 30000);
});

test('liens de position : Google Maps, WhatsApp, coordonnées', () => {
  const ok = (t, lat, lng) => { const p = positionDepuisTexte(t); assert.ok(p, t); assert.ok(Math.abs(p.lat - lat) < 1e-4 && Math.abs(p.lng - lng) < 1e-4, t); };
  ok('https://www.google.com/maps/place/Kip%C3%A9/@9.6418,-13.6078,17z', 9.6418, -13.6078);
  ok('https://www.google.com/maps/place/X/data=!3d9.6411!4d-13.6071', 9.6411, -13.6071);
  ok('https://maps.google.com/?q=9.5401,-13.6801', 9.5401, -13.6801);
  ok('9.5401, -13.6801', 9.5401, -13.6801);
  ok('Ma position : 9.540112,-13.680134 envoyée', 9.540112, -13.680134);
  assert.strictEqual(positionDepuisTexte('rue sans coordonnées'), null);
});

// ── Belgique ⇄ Guinée ──
const tarifs = require('../utils/tarif');
test('Belgique → Guinée : prix en €, articles repris de la France tant qu\'ils ne sont pas fixés', () => {
  const t = calculerTarif(config, { sens: 'BE-GN', mode: 'air', poidsKg: 5, typeColis: 'vetements', articles: [{ cle: 'chaussures', quantite: 2 }] });
  assert.strictEqual(t.devise, 'EUR');
  assert.strictEqual(t.sens, 'BE-GN');
  assert.strictEqual(t.articlesTotal, 30);       // 2 × 15 € (prix France → Guinée)
  const g = calculerTarif(config, { sens: 'GN-BE', mode: 'air', poidsKg: 3, typeColis: 'alimentaire' });
  assert.strictEqual(g.devise, 'GNF');
  assert.strictEqual(g.totalGnf, 360000);
  // Prix belge propre : il remplace celui de la France
  const art = { cle: 'x', prix: { 'FR-GN': { air: 15 }, 'BE-GN': { air: 18 } } };
  assert.strictEqual(tarifs.prixArticle(art, 'BE-GN', 'air'), 18);
  assert.strictEqual(tarifs.prixArticle({ prix: { 'FR-GN': { air: 15 } } }, 'BE-GN', 'air'), 15);
  assert.strictEqual(tarifs.prixArticle({ prix: { 'FR-GN': { air: 15 } } }, 'BE-GN', 'express'), 15, 'express : prix avion');
});

test('Belgique : garde en €, monnaie, zone sur la carte, courses à domicile', () => {
  const m = calculerMagasinage({ ...config, magasinage: { joursGratuits: 10, fraisJourEur: 1 } }, new Date('2026-10-01'), new Date('2026-10-14'), { pays: 'BE', taux: 10000 });
  assert.strictEqual(m.fraisGnf, 30000); // 3 jours × 1 € au taux 10 000
  assert.strictEqual(tarifs.devisePays('BE'), 'EUR');
  assert.strictEqual(tarifs.paysDuPoint({ lat: 50.8503, lng: 4.3517 }), 'BE'); // Bruxelles
  assert.strictEqual(tarifs.paysDuPoint({ lat: 51.2194, lng: 4.4025 }), 'BE'); // Anvers
  assert.strictEqual(tarifs.paysDuPoint({ lat: 48.8566, lng: 2.3522 }), 'FR'); // Paris
  const BXL = { code: 'BRUXELLES', nom: 'Agence Bruxelles', pays: 'BE', position: { lat: 50.8467, lng: 4.3525 } };
  const dom = { ...confDom, domicile: { ...confDom.domicile, BE: { actif: true, base: 8, parKm: 1, plafond: 0, rayonMaxKm: 60 } } };
  const c = calculerCourse(dom, BXL, { lat: 50.8333, lng: 4.3667 }, { routeKm: 3.2 });
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.devise, 'EUR');
  assert.strictEqual(c.prix, 11.5); // 8 + 3,2 → 11,2 → 11,5
  assert.strictEqual(calculerCourse(dom, BXL, { lat: 9.55, lng: -13.65 }).raison, 'hors_pays');
});

test('téléphones belges', () => {
  const { normTel } = require('../services/colisService');
  assert.strictEqual(normTel('0478 12 34 56', 'BE'), '+32478123456');
  assert.strictEqual(normTel('0478123456'), '+33478123456', 'sans pays : numéro français');
  assert.strictEqual(normTel('+32 478 12 34 56'), '+32478123456');
  assert.strictEqual(normTel('0032478123456'), '+32478123456');
  assert.strictEqual(normTel('02 123 45 67'), '+3221234567', 'fixe belge à 9 chiffres');
  assert.strictEqual(normTel('06 12 34 56 78', 'BE'), '+33612345678', 'mobile français reste français');
  assert.strictEqual(normTel('622 11 22 33', 'BE'), '+224622112233');
});
