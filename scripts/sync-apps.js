// Copie les fichiers communs dans chaque app (chaque app est publiée seule sur Netlify).
// Usage : npm run sync-apps
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const fichiers = [
  ['shared/kolis.css', 'commun/kolis.css'],
  ['shared/kolis.js', 'commun/kolis.js'],
  ['utils/tarif.js', 'commun/tarif.js'],
  ['shared/img/logo.png', 'commun/logo.png'],
  ['shared/img/embleme.png', 'commun/embleme.png'],
];

for (const app of ['frontend', 'agent', 'admin']) {
  fs.mkdirSync(path.join(racine, app, 'commun'), { recursive: true });
  for (const [src, dst] of fichiers) {
    fs.copyFileSync(path.join(racine, src), path.join(racine, app, dst));
  }
  console.log(`✓ ${app}/commun`);
}
