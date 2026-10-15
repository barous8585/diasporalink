// ─────────────────────────────────────────────────────────────
//  Temps réel : prévient les apps ouvertes qu'une donnée a changé
//  (« maj »), pour qu'elles se rafraîchissent seules. Aucun contenu
//  n'est envoyé : chaque app recharge ses données par l'API, avec ses droits.
//  Salles : admins · agence:CODE · pays:FR|GN (plateformes) · tel:+33… · user:id
// ─────────────────────────────────────────────────────────────
let io = null;
const enAttente = new Map(); // salle → minuterie (regroupe les rafales)

function brancher(serveurIo) { io = serveurIo; }
// Pendant une génération en masse (simulation), on se tait puis on prévient tout le monde une fois
let silence = false;
function taire(oui) { silence = !!oui; if (!oui && io) io.emit('maj', { type: 'colis' }); }

function prevenir(salles, type) {
  if (!io || silence) return;
  for (const salle of new Set(salles.filter(Boolean))) {
    if (enAttente.has(salle)) continue;
    enAttente.set(salle, setTimeout(() => { enAttente.delete(salle); io.to(salle).emit('maj', { type }); }, 400));
  }
}

// Un colis a changé : son agence de départ, de retrait, les plateformes des deux pays, ses clients, les admins
function colisChange(c) {
  if (!c) return;
  const [pd, pa] = String(c.sens || 'FR-GN').split('-');
  prevenir([
    'admins', `agence:${c.depot}`, `agence:${c.guichet}`, `pays:${pd}`, `pays:${pa}`,
    c.expediteur?.telephone && `tel:${c.expediteur.telephone}`, c.destinataire?.telephone && `tel:${c.destinataire.telephone}`,
    c.tiersAutorise?.telephone && `tel:${c.tiersAutorise.telephone}`, c.client && `user:${c.client}`,
  ], 'colis');
}
const adminsSeulement = (type) => () => prevenir(['admins'], type);
const lotChange = (l) => prevenir(['admins', `agence:${l?.depot}`, `agence:${l?.destination}`], 'lot');
const mouvementChange = (m) => prevenir(['admins', `agence:${m?.lieu}`, m?.agent && `user:${m.agent}`], 'caisse');
const reclamationChange = (r) => prevenir(['admins', r?.demandeur?.user && `user:${r.demandeur.user}`], 'reclamation');

module.exports = { brancher, taire, prevenir, colisChange, lotChange, mouvementChange, reclamationChange, adminsSeulement };
