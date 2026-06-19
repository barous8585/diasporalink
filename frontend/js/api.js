// ── CONFIG ─────────────────────────────────────────────────
const API_URL = 'https://diasporalink-api.onrender.com/api';

// ── HELPERS ────────────────────────────────────────────────
const getToken = () => localStorage.getItem('dl_token');
const setToken = (t) => localStorage.setItem('dl_token', t);
const getUser  = () => JSON.parse(localStorage.getItem('dl_user') || 'null');
const setUser  = (u) => localStorage.setItem('dl_user', JSON.stringify(u));
const clear    = () => {
  localStorage.removeItem('dl_token');
  localStorage.removeItem('dl_user');
};

async function request(method, path, body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);
  let data = {};
  try { data = await res.json(); } catch(e) {}
  if (!res.ok) {
    const msg = data.message
      || data.erreurs?.[0]?.msg
      || data.error
      || `Erreur ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ── AUTH ───────────────────────────────────────────────────
const Auth = {
  // N'envoie prenom/nom que s'ils sont définis
  envoyerOTP: (telephone, prenom, nom) => {
    const body = { telephone };
    if (prenom) body.prenom = prenom;
    if (nom)    body.nom    = nom;
    return request('POST', '/auth/envoyer-otp', body, false);
  },
  verifierOTP: async (telephone, code) => {
    const data = await request('POST', '/auth/verifier-otp', { telephone, code }, false);
    if (data.token) {
      setToken(data.token);
      setUser(data.utilisateur);
    }
    return data;
  },
  moi:         () => request('GET', '/auth/moi'),
  deconnecter: () => clear(),
  estConnecte: () => !!getToken(),
};

// ── COLIS ──────────────────────────────────────────────────
const Colis = {
  creer:       (data)                => request('POST', '/colis', data),
  mesColis:    ()                    => request('GET',  '/colis'),
  unColis:     (id)                  => request('GET',  `/colis/${id}`),
  suiviPublic: (num)                 => request('GET',  `/colis/suivi/${num}`, null, false),
  tarif:       (pays, poids, valeur) =>
    request('GET', `/colis/tarif?pays=${pays}&poids=${poids}&valeur=${valeur || 0}`, null, false),
};

// ── MESSAGES ───────────────────────────────────────────────
const Messages = {
  lire:    (colisId)        => request('GET',  `/messages/${colisId}`),
  envoyer: (colisId, texte) => request('POST', `/messages/${colisId}`, { texte }),
};

// ── CONFIG ─────────────────────────────────────────────────
const Config = {
  get: () => request('GET', '/config', null, false),
};

// ── UTILISATEUR ────────────────────────────────────────────
const Utilisateur = {
  profil:      ()     => request('GET',   '/utilisateurs/moi'),
  mettreAJour: (data) => request('PATCH', '/utilisateurs/moi', data),
};

// ── REMBOURSEMENTS ─────────────────────────────────────────
const Remboursements = {
  creer:       (colisId, motif, description) =>
    request('POST', '/remboursements', { colisId, motif, description }),
  mesDemandes: () => request('GET', '/remboursements/mes'),
};

window.API = {
  Auth, Colis, Messages, Config, Utilisateur, Remboursements,
  getUser, getToken, setToken, setUser, clear, request
};
