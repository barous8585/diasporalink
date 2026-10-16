// ─────────────────────────────────────────────────────────────
//  Agences mal placées : au démarrage, une agence dont la position n'est pas dans
//  son pays (ex. position prise avec « Je suis à l'agence » depuis la France pour
//  une agence de Conakry) est replacée d'après son adresse écrite, sa commune et sa
//  ville. Si l'adresse est introuvable, la position fausse est retirée : mieux vaut
//  « pas de prix » qu'un prix calculé depuis le mauvais pays.
// ─────────────────────────────────────────────────────────────
const Config = require('../models/Config');
const { pointDansPays, pointValide, distanceKm } = require('../utils/tarif');
const ECART_MAX_KM = 25; // position à plus de 25 km de l'adresse écrite : c'est la position qui est fausse
const pause = (ms) => new Promise(r => setTimeout(r, ms));
const { geocoder } = require('../services/geoService');

async function placerAgence(a) {
  return geocoder({ rue: a.adresse, quartier: a.commune || a.nom?.replace(/^agence\s+/i, ''), ville: a.ville, pays: a.pays });
}

async function corrigerAgences() {
  const doc = await Config.findOne();
  if (!doc?.agences?.length) return [];
  const bilan = [];
  for (const a of doc.agences) {
    if (!pointValide(a.position)) continue;
    if (!pointDansPays(a.position, a.pays)) {
      // Position dans un autre pays : replacée d'après l'adresse, ou retirée
      const p = await placerAgence(a);
      a.position = p ? { lat: p.lat, lng: p.lng } : undefined;
      bilan.push(`${a.code} : ${p ? `replacée d'après l'adresse (${p.trouve || `${p.lat}, ${p.lng}`})` : 'position fausse retirée (adresse introuvable)'}`);
    } else if (String(a.adresse || '').trim().length >= 6) {
      // Bon pays mais loin de l'adresse écrite (ex. agence de Paris placée à Angers) : l'adresse fait foi
      const p = await placerAgence(a);
      const ecart = p ? distanceKm(a.position, p) : 0;
      if (p && ecart > ECART_MAX_KM) {
        a.position = { lat: p.lat, lng: p.lng };
        bilan.push(`${a.code} : était à ${Math.round(ecart)} km de son adresse, replacée (${p.trouve || `${p.lat}, ${p.lng}`})`);
      }
    } else continue;
    await pause(1100); // OpenStreetMap : une recherche par seconde au plus
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
