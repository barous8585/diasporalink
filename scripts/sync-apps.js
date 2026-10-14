// Copie les fichiers communs dans chaque app (chaque app est publiée seule sur Netlify).
// Usage : npm run sync-apps
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const fichiers = [
  ['shared/kolis.css', 'commun/kolis.css'],
  ['shared/kolis.js', 'commun/kolis.js'],
  ['shared/legal.js', 'commun/legal.js'],
  ['utils/tarif.js', 'commun/tarif.js'],
  ['shared/img/logo.png', 'commun/logo.png'],
  ['shared/img/embleme.png', 'commun/embleme.png'],
  ['shared/img/badge-96.png', 'commun/badge-96.png'],
  ['shared/img/notif-256.png', 'commun/notif-256.png'],
  ['shared/img/apple-touch-icon.png', 'apple-touch-icon.png'],
  ['shared/sw-push.js', 'commun/sw-push.js'],
];

for (const app of ['frontend', 'agent', 'admin']) {
  fs.mkdirSync(path.join(racine, app, 'commun'), { recursive: true });
  for (const [src, dst] of fichiers) {
    fs.copyFileSync(path.join(racine, src), path.join(racine, app, dst));
  }
  // Bibliothèques auto-hébergées (scanner, QR, carte) : pas de dépendance à un CDN
  fs.cpSync(path.join(racine, 'shared/vendor'), path.join(racine, app, 'commun/vendor'), { recursive: true });
  console.log(`✓ ${app}/commun`);
}
