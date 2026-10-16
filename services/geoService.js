// ─────────────────────────────────────────────────────────────
//  Géographie côté serveur : distance par la route et adresse → position
//
//  Distance : itinéraire routier calculé par OSRM (données OpenStreetMap). Si le service
//  ne répond pas (ou renvoie un résultat absurde), on retombe sur l'estimation
//  vol d'oiseau × majoration : une réservation n'est jamais bloquée par la carte.
//  Adresse : Nominatim (OpenStreetMap), limité au pays de l'agence et à ses environs.
// ─────────────────────────────────────────────────────────────
const { distanceKm, pointValide, pointDansPays, ZONES_PAYS } = require('../utils/tarif');

const OSRM = (process.env.ITINERAIRE_URL ?? 'https://router.project-osrm.org').replace(/\/$/, '');
const NOMINATIM = (process.env.GEOCODAGE_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const AGENT = 'TalibMultiServices/1.0 (expedition France-Guinee)';

// Cache mémoire : mêmes points (à ~10 m près) → même distance, sans rappeler le service
const cacheRoutes = new Map();
const cle = (a, b) => [a.lat, a.lng, b.lat, b.lng].map(x => (+x).toFixed(4)).join(',');

/**
 * Distance en km par la route entre deux points, ou null si indisponible.
 * Résultat écarté s'il est incohérent (plus court que le vol d'oiseau, ou plus de 3 fois
 * plus long : point « accroché » à une mauvaise route, de l'autre côté de l'eau…).
 */
async function distanceRoute(a, b, { delai = 4000 } = {}) {
  if (!OSRM || !pointValide(a) || !pointValide(b)) return null;
  const k = cle(a, b);
  if (cacheRoutes.has(k)) return cacheRoutes.get(k);
  let km = null;
  try {
    const url = `${OSRM}/route/v1/driving/${(+a.lng).toFixed(6)},${(+a.lat).toFixed(6)};${(+b.lng).toFixed(6)},${(+b.lat).toFixed(6)}?overview=false&alternatives=false&steps=false`;
    const r = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(delai) });
    if (r.ok) {
      const j = await r.json();
      const m = j?.code === 'Ok' ? j.routes?.[0]?.distance : null;
      if (Number.isFinite(m)) {
        const route = m / 1000;
        const vol = distanceKm(a, b);
        if (route >= vol * 0.95 && route <= vol * 3 + 2) km = Math.round(route * 10) / 10;
      }
    }
  } catch { /* service injoignable : estimation */ }
  if (cacheRoutes.size > 5000) cacheRoutes.clear();
  if (km !== null) cacheRoutes.set(k, km);
  return km;
}

/**
 * Adresse écrite → { lat, lng, precision, source: 'adresse', trouve } dans le pays donné.
 * pres : position de référence (l'agence) pour chercher d'abord autour d'elle (~50 km).
 */
async function geocoder({ rue, quartier, ville, pays, pres } = {}, { delai = 6000 } = {}) {
  if (!NOMINATIM || !ZONES_PAYS[pays]) return null;
  const nomPays = ZONES_PAYS[pays].nom;
  const villeDefaut = pays === 'GN' ? 'Conakry' : '';
  const essai = async (texte, autour) => {
    const p = new URLSearchParams({ format: 'json', limit: '1', 'accept-language': 'fr', countrycodes: pays.toLowerCase(), q: texte });
    if (autour && pointValide(autour)) {
      const d = 0.45; // ~50 km
      p.set('viewbox', [autour.lng - d, autour.lat + d, autour.lng + d, autour.lat - d].join(','));
      p.set('bounded', '1');
    }
    try {
      const r = await fetch(`${NOMINATIM}/search?${p}`, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(delai) });
      if (!r.ok) return null;
      const [lieu] = await r.json();
      if (!lieu) return null;
      const pt = { lat: Math.round(parseFloat(lieu.lat) * 1e6) / 1e6, lng: Math.round(parseFloat(lieu.lon) * 1e6) / 1e6 };
      if (!pointDansPays(pt, pays)) return null;
      return { ...pt, precision: rue ? 150 : 800, source: 'adresse', trouve: String(lieu.display_name || '').split(',').slice(0, 3).join(',').trim() };
    } catch { return null; }
  };
  const complet = [rue, quartier, ville || villeDefaut, nomPays].filter(Boolean).join(', ');
  const sansRue = [quartier, ville || villeDefaut, nomPays].filter(Boolean).join(', ');
  return (pres && await essai(complet, pres))
    || await essai(complet)
    || (rue && quartier && ((pres && await essai(sansRue, pres)) || await essai(sansRue)))
    || null;
}

module.exports = { distanceRoute, geocoder };
