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
