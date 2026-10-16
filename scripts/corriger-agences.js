// ─────────────────────────────────────────────────────────────
//  Agences mal placées : au démarrage, une agence dont la position n'est pas dans
//  son pays (ex. position prise avec « Je suis à l'agence » depuis la France pour
//  une agence de Conakry) est replacée d'après son adresse écrite, sa commune et sa
//  ville. Si l'adresse est introuvable, la position fausse est retirée : mieux vaut
//  « pas de prix » qu'un prix calculé depuis le mauvais pays.
// ─────────────────────────────────────────────────────────────
const Config = require('../models/Config');
const { pointDansPays, pointValide } = require('../utils/tarif');
const { geocoder } = require('../services/geoService');

async function placerAgence(a) {
  return geocoder({ rue: a.adresse, quartier: a.commune || a.nom?.replace(/^agence\s+/i, ''), ville: a.ville, pays: a.pays });
}

async function corrigerAgences() {
  const doc = await Config.findOne();
  if (!doc?.agences?.length) return [];
  const bilan = [];
  for (const a of doc.agences) {
    if (!pointValide(a.position) || pointDansPays(a.position, a.pays)) continue;
    const p = await placerAgence(a);
    a.position = p ? { lat: p.lat, lng: p.lng } : undefined;
    bilan.push(`${a.code} : ${p ? `replacée d'après l'adresse (${p.trouve || `${p.lat}, ${p.lng}`})` : 'position fausse retirée (adresse introuvable)'}`);
  }
  if (bilan.length) {
    doc.markModified('agences');
    await doc.save();
    Config.invalider();
    console.log('📍 Agences corrigées :', bilan.join(' · '));
  }
  return bilan;
}

module.exports = { corrigerAgences, placerAgence };
