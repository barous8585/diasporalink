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
