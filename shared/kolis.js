// ─────────────────────────────────────────────────────────────
//  Outils communs aux 3 apps : API, formatage, icônes, toasts
//  Source : shared/kolis.js — copié dans chaque app par `npm run sync-apps`
// ─────────────────────────────────────────────────────────────
(function () {
  // Adresse de l'API : même serveur en local, sinon l'URL de production.
  // Pour la changer sans toucher au code : window.KOLIS_API_URL = '…' avant ce script.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname) || /^192\.168\./.test(location.hostname);
  const API_URL = window.KOLIS_API_URL
    || (local ? (location.port === '5000' ? '/api' : `${location.protocol}//${location.hostname}:5000/api`)
              : 'https://diasporalink-api.onrender.com/api');

  // Chaque app garde sa propre session (client, agent, admin sur le même téléphone)
  const APP = document.documentElement.dataset.app || 'client';
  const cle = (k) => `kolis_${APP}_${k}`;

  const stock = {
    lire(k, defaut = null) { try { const v = localStorage.getItem(cle(k)); return v === null ? defaut : JSON.parse(v); } catch { return defaut; } },
    ecrire(k, v) { try { localStorage.setItem(cle(k), JSON.stringify(v)); } catch {} },
    suppr(k) { try { localStorage.removeItem(cle(k)); } catch {} },
  };

  class ErreurReseau extends Error { constructor() { super('Pas de connexion. Réessayez quand le réseau revient.'); this.reseau = true; } }

  async function requete(methode, chemin, corps, { delai = 15000 } = {}) {
    const entetes = { 'Content-Type': 'application/json' };
    const jeton = stock.lire('jeton');
    if (jeton) entetes.Authorization = `Bearer ${jeton}`;
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), delai);
    let res;
    try {
      res = await fetch(API_URL + chemin, {
        method: methode, headers: entetes, signal: ctrl.signal,
        body: corps ? JSON.stringify(corps) : undefined,
      });
    } catch (e) {
      throw new ErreurReseau();
    } finally { clearTimeout(minuteur); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && jeton && !chemin.startsWith('/auth/')) {
      stock.suppr('jeton'); stock.suppr('utilisateur');
    }
    if (!res.ok) {
      const e = new Error(data.message || `Erreur ${res.status}`);
      e.status = res.status; e.code = data.code; e.data = data;
      throw e;
    }
    return data;
  }

  const api = {
    get: (c, o) => requete('GET', c, null, o),
    post: (c, b, o) => requete('POST', c, b, o),
    patch: (c, b, o) => requete('PATCH', c, b, o),
    del: (c, o) => requete('DELETE', c, null, o),
  };

  // ── Session ──
  const session = {
    jeton: () => stock.lire('jeton'),
    utilisateur: () => stock.lire('utilisateur'),
    connecte: () => !!stock.lire('jeton'),
    ouvrir(jeton, utilisateur) { stock.ecrire('jeton', jeton); stock.ecrire('utilisateur', utilisateur); window.dispatchEvent(new Event('session-ouverte')); },
    fermer() { stock.suppr('jeton'); stock.suppr('utilisateur'); },
  };

  // ── Config publique (mise en cache pour le hors-ligne) ──
  async function config({ forcer = false } = {}) {
    const enCache = stock.lire('config');
    if (enCache && !forcer && Date.now() - (enCache._le || 0) < 10 * 60 * 1000) return enCache;
    try {
      const c = await api.get('/config', { delai: 8000 });
      c._le = Date.now();
      stock.ecrire('config', c);
      return c;
    } catch (e) {
      if (enCache) return enCache;
      throw e;
    }
  }

  // ── Formatage ──
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('fr-FR');
  const gnf = (n) => `${nf.format(Math.round(n || 0)).replace(/ | /g, ' ')} GNF`;
  const eur = (n) => `${(Math.round((n || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
  const montant = (n, devise) => devise === 'EUR' ? eur(n) : gnf(n);
  const kg = (n) => `${(Math.round((n || 0) * 10) / 10).toLocaleString('fr-FR')} kg`;
  const date = (d, avecHeure = true) => {
    if (!d) return '';
    const x = new Date(d);
    const j = x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return avecHeure ? `${j} · ${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ')}` : j;
  };
  const heure = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  // Téléphone : même règle que le serveur
  function normTel(tel) {
    let t = String(tel || '').replace(/[\s.\-()]/g, '');
    if (t.startsWith('00')) t = '+' + t.slice(2);
    if (/^6\d{8}$/.test(t)) t = '+224' + t;
    if (/^0[1-9]\d{8}$/.test(t)) t = '+33' + t.slice(1);
    return t;
  }

  // ── Icônes (tracés simples, trait) ──
  const TRACES = {
    colis: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5"/><path d="M12 12v9"/>',
    loupe: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    oeil: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'oeil-barre': '<path d="M2 12s3.6-7 10-7c2 0 3.8.7 5.2 1.6M22 12s-3.6 7-10 7c-2 0-3.8-.7-5.2-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
    cloche: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    bulle: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    tel: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A17 17 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    lieu: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    prix: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    avion: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>',
    bateau: '<path d="M3 17l2 4h14l2-4H3z"/><path d="M5 17v-6h14v6"/><path d="M9 11V7h6v4"/><path d="M12 7V3"/>',
    eclair: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    ok: '<path d="m5 12 5 5 9-10"/>',
    etoile: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    copier: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    maison: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
    liste: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    personne: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    envoi: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    recu: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    horsligne: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8"/><path d="M19 12.9a10 10 0 0 0-2.4-1.7"/><path d="M12 20h.01"/>',
    partager: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    retour: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    suivant: '<path d="m9 6 6 6-6 6"/>',
    billet: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    balance: '<path d="M12 3v18M5 21h14M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    alerte: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    synchro: '<path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4"/>',
    clavier: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    piece: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 13h3"/>',
    imprimer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
    grille: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    lot: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    equipe: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
    graphe: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    ajoutPers: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>',
    sortie: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    fermer: '<path d="M18 6 6 18M6 6l12 12"/>',
    gps: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
    moto: '<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17h6l3-6h-4M14.5 11 13 6h3M8 11h3"/><path d="m18.5 17-3-8"/>',
    maison2: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    lampe: '<path d="M9 2h6l-1 6h-4z"/><path d="M10 8h4v13h-4z"/>',
    carte: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    reglages: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };
  const ic = (nom, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${TRACES[nom] || ''}</svg>`;

  // ── Toasts ──
  function toast(message, type = '', { duree } = {}) {
    let zone = document.getElementById('toast');
    if (!zone) { zone = document.createElement('div'); zone.id = 'toast'; zone.setAttribute('role', 'status'); zone.setAttribute('aria-live', 'polite'); document.body.appendChild(zone); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    zone.appendChild(t);
    // Touché : disparaît tout de suite ; les longs messages restent plus longtemps
    t.addEventListener('click', () => t.remove());
    setTimeout(() => t.remove(), duree || (type === 'erreur' ? Math.max(5000, message.length * 60) : 3000));
  }

  // ── Modale simple ──
  function modale(html, { surOuverture } = {}) {
    const fond = document.createElement('div');
    fond.className = 'modale-fond';
    fond.innerHTML = `<div class="modale" role="dialog" aria-modal="true">${html}</div>`;
    const fermer = () => fond.remove();
    fond.addEventListener('click', (e) => { if (e.target === fond || e.target.closest('[data-fermer]')) fermer(); });
    document.body.appendChild(fond);
    surOuverture?.(fond.querySelector('.modale'), fermer);
    fond.querySelector('input, select, textarea, button')?.focus();
    return { el: fond.querySelector('.modale'), fermer };
  }

  // ── Connexion par SMS (code à 6 chiffres) — utilisée seulement si authMode = 'sms' ──
  function vueConnexionSms(cible, { titre = 'Connexion', inscription = true, surSucces }) {
    let etape = 'tel', telephone = '', nouvel = false;
    const dessiner = (erreur = '', debug = '') => {
      cible.innerHTML = `
        <form class="pile" style="--gap:16px" novalidate>
          <h1>${esc(titre)}</h1>
          ${etape === 'tel' ? `
            <p class="muet">Entrez votre numéro. Vous recevrez un code par SMS.</p>
            <label class="champ">Téléphone
              <input class="saisie saisie-forte" name="telephone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+224 6XX XX XX XX ou 06 XX XX XX XX" value="${esc(telephone)}" required>
            </label>
            ${nouvel ? `
              <p class="bandeau bandeau-ocre">Premier passage : indiquez votre nom.</p>
              <label class="champ">Prénom <input class="saisie" name="prenom" autocomplete="given-name" required></label>
              <label class="champ">Nom <input class="saisie" name="nom" autocomplete="family-name" required></label>` : ''}
            <button class="btn btn-principal btn-grand btn-plein" type="submit">Recevoir le code</button>
          ` : `
            <p class="muet">Code envoyé au <b>${esc(telephone)}</b>.</p>
            ${debug ? `<p class="bandeau bandeau-ocre">Mode test : le code est ${esc(debug)}</p>` : ''}
            <label class="champ">Code à 6 chiffres
              <input class="saisie saisie-forte chiffres" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" style="font-size:28px;letter-spacing:8px;text-align:center" required>
            </label>
            <button class="btn btn-principal btn-grand btn-plein" type="submit">Valider</button>
            <button class="btn btn-lien" type="button" data-changer>Changer de numéro</button>
          `}
          ${erreur ? `<p class="bandeau bandeau-rouge" role="alert">${esc(erreur)}</p>` : ''}
        </form>`;
      const form = cible.querySelector('form');
      form.querySelector('[data-changer]')?.addEventListener('click', () => { etape = 'tel'; dessiner(); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        const f = new FormData(form);
        try {
          if (etape === 'tel') {
            telephone = normTel(f.get('telephone'));
            const corps = { telephone };
            if (nouvel) { corps.prenom = f.get('prenom'); corps.nom = f.get('nom'); }
            const r = await api.post('/auth/envoyer-otp', corps);
            if (r.nouvelUtilisateur) {
              if (!inscription) { dessiner('Numéro inconnu. Demandez à l\'administrateur de créer votre compte.'); return; }
              nouvel = true; dessiner(); return;
            }
            etape = 'code'; dessiner('', r.debugCode);
            cible.querySelector('[name=code]')?.focus();
          } else {
            const r = await api.post('/auth/verifier-otp', { telephone, code: f.get('code') });
            session.ouvrir(r.token, r.utilisateur);
            surSucces?.(r.utilisateur);
          }
        } catch (err) {
          dessiner(err.message);
        }
      });
    };
    dessiner();
  }

  // ── Connexion : par mot de passe (défaut) ou par SMS selon la config du serveur ──
  function vueConnexion(cible, options) {
    const mode = stock.lire('config')?.authMode || 'motdepasse';
    if (mode === 'sms') return vueConnexionSms(cible, options);
    return vueConnexionMdp(cible, options);
  }

  function vueConnexionMdp(cible, { titre = 'Connexion', inscription = true, surSucces }) {
    let vue = 'connexion';
    const champMdp = (nom, lib, auto) => `
      <label class="champ">${lib}
        <span class="ligne" style="--gap:6px">
          <input class="saisie saisie-forte grandit" name="${nom}" type="password" autocomplete="${auto}" minlength="8" required>
          <button type="button" class="btn btn-carre" style="width:52px;height:52px" data-voir="${nom}" aria-label="Afficher le mot de passe" aria-pressed="false">${ic('oeil', 'ic-sm')}</button>
        </span>
      </label>`;
    const dessiner = (erreur = '') => {
      cible.innerHTML = vue === 'oubli' ? `
        <div class="pile" style="--gap:16px">
          <h1>Mot de passe oublié</h1>
          <p>${inscription
            ? 'Passez dans une agence avec une pièce d\'identité : l\'agent vous aidera à définir un nouveau mot de passe.'
            : 'Demandez à l\'administrateur de vous définir un nouveau mot de passe.'}</p>
          <button class="btn btn-plein" type="button" data-vue="connexion">Retour</button>
        </div>` : `
        <form class="pile" style="--gap:16px" novalidate>
          <img class="logo-connexion" src="commun/logo.png" alt="Talib Multi Services" width="200" height="136">
          <h1>${vue === 'inscription' ? 'Créer mon compte' : esc(titre)}</h1>
          ${vue === 'inscription' ? `
            <div class="grille-2">
              <label class="champ">Prénom <input class="saisie" name="prenom" autocomplete="given-name" required></label>
              <label class="champ">Nom <input class="saisie" name="nom" autocomplete="family-name" required></label>
            </div>` : ''}
          <label class="champ">Téléphone
            <input class="saisie saisie-forte" name="telephone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+224 6XX XX XX XX ou 06 XX XX XX XX" required>
          </label>
          ${champMdp('motDePasse', vue === 'inscription' ? 'Mot de passe (8 caractères minimum)' : 'Mot de passe', vue === 'inscription' ? 'new-password' : 'current-password')}
          ${vue === 'inscription' ? champMdp('confirmation', 'Confirmez le mot de passe', 'new-password') : ''}
          ${erreur ? `<p class="bandeau bandeau-rouge" role="alert">${esc(erreur)}</p>` : ''}
          <button class="btn btn-principal btn-grand btn-plein" type="submit">${vue === 'inscription' ? 'Créer mon compte' : 'Se connecter'}</button>
          ${vue === 'connexion' ? `<button class="btn btn-lien" type="button" data-vue="oubli">Mot de passe oublié ?</button>` : ''}
          ${googleDispo() ? `<div class="separateur-ou"><span>ou</span></div><div class="zone-google" data-google></div>` : ''}
          ${inscription ? (vue === 'connexion'
            ? `<button class="btn btn-plein" type="button" data-vue="inscription">Pas encore de compte ? Créer un compte</button>`
            : `<button class="btn btn-lien" type="button" data-vue="connexion">J'ai déjà un compte</button>`) : ''}
        </form>`;
      cible.querySelectorAll('[data-vue]').forEach(b => b.addEventListener('click', () => { vue = b.dataset.vue; dessiner(); }));
      cible.querySelectorAll('[data-voir]').forEach(b => b.addEventListener('click', () => {
        const i = cible.querySelector(`[name="${b.dataset.voir}"]`);
        const visible = i.type === 'password';
        i.type = visible ? 'text' : 'password';
        b.innerHTML = ic(visible ? 'oeil-barre' : 'oeil', 'ic-sm');
        b.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
        b.setAttribute('aria-pressed', String(visible));
      }));
      const form = cible.querySelector('form');
      if (!form) return;
      const zg = cible.querySelector('[data-google]');
      if (zg) boutonGoogle(zg, { texte: vue === 'inscription' ? 'signup_with' : 'continue_with', surCredential: (cred) => etapeGoogle(cible, cred, { surSucces, retour: dessiner }) });
      form.querySelector('input').focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const btn = form.querySelector('[type=submit]'); btn.disabled = true;
        try {
          let r;
          if (vue === 'inscription') {
            if (String(f.get('motDePasse')).length < 8) throw new Error('Mot de passe : 8 caractères minimum.');
            if (f.get('motDePasse') !== f.get('confirmation')) throw new Error('Les deux mots de passe ne sont pas identiques.');
            r = await api.post('/auth/inscription', { telephone: normTel(f.get('telephone')), prenom: f.get('prenom'), nom: f.get('nom'), motDePasse: f.get('motDePasse') });
          } else {
            r = await api.post('/auth/connexion', { telephone: normTel(f.get('telephone')), motDePasse: f.get('motDePasse') });
          }
          session.ouvrir(r.token, r.utilisateur);
          if (r.doitChangerMotDePasse) {
            toast('Premier accès : choisissez votre propre mot de passe.');
            await changerMotDePasse({ actuel: f.get('motDePasse'), obligatoire: true });
          }
          surSucces?.(r.utilisateur);
        } catch (err) {
          dessiner(err.message);
        }
      });
    };
    dessiner();
  }

  // ══════════════════════════════════════════════════════════
  //  SESSION QUI DURE + DONNÉES TOUJOURS À JOUR + NOUVELLE VERSION SANS RECHARGER
  // ══════════════════════════════════════════════════════════
  // Prolonge la session (30 jours) à chaque ouverture puis toutes les 12 h : tant qu'on se sert
  // de l'app au moins une fois par mois, on reste connecté.
  async function prolongerSession() {
    if (!session.connecte() || !navigator.onLine) return;
    try {
      const r = await api.post('/auth/renouveler');
      if (r?.token) { stock.ecrire('jeton', r.token); stock.ecrire('utilisateur', r.utilisateur); }
    } catch {}
  }
  let prolongationLancee = false;
  function garderSession() {
    if (prolongationLancee) return; prolongationLancee = true;
    prolongerSession();
    setInterval(prolongerSession, 12 * 3600 * 1000);
    window.addEventListener('online', prolongerSession);
  }

  // Une saisie est-elle en cours ? (on ne redessine jamais l'écran sous les doigts de quelqu'un)
  const saisieEnCours = () => {
    const a = document.activeElement;
    return !!(document.querySelector('.modale-fond') || (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && !a.readOnly));
  };

  // Rafraîchit l'écran dès qu'une donnée change (prévenu par le serveur en direct), au retour
  // sur l'app, au retour du réseau, et toutes les 30 s par sécurité. surMaj() redessine l'écran.
  function tempsReel(surMaj, { intervalle = 30000 } = {}) {
    let attente = null, dernier = Date.now(), enRetard = false, socket = null;
    const declencher = () => {
      clearTimeout(attente);
      attente = setTimeout(async () => {
        if (document.hidden || !session.connecte()) { enRetard = true; return; }
        if (saisieEnCours()) { attente = setTimeout(declencher, 5000); return; }
        dernier = Date.now(); enRetard = false;
        try { await surMaj(); } catch {}
      }, 700);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && (enRetard || Date.now() - dernier > 10000)) declencher(); });
    window.addEventListener('online', declencher);
    setInterval(() => { if (!document.hidden && Date.now() - dernier >= intervalle - 500) declencher(); }, intervalle);
    // Connexion en direct (Socket.io) : le serveur dit seulement « quelque chose a changé »
    const connecter = async () => {
      if (socket || !session.connecte()) return;
      try {
        if (!window.io) await new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = 'commun/vendor/socket.io.min.js'; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); });
        socket = window.io(API_URL.startsWith('/') ? location.origin : API_URL.replace(/\/api\/?$/, ''), {
          auth: (cb) => cb({ token: stock.lire('jeton') }), transports: ['websocket', 'polling'], reconnectionDelayMax: 30000,
        });
        socket.on('maj', declencher);
        socket.on('connect', () => { if (Date.now() - dernier > 5000) declencher(); }); // reconnecté : on rattrape
      } catch { socket = null; }
    };
    connecter();
    // Juste après la connexion (changement d'écran), puis par sécurité toutes les minutes
    window.addEventListener('hashchange', () => { if (!socket) connecter(); });
    window.addEventListener('session-ouverte', () => { if (socket) { socket.disconnect(); socket = null; } connecter(); declencher(); });
    setInterval(() => { if (!socket) connecter(); }, 60000);
    return { maintenant: declencher };
  }

  // Nouvelle version publiée : l'app se met à jour seule (sans perdre une saisie en cours)
  function miseAJourAuto() {
    if (!('serviceWorker' in navigator)) return;
    let dejaControle = !!navigator.serviceWorker.controller;
    let aRecharger = false;
    const recharger = () => { if (saisieEnCours()) { aRecharger = true; return; } location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (dejaControle) recharger(); dejaControle = true; });
    window.addEventListener('hashchange', () => { if (aRecharger) location.reload(); });
    const verifier = () => navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {});
    setInterval(verifier, 15 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) verifier(); });
  }

  // ── Connexion avec Google (espace client seulement, si GOOGLE_CLIENT_ID est réglé) ──
  const googleDispo = () => APP === 'client' && !!stock.lire('config')?.googleClientId;
  let gisCharge = null;
  function chargerGoogle() {
    if (window.google?.accounts?.id) return Promise.resolve();
    gisCharge = gisCharge || new Promise((ok, ko) => {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = ok; sc.onerror = () => { gisCharge = null; ko(new Error('Google indisponible')); };
      document.head.appendChild(sc);
    });
    return gisCharge;
  }
  // Affiche le bouton officiel « Continuer avec Google » dans zone
  async function boutonGoogle(zone, { texte = 'continue_with', surCredential }) {
    try { await chargerGoogle(); } catch { zone.innerHTML = '<p class="tres-petit muet centre">Connexion Google indisponible pour le moment.</p>'; return; }
    window.google.accounts.id.initialize({
      client_id: stock.lire('config').googleClientId,
      callback: (r) => r?.credential && surCredential(r.credential),
      ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true,
    });
    zone.innerHTML = '';
    window.google.accounts.id.renderButton(zone, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: texte, locale: 'fr', logo_alignment: 'center', width: Math.min(400, Math.max(240, zone.clientWidth || 320)) });
  }
  // Après Google : connexion directe, ou dernière étape (téléphone, et mot de passe si le numéro a déjà un compte)
  async function etapeGoogle(cible, credential, { surSucces, retour }) {
    const envoyer = async (extra = {}) => api.post('/auth/google', { credential, ...extra });
    let r;
    try { r = await envoyer(); } catch (err) { toast(err.message, 'erreur'); return; }
    if (!r.besoinTelephone) { session.ouvrir(r.token, r.utilisateur); toast(`Bienvenue ${r.utilisateur.prenom} !`, 'ok'); surSucces?.(r.utilisateur); return; }
    const p = r.profil || {};
    let avecMdp = false;
    const dessiner = (erreur = '') => {
      cible.innerHTML = `
        <form class="pile" style="--gap:16px" novalidate>
          <img class="logo-connexion" src="commun/logo.png" alt="Talib Multi Services" width="200" height="136">
          <h1>Dernière étape</h1>
          <p class="muet">Connecté avec Google${p.email ? ` (<b>${esc(p.email)}</b>)` : ''}. Indiquez votre numéro de téléphone : il sert au suivi de vos colis et à l'agence.</p>
          <div class="grille-2">
            <label class="champ">Prénom <input class="saisie" name="prenom" value="${esc(p.prenom || '')}" autocomplete="given-name" required></label>
            <label class="champ">Nom <input class="saisie" name="nom" value="${esc(p.nom || '')}" autocomplete="family-name" required></label>
          </div>
          <label class="champ">Téléphone <input class="saisie saisie-forte" name="telephone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+224 6XX XX XX XX ou 06 XX XX XX XX" required></label>
          ${avecMdp ? `<p class="bandeau bandeau-bleu petit">${ic('cadenas', 'ic-sm')}<span>Ce numéro a déjà un compte. Entrez son mot de passe pour y relier Google : ensuite, un seul geste suffira pour vous connecter.</span></p>
          <label class="champ">Mot de passe du compte <input class="saisie saisie-forte" name="motDePasse" type="password" autocomplete="current-password" required></label>` : ''}
          ${erreur ? `<p class="bandeau bandeau-rouge" role="alert">${esc(erreur)}</p>` : ''}
          <button class="btn btn-principal btn-grand btn-plein" type="submit">${avecMdp ? 'Relier et me connecter' : 'Terminer'}</button>
          <button class="btn btn-lien" type="button" data-annuler>Annuler</button>
        </form>`;
      const form = cible.querySelector('form');
      cible.querySelector('[data-annuler]').addEventListener('click', () => retour?.());
      (avecMdp ? form.motDePasse : form.telephone).focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const btn = form.querySelector('[type=submit]'); btn.disabled = true;
        try {
          const r2 = await envoyer({ telephone: normTel(f.get('telephone')), prenom: f.get('prenom'), nom: f.get('nom'), ...(avecMdp ? { motDePasse: f.get('motDePasse') } : {}) });
          session.ouvrir(r2.token, r2.utilisateur);
          toast(avecMdp ? 'Google est relié à votre compte.' : `Bienvenue ${r2.utilisateur.prenom} !`, 'ok');
          surSucces?.(r2.utilisateur);
        } catch (err) {
          if (err.data?.code === 'compte_existant' || err.code === 'compte_existant') {
            const tel = f.get('telephone'), pre = f.get('prenom'), no = f.get('nom');
            const premiere = !avecMdp; avecMdp = true; dessiner(premiere ? '' : err.message);
            cible.querySelector('[name=telephone]').value = tel; cible.querySelector('[name=prenom]').value = pre; cible.querySelector('[name=nom]').value = no;
          } else { dessiner(err.message); }
        }
      });
    };
    dessiner();
  }

  // ── Changer son mot de passe (fenêtre) ──
  function changerMotDePasse({ actuel = '', obligatoire = false } = {}) {
    return new Promise((fini) => {
      const { el, fermer } = modale(`
        <form class="pile" style="--gap:14px">
          <div class="ligne entre"><h2>${obligatoire ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'}</h2>${obligatoire ? '' : `<button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button>`}</div>
          ${actuel ? '' : `<label class="champ">Mot de passe actuel ${session.utilisateur()?.google ? '<span class="tres-petit muet">(laissez vide si vous n\'en avez jamais eu : compte créé avec Google)</span>' : ''}<input class="saisie" name="actuel" type="password" autocomplete="current-password" ${session.utilisateur()?.google ? '' : 'required'}></label>`}
          <label class="champ">Nouveau mot de passe (8 caractères minimum) <input class="saisie" name="nouveau" type="password" autocomplete="new-password" minlength="8" required></label>
          <label class="champ">Confirmez <input class="saisie" name="confirmation" type="password" autocomplete="new-password" required></label>
          <p class="bandeau bandeau-rouge cache" data-erreur role="alert"></p>
          <button class="btn btn-principal btn-grand">Enregistrer</button>
        </form>`);
      const form = el.querySelector('form');
      const erreur = (m) => { const z = el.querySelector('[data-erreur]'); z.textContent = m; z.classList.remove('cache'); };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        if (String(f.get('nouveau')).length < 8) return erreur('8 caractères minimum.');
        if (f.get('nouveau') !== f.get('confirmation')) return erreur('Les deux mots de passe ne sont pas identiques.');
        if (actuel && f.get('nouveau') === actuel) return erreur('Choisissez un mot de passe différent du mot de passe initial.');
        try {
          const r = await api.patch('/auth/mot-de-passe', { actuel: actuel || f.get('actuel'), nouveau: f.get('nouveau') });
          stock.ecrire('jeton', r.token);
          toast('Mot de passe modifié.', 'ok');
          fermer(); fini(true);
        } catch (err) { erreur(err.message); }
      });
      el.closest('.modale-fond').addEventListener('click', (e) => { if (e.target.classList.contains('modale-fond') || e.target.closest('[data-fermer]')) fini(false); });
    });
  }

  // ── Empreinte SHA-256 (vérification hors-ligne des codes de retrait) ──
  async function sha256(texte) {
    const tampon = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
    return [...new Uint8Array(tampon)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Étiquettes (QR code, 10 × 15 cm, une par carton) ──
  const etiquette = {
    lib: 'commun/vendor/qrcode-generator.min.js',
    async qr(texte) {
      if (!window.qrcode) {
        await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = this.lib; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
      }
      const q = window.qrcode(0, 'M'); q.addData(texte); q.make();
      return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
    },
    async apercu(el, numero) {
      try { el.innerHTML = await this.qr(numero); } catch { el.innerHTML = `<p class="muet">QR indisponible hors-ligne. Numéro : <b>${esc(numero)}</b></p>`; }
    },
    async imprimer(c, config, { sansImpression = false } = {}) {
      const zone = document.querySelector('[data-etiquette]');
      let svg = '';
      try { svg = await this.qr(c.numeroSuivi); } catch {}
      const g = (config.agences || []).find(x => x.code === c.guichet);
      const sens = (config.sens || []).find(x => x.key === (c.sens || 'FR-GN'));
      const n = c.nbCartons || 1;
      zone.innerHTML = Array.from({ length: n }, (_, i) => `
        <div class="page">
          <div style="display:flex;justify-content:space-between;font-weight:700"><span>${esc(config.appCourt || config.app)}</span><span>${esc(sens?.label || '')} · ${libMode(c.mode).toUpperCase()}</span></div>
          <div class="num">${esc(c.numeroSuivi)}</div>
          <div class="qr">${svg}</div>
          <div class="grand">${esc(c.destinataire.nom)}</div>
          <div>Tél. •••${esc(String(c.destinataire.telephone).slice(-4))}</div>
          <div class="grand">${esc(g?.nom || c.guichet)}</div>
          <div>${esc([g?.commune, g?.ville].filter(Boolean).join(', '))}</div>
          <div style="display:flex;justify-content:space-between"><span>${kg(c.poidsReel)}</span><span>Carton ${i + 1}/${n}</span><span>${esc(date(new Date(), false))}</span></div>
        </div>`).join('');
      if (!sansImpression) setTimeout(() => window.print(), 100);
    },
  };

  // ── Adresse à domicile (ramassage / livraison) : quartier, repère, position GPS ──
  // Accepte un lien Google Maps / WhatsApp, ou « 9.51, -13.71 ». Liens courts : résolus par le serveur.
  function positionDuTexte(texte) {
    let t = String(texte || '');
    try { t = decodeURIComponent(t); } catch {}
    const motifs = [
      /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
      /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
      /[?&](?:q|query|ll|daddr|destination|center)=(?:loc:)?(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
      /^\s*(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)\s*$/,
      /(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/,
    ];
    for (const m of motifs) {
      const r = t.match(m);
      if (r) { const p = { lat: parseFloat(r[1]), lng: parseFloat(r[2]) }; if (Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) return p; }
    }
    return null;
  }
  async function positionDuLien(texte) {
    const p = positionDuTexte(texte);
    if (p) return p;
    if (!/https?:\/\//.test(texte)) return null;
    try { return (await api.get('/config/position?lien=' + encodeURIComponent(texte))).position; } catch (e) { if (e.reseau) throw e; return null; }
  }
  function gpsActuel({ delai = 15000 } = {}) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return new Promise((ok, ko) => {
      if (!window.isSecureContext) return ko(new Error('La position ne marche que sur une adresse sécurisée (https).'));
      if (!navigator.geolocation) return ko(new Error('Cet appareil ne donne pas sa position. Placez l\'épingle sur la carte.'));
      // Le navigateur attend sans fin si la demande d'autorisation reste sans réponse : on coupe nous-mêmes
      let fini = false;
      const garde = setTimeout(() => { if (!fini) { ko(new Error('Pas de réponse du GPS. Acceptez la demande de localisation, ou placez l\'épingle sur la carte.')); } }, delai + 5000);
      const fin = (f) => (x) => { if (fini) return; fini = true; clearTimeout(garde); f(x); };
      ok = fin(ok); ko = fin(ko);
      navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, precision: Math.round(p.coords.accuracy) }),
        (e) => ko(new Error(e.code === 1
          ? (ios ? 'Position refusée. Réglages → Confidentialité → Service de localisation → Safari → « Lorsque l\'app est active », puis réessayez. Ou placez l\'épingle sur la carte.'
                 : 'Position refusée. Touchez le cadenas à gauche de l\'adresse → Autorisations → Position → Autoriser. Ou placez l\'épingle sur la carte.')
          : 'Position introuvable : activez la localisation du téléphone (GPS), ou placez l\'épingle sur la carte.')),
        { enableHighAccuracy: true, timeout: delai, maximumAge: 30000 });
    });
  }

  // ── Carte : placer une épingle (Leaflet + OpenStreetMap, hébergés avec l'app) ──
  const CENTRES = { GN: { lat: 9.5370, lng: -13.6773, zoom: 12 }, FR: { lat: 48.8566, lng: 2.3522, zoom: 11 } };
  let leaflet;
  function chargerLeaflet() {
    if (window.L) return Promise.resolve();
    leaflet = leaflet || new Promise((ok, ko) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'commun/vendor/leaflet.css'; document.head.appendChild(l);
      const sc = document.createElement('script'); sc.src = 'commun/vendor/leaflet.js'; sc.onload = ok;
      sc.onerror = () => { leaflet = null; ko(new Error('Carte indisponible sans réseau.')); };
      document.head.appendChild(sc);
    });
    return leaflet;
  }
  /**
   * Ouvre une carte plein écran : on déplace la carte, l'épingle reste au centre.
   * Renvoie { lat, lng } ou null si on ferme.
   */
  async function choisirSurCarte({ position, centre, pays, titre = 'Placez l\'épingle' } = {}) {
    await chargerLeaflet();
    return new Promise((resoudre) => {
      const fond = document.createElement('div');
      fond.className = 'modale-fond modale-carte';
      fond.innerHTML = `
        <div class="modale" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
          <div class="ligne entre"><h2>${esc(titre)}</h2><button type="button" class="btn btn-rond" data-annuler aria-label="Fermer">${ic('fermer')}</button></div>
          <form class="ligne" style="--gap:6px" data-cherche-lieu>
            <input class="saisie grandit" name="q" placeholder="Chercher un quartier, une rue…" autocomplete="off">
            <button class="btn btn-carre" aria-label="Chercher">${ic('loupe')}</button>
          </form>
          <div class="carte-zone"><div data-carte></div><div class="epingle" aria-hidden="true">${ic('lieu', 'ic-lg')}</div></div>
          <p class="tres-petit muet centre" data-aide>Déplacez la carte avec le doigt : l'épingle doit être sur l'entrée exacte.</p>
          <div class="grille-2">
            <button type="button" class="btn btn-plein" data-gps>${ic('gps', 'ic-sm')} Ma position</button>
            <button type="button" class="btn btn-principal btn-plein" data-valider>${ic('ok', 'ic-sm')} Valider cet endroit</button>
          </div>
        </div>`;
      document.body.appendChild(fond);
      // Point de départ : seulement s'il est dans le bon pays (jamais une agence de Conakry « placée » en France)
      const dansPays = (p) => p?.lat && (!pays || KolisTarif.pointDansPays(p, pays));
      const posOk = dansPays(position) ? position : null;
      const centreOk = dansPays(centre) ? centre : null;
      const depart = posOk || centreOk || CENTRES[pays] || CENTRES.GN;
      const carte = window.L.map(fond.querySelector('[data-carte]'), { zoomControl: true, attributionControl: true })
        .setView([depart.lat, depart.lng], posOk ? 17 : centreOk ? 14 : depart.zoom || 12);
      carte.attributionControl.setPrefix(false);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(carte);
      setTimeout(() => carte.invalidateSize(), 60);
      const aide = fond.querySelector('[data-aide]');
      const fermer = (val) => { carte.remove(); fond.remove(); resoudre(val); };
      fond.querySelector('[data-annuler]').addEventListener('click', () => fermer(null));
      fond.querySelector('[data-valider]').addEventListener('click', () => {
        const c = carte.getCenter();
        const p = { lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 };
        if (pays && !KolisTarif.pointDansPays(p, pays)) {
          aide.innerHTML = `<span class="rouge">Cet endroit n'est pas en ${pays === 'FR' ? 'France' : 'Guinée'}. Déplacez la carte jusqu'à la bonne adresse.</span>`;
          return;
        }
        fermer(p);
      });
      fond.querySelector('[data-gps]').addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true; aide.textContent = 'Recherche de votre position…';
        try {
          const p = await gpsActuel();
          carte.setView([p.lat, p.lng], 18);
          aide.textContent = p.precision > 100 ? `Position approximative (± ${p.precision} m) : ajustez l'épingle à la main.` : 'Vérifiez que l\'épingle est bien sur l\'entrée, puis validez.';
        } catch (err) { aide.textContent = err.message; }
        b.disabled = false;
      });
      fond.querySelector('[data-cherche-lieu]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = e.target.q.value.trim(); if (!q) return;
        aide.textContent = 'Recherche…';
        try {
          const lieu = await adresseVersPosition({ quartier: q }, pays || 'GN', { pres: centreOk });
          if (!lieu) { aide.textContent = 'Lieu introuvable : déplacez la carte à la main.'; return; }
          carte.setView([lieu.lat, lieu.lng], 16);
          aide.textContent = `${lieu.trouve ? `${lieu.trouve}. ` : ''}Affinez : mettez l'épingle sur l'entrée exacte.`;
        } catch { aide.textContent = 'Recherche impossible sans réseau.'; }
      });
    });
  }
  const lienCarte = (p) => p?.lat ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : '';

  /**
   * Bloc d'adresse, deux façons au choix (une seule suffit) :
   *  - « Ma position » : GPS du téléphone, épingle sur la carte, ou lien WhatsApp / Maps ;
   *  - « J'écris mon adresse » : rue, quartier, ville ; l'adresse est placée sur la carte
   *    automatiquement pour calculer le prix (le livreur appelle au besoin).
   * Le point de repère et le téléphone sur place sont facultatifs.
   * valeur = { rue, quartier, ville, repere, telephone, position }
   * options : { maPosition: proposer le GPS (on est sur place), positionFacultative, aide }
   */
  function champsAdresse(prefixe, valeur = {}, { maPosition = true, positionFacultative = false, aide = '' } = {}) {
    const n = (k) => `${prefixe}_${k}`;
    const parDefaut = valeur.position?.lat && valeur.position.source !== 'adresse' ? 'position' : (valeur.rue || valeur.quartier || !maPosition ? 'ecrire' : 'position');
    return `
      <div class="pile bloc-adresse" style="--gap:12px" data-adresse="${prefixe}" data-saisie="${parDefaut}">
        <div class="segments" role="group" aria-label="Comment indiquer l'adresse">
          <button type="button" data-mode-adresse="position" aria-pressed="${parDefaut === 'position'}">${ic('gps', 'ic-sm')} ${maPosition ? 'Ma position' : 'Sa position'}</button>
          <button type="button" data-mode-adresse="ecrire" aria-pressed="${parDefaut === 'ecrire'}">${ic('liste', 'ic-sm')} Écrire l'adresse</button>
        </div>

        <div class="pile" style="--gap:8px" data-zone-position>
          <div class="grille-2" style="--gap:8px">
            ${maPosition ? `<button type="button" class="btn btn-plein btn-principal" data-ma-position>${ic('gps', 'ic-sm')} Je suis sur place</button>` : ''}
            <button type="button" class="btn btn-plein" data-sur-carte>${ic('lieu', 'ic-sm')} Choisir sur la carte</button>
          </div>
          <label class="champ tres-petit">${maPosition ? 'Ou c' : 'C'}ollez un lien de localisation (WhatsApp, Google Maps)
            <input class="saisie" data-lien-position placeholder="https://maps.app.goo.gl/… ou 9.5412, -13.6773" inputmode="url">
          </label>
        </div>

        <div class="pile" style="--gap:8px" data-zone-ecrire>
          <label class="champ">Adresse<input class="saisie" name="${n('rue')}" value="${esc(valeur.rue || '')}" autocomplete="street-address" placeholder="N°, rue, immeuble… (ex. 12 rue KA-020)"></label>
          <div class="grille-2">
            <label class="champ">Quartier / commune <input class="saisie" name="${n('quartier')}" value="${esc(valeur.quartier || valeur.commune || '')}" autocomplete="address-level3" placeholder="Ex. Kipé"></label>
            <label class="champ">Ville <input class="saisie" name="${n('ville')}" value="${esc(valeur.ville || '')}" autocomplete="address-level2" placeholder="Ex. Conakry"></label>
          </div>
        </div>

        <div class="petit etat-position" data-etat-position aria-live="polite"></div>

        <details class="details-adresse" ${valeur.repere || valeur.telephone ? 'open' : ''}>
          <summary>Ajouter un repère ou un autre téléphone <span class="muet">(facultatif)</span></summary>
          <div class="pile" style="--gap:8px;margin-top:10px">
            <label class="champ">Point de repère<input class="saisie" name="${n('repere')}" value="${esc(valeur.repere || '')}" placeholder="Ex. derrière la mosquée, portail bleu, 3e étage"></label>
            <label class="champ">Téléphone sur place, si différent<input class="saisie" name="${n('telephone')}" type="tel" inputmode="tel" value="${esc(valeur.telephone || '')}"></label>
          </div>
        </details>
        ${aide ? `<p class="tres-petit muet">${aide}</p>` : ''}
        ${positionFacultative ? '<p class="tres-petit muet">Vous pouvez aussi laisser vide : la position pourra être envoyée plus tard depuis le suivi.</p>' : ''}
      </div>`;
  }

  // Place une adresse écrite sur la carte (OpenStreetMap) : position approximative
  // Adresse écrite → position, cherchée par le serveur dans le pays de l'agence et autour
  // d'elle (un « Kipé » ou un « Matoto » ailleurs dans le pays n'est pas pris par erreur).
  // Renvoie { lat, lng, precision, source: 'adresse', trouve } ou null.
  async function adresseVersPosition({ rue, quartier, ville }, pays, { agence } = {}) {
    const q = new URLSearchParams({ pays: pays || 'GN', ...(agence ? { agence } : {}), rue: rue || '', quartier: quartier || '', ville: ville || '' });
    const r = await api.get(`/config/adresse?${q}`, { delai: 12000 });
    return r.position || null;
  }

  /** Branche le bloc : calcule la course à chaque changement de position ou d'adresse. */
  function brancherAdresse(racine, prefixe, { valeur = {}, agence, config, surChange } = {}) {
    const bloc = racine.querySelector(`[data-adresse="${prefixe}"]`);
    let position = valeur.position?.lat ? valeur.position : null;
    let course = null;
    const etat = bloc.querySelector('[data-etat-position]');
    const champ = (k) => bloc.querySelector(`[name="${prefixe}_${k}"]`)?.value.trim() || '';
    const mode = () => bloc.dataset.saisie;
    const choisirMode = (m) => {
      bloc.dataset.saisie = m;
      bloc.querySelectorAll('[data-mode-adresse]').forEach(b => b.setAttribute('aria-pressed', b.dataset.modeAdresse === m));
      bloc.querySelector('[data-zone-position]').classList.toggle('cache', m !== 'position');
      bloc.querySelector('[data-zone-ecrire]').classList.toggle('cache', m !== 'ecrire');
    };
    // Prix : estimation immédiate sur le téléphone, puis distance exacte par la route
    // demandée au serveur (le même calcul que celui enregistré à la réservation)
    let numDevis = 0;
    const afficher = (ag) => {
      const approx = position?.source === 'adresse';
      if (!position) { etat.innerHTML = ''; return; }
      if (course && !course.ok) { etat.innerHTML = `<span class="rouge">${esc(course.message)}</span>`; return; }
      const dist = course ? `${esc(course.distanceKm.toLocaleString('fr-FR'))} km ${course.methode === 'route' ? 'par la route' : 'environ'} depuis ${esc(ag.nom)}` : '';
      etat.innerHTML = `<span class="vert">${ic('ok', 'ic-sm')} ${approx ? `Adresse trouvée${position.trouve ? ` : ${esc(position.trouve)}` : ' sur la carte'}` : 'Position reçue'}</span>${course ? ` · ${dist} · <b>${esc(montant(course.prix, course.devise))}</b>${course.local ? ' <span class="muet">(calcul en cours…)</span>' : ''}` : ''} · <button type="button" class="btn-lien" data-ajuster>${approx ? 'vérifier sur la carte' : 'voir / ajuster'}</button>`;
    };
    const majEtat = (message, type, { silencieux = false } = {}) => {
      const ag = agence?.();
      course = position && ag ? KolisTarif.calculerCourse(config.regles || config, ag, position) : null;
      if (course?.ok) course.local = true;
      if (message) etat.innerHTML = `<span class="${type === 'erreur' ? 'rouge' : 'muet'}">${esc(message)}</span>`;
      else afficher(ag);
      if (!silencieux) surChange?.();
      // Distance par la route (si l'estimation est valable ou juste au-dessus du rayon)
      if (!message && position && ag && course && (course.ok || course.raison === 'trop_loin')) {
        const n = ++numDevis;
        const p = position;
        api.get(`/config/course?agence=${encodeURIComponent(ag.code)}&lat=${p.lat}&lng=${p.lng}`, { delai: 10000 })
          .then(r => {
            if (n !== numDevis || p !== position || !r.course) return;
            course = r.course;
            afficher(ag);
            surChange?.();
          })
          .catch(() => { if (n === numDevis && course?.ok) { course = { ...course, local: false }; afficher(ag); } });
      }
    };
    bloc.querySelectorAll('[data-mode-adresse]').forEach(b => b.addEventListener('click', () => choisirMode(b.dataset.modeAdresse)));
    choisirMode(mode());
    bloc.querySelector('[data-ma-position]')?.addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      majEtat('Recherche de votre position…');
      try {
        position = { ...(await gpsActuel()), source: 'gps' }; majEtat();
        // GPS imprécis (intérieur, vieux téléphone) : on propose d'ajuster sur la carte
        if (position.precision > 100) etat.insertAdjacentHTML('beforeend', `<br><span class="rouge">Position approximative (± ${position.precision} m).</span> <button type="button" class="btn-lien" data-ajuster>Ajuster sur la carte</button>`);
      } catch (err) { majEtat(err.message, 'erreur'); }
      b.disabled = false;
    });
    const ouvrirCarte = async () => {
      try {
        const ag = agence?.();
        const p = await choisirSurCarte({ position, centre: ag?.position, pays: ag?.pays, titre: 'Où exactement ?' });
        if (p) { position = { ...p, source: 'carte' }; majEtat(); }
      } catch (err) { majEtat(err.message, 'erreur'); }
    };
    bloc.querySelector('[data-sur-carte]').addEventListener('click', ouvrirCarte);
    etat.addEventListener('click', (e) => { if (e.target.closest('[data-ajuster]')) ouvrirCarte(); });
    const lien = bloc.querySelector('[data-lien-position]');
    let minuteur;
    lien.addEventListener('input', () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(async () => {
        const t = lien.value.trim();
        if (!t) return;
        majEtat('Lecture du lien…');
        try {
          const p = await positionDuLien(t);
          if (p) { position = { ...p, source: 'lien' }; majEtat(); } else majEtat('Lien non reconnu. Dans WhatsApp : trombone → Localisation → copiez le lien Google Maps.', 'erreur');
        } catch (err) { majEtat(err.message, 'erreur'); }
      }, 400);
    });
    // Adresse écrite : placée sur la carte automatiquement (sauf si une position exacte a été donnée)
    let minuteurAdr, demande = 0;
    const chercherAdresse = () => {
      clearTimeout(minuteurAdr);
      minuteurAdr = setTimeout(async () => {
        if (position && position.source !== 'adresse') return; // GPS / carte / lien : plus précis, on garde
        const a = { rue: champ('rue'), quartier: champ('quartier'), ville: champ('ville') };
        if (!a.rue && !a.quartier) { if (position?.source === 'adresse') { position = null; majEtat(); } return; }
        const n = ++demande;
        majEtat('Recherche de l\'adresse sur la carte…', null, { silencieux: true });
        try {
          const p = await adresseVersPosition(a, agence?.()?.pays, { agence: agence?.()?.code });
          if (n !== demande) return;
          if (p) { position = p; majEtat(); }
          else { position = null; majEtat('Adresse enregistrée. Le livreur vous appellera pour la trouver ; le prix sera confirmé à ce moment-là.', null); }
        } catch { if (n === demande) majEtat('Adresse enregistrée (carte indisponible sans réseau).', null); }
      }, 900);
    };
    ['rue', 'quartier', 'ville'].forEach(k => bloc.querySelector(`[name="${prefixe}_${k}"]`)?.addEventListener('input', chercherAdresse));
    majEtat(null, null, { silencieux: true }); // premier affichage : l'appelant n'est pas encore prêt
    if (!position && (champ('rue') || champ('quartier'))) chercherAdresse();
    return {
      lire: () => ({ rue: champ('rue'), quartier: champ('quartier'), ville: champ('ville'), repere: champ('repere'), telephone: champ('telephone') ? normTel(champ('telephone')) : '', position: position || undefined }),
      // Une adresse suffit : position, ou au moins une rue ou un quartier écrits
      complete: () => !!(position || champ('rue') || champ('quartier')),
      course: () => course,
      position: () => position,
      recalculer: () => majEtat(),
    };
  }

  // ── Mise en sections : chaque titre (h3) d'un formulaire et ce qui le suit forment un bloc
  // blanc séparé (« chaque chose dans son espace »). S'arrête au bouton d'envoi et aux
  // éléments marqués data-hors-etape. Les éléments gardent leurs écouteurs.
  function sectionner(racine) {
    if (!racine || racine.dataset.sectionne) return;
    racine.dataset.sectionne = '1';
    let bloc = null;
    for (const el of [...racine.children]) {
      if (el.tagName === 'H3') {
        bloc = document.createElement('section');
        bloc.className = 'bloc-etape';
        el.before(bloc);
        bloc.appendChild(el);
        continue;
      }
      if (!bloc) continue;
      if ((el.matches('button[type=submit], [data-hors-etape]')) || el.querySelector?.(':scope > button[type=submit]')) { bloc = null; continue; }
      bloc.appendChild(el);
    }
  }

  // ── Factures : page publique de l'app client (lien avec jeton, partageable) ──
  function lienFacture(f) {
    const q = `facture.html?n=${encodeURIComponent(f.numero)}&t=${encodeURIComponent(f.jeton)}`;
    if (APP === 'client') return q;
    if (local) return `${location.port === '5000' ? '' : `${location.protocol}//${location.hostname}:5000`}/${q}`;
    const base = (stock.lire('config')?.frontendUrl || 'https://tms-colis.netlify.app').replace(/\/$/, '');
    return `${base}/${q}`;
  }
  const ETATS_FACTURE = { payee: 'Payée', partielle: 'Partiellement payée', a_payer: 'À payer', avoir: 'Avoir' };

  // ── Photos : réduites sur le téléphone avant l'envoi (réseau faible) ──
  function photoReduite(fichier, { max = 1280, qualite = 0.7 } = {}) {
    return new Promise((ok, ko) => {
      const img = new Image();
      const url = URL.createObjectURL(fichier);
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', qualite));
      };
      img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Photo illisible.')); };
      img.src = url;
    });
  }
  // Affiche une photo protégée (l'API demande le jeton : pas de simple <img src>)
  async function afficherPhoto(img, id) {
    try {
      const r = await fetch(`${API_URL}/photos/${id}`, { headers: { Authorization: `Bearer ${stock.lire('jeton')}` } });
      if (!r.ok) throw new Error();
      img.src = URL.createObjectURL(await r.blob());
    } catch { img.alt = 'Photo indisponible'; }
  }

  // ── Notifications push (comme sur Glow) ──
  const base64VersOctets = (b64) => {
    const p = '='.repeat((4 - (b64.length % 4)) % 4);
    const brut = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...brut].map(c => c.charCodeAt(0)));
  };
  const notifications = {
    possible: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    // iPhone : les notifications ne marchent que si l'app est ajoutée à l'écran d'accueil
    iosHorsApp: () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window.navigator.standalone || matchMedia('(display-mode: standalone)').matches),
    async etat() {
      if (notifications.iosHorsApp()) return 'ios';
      if (!notifications.possible()) return 'impossible';
      if (Notification.permission === 'denied') return 'refuse';
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        return sub && Notification.permission === 'granted' ? 'actif' : 'inactif';
      } catch { return 'inactif'; }
    },
    async activer() {
      if (notifications.iosHorsApp()) throw new Error('Sur iPhone : touchez Partager puis « Sur l\'écran d\'accueil », ouvrez l\'app depuis l\'écran d\'accueil, puis activez les notifications.');
      if (!notifications.possible()) throw new Error('Ce navigateur ne gère pas les notifications. Essayez Chrome ou Safari à jour.');
      const { cle, actif } = await api.get('/push/cle');
      if (!actif || !cle) throw new Error('Les notifications ne sont pas encore activées sur le serveur.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications refusées. Autorisez-les dans les réglages du navigateur (cadenas à gauche de l\'adresse).');
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64VersOctets(cle) });
      await api.post('/push/abonner', { abonnement: sub.toJSON(), app: APP === 'client' ? 'client' : APP });
      return true;
    },
    async couper() {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { try { await api.post('/push/desabonner', { endpoint: sub.endpoint }); } catch {} await sub.unsubscribe(); }
    },
    // Carte « Activer les notifications » à glisser dans une page ; se cache si déjà fait
    async carte(zone, { texte = 'Soyez prévenu sur ce téléphone dès que quelque chose bouge.' } = {}) {
      if (!zone || !session.connecte()) return;
      const e = await notifications.etat();
      if (e === 'actif' || e === 'impossible') { zone.innerHTML = ''; return; }
      zone.innerHTML = `
        <div class="carte pile carte-notifs" style="--gap:10px">
          <div class="ligne" style="--gap:12px"><span class="pastille-notif">${ic('cloche')}</span><div class="grandit"><div class="gras">Notifications</div><div class="petit muet">${esc(texte)}</div></div></div>
          ${e === 'refuse' ? '<p class="petit rouge">Notifications bloquées : autorisez-les dans les réglages du navigateur, puis réessayez.</p>' : ''}
          ${e === 'ios' ? '<p class="petit">Sur iPhone : touchez <b>Partager</b> puis <b>« Sur l\'écran d\'accueil »</b>, et ouvrez l\'app depuis l\'écran d\'accueil.</p>' : `<button type="button" class="btn btn-principal btn-plein" data-activer-notifs>${ic('cloche', 'ic-sm')} Activer les notifications</button>`}
        </div>`;
      zone.querySelector('[data-activer-notifs]')?.addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try { await notifications.activer(); toast('Notifications activées sur cet appareil.', 'ok'); zone.innerHTML = ''; }
        catch (err) { toast(err.message, 'erreur'); ev.currentTarget.disabled = false; }
      });
    },
  };

  // Libellé court d'un mode de transport : express, avion, bateau
  const libMode = (m) => ({ express: 'express', air: 'avion', mer: 'bateau' })[m] || 'avion';
  const icMode = (m, cls) => ic(m === 'mer' ? 'bateau' : m === 'express' ? 'eclair' : 'avion', cls);

  // Étoiles d'une note (1 à 5, demi-étoile arrondie à l'entier le plus proche pour l'affichage)
  const etoiles = (note, cls = '') => {
    const n = Math.round(+note || 0);
    return `<span class="etoiles ${cls}" role="img" aria-label="${n} étoile${n > 1 ? 's' : ''} sur 5">${[1, 2, 3, 4, 5].map(k => `<svg class="ic etoile ${k <= n ? 'pleine' : ''}" viewBox="0 0 24 24" aria-hidden="true">${TRACES.etoile}</svg>`).join('')}</span>`;
  };

  window.K = {
    libMode, icMode, etoiles,
    API_URL, api, session, stock, config, ErreurReseau,
    esc, gnf, eur, montant, kg, date, heure, uid, normTel, ic, toast, modale, vueConnexion, changerMotDePasse, sha256, etiquette,
    positionDuTexte, positionDuLien, gpsActuel, lienCarte, champsAdresse, brancherAdresse, choisirSurCarte, chargerLeaflet,
    lienFacture, ETATS_FACTURE, photoReduite, afficherPhoto, notifications, sectionner, googleDispo, boutonGoogle,
    garderSession, tempsReel, miseAJourAuto, saisieEnCours, adresseVersPosition,
  };
})();
