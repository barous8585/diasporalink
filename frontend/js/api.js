// ── CONFIG ─────────────────────────────────────────────────
const API_URL = 'https://diasporalink-api.onrender.com/api';

// ── HELPERS ────────────────────────────────────────────────
const getToken = () => localStorage.getItem('dl_token');
const setToken = (t) => localStorage.setItem('dl_token', t);
const getUser  = () => JSON.parse(localStorage.getItem('dl_user') || 'null');
const setUser  = (u) => localStorage.setItem('dl_user', JSON.stringify(u));
const clear    = () => { localStorage.removeItem('dl_token'); localStorage.removeItem('dl_user'); };

async function request(method, path, body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${API_URL}${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erreur serveur');
    return data;
  } catch (err) {
    throw err;
  }
}

// ── AUTH ───────────────────────────────────────────────────
const Auth = {
  envoyerOTP: (telephone, prenom, nom) =>
    request('POST', '/auth/envoyer-otp', { telephone, prenom, nom }, false),

  verifierOTP: async (telephone, code) => {
    const data = await request('POST', '/auth/verifier-otp', { telephone, code }, false);
    if (data.token) { setToken(data.token); setUser(data.utilisateur); }
    return data;
  },

  moi: () => request('GET', '/auth/moi'),
  deconnecter: () => clear(),
  estConnecte: () => !!getToken(),
};

// ── COLIS ──────────────────────────────────────────────────
const Colis = {
  creer:        (data) => request('POST', '/colis', data),
  mesColis:     ()     => request('GET', '/colis'),
  unColis:      (id)   => request('GET', `/colis/${id}`),
  suiviPublic:  (num)  => request('GET', `/colis/suivi/${num}`, null, false),
  tarif:        (pays, poids, valeur) =>
    request('GET', `/colis/tarif?pays=${pays}&poids=${poids}&valeur=${valeur || 0}`, null, false),
};

// ── MESSAGES ───────────────────────────────────────────────
const Messages = {
  lire:    (colisId) => request('GET', `/messages/${colisId}`),
  envoyer: (colisId, texte) => request('POST', `/messages/${colisId}`, { texte }),
};

// ── CONFIG ─────────────────────────────────────────────────
const Config = {
  get: () => request('GET', '/config', null, false),
};

// ── UTILISATEUR ────────────────────────────────────────────
const Utilisateur = {
  profil:          ()     => request('GET', '/utilisateurs/moi'),
  mettreAJour:     (data) => request('PATCH', '/utilisateurs/moi', data),
};

window.API   = { Auth, Colis, Messages, Config, Utilisateur, getUser, getToken, setToken, setUser, clear };
