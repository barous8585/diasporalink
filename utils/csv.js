// CSV lisible par Excel en français : séparateur « ; », virgule décimale, BOM UTF-8
// Une cellule qui commence par = + - @ serait exécutée comme formule par Excel : on la neutralise
const neutraliser = (t) => (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t) ? `'${t}` : t);
const cell = (s) => `"${neutraliser(String(s ?? '')).replace(/"/g, '""')}"`;
const nombre = (x) => (x === undefined || x === null || x === '' ? '' : String(Math.round(Number(x) * 100) / 100).replace('.', ','));
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '');
const heureFr = (d) => (d ? new Date(d).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) : '');
function versCsv(entetes, lignes) {
  return '﻿' + [entetes.map(cell).join(';'), ...lignes.map(l => l.map(v => (typeof v === 'number' ? nombre(v) : cell(v))).join(';'))].join('\r\n');
}
function envoyerCsv(res, nom, entetes, lignes) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
  res.send(versCsv(entetes, lignes));
}
module.exports = { versCsv, envoyerCsv, dateFr, heureFr, nombre };
