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
    ouvrir(jeton, utilisateur) { stock.ecrire('jeton', jeton); stock.ecrire('utilisateur', utilisateur); },
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
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
    cloche: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    bulle: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    tel: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A17 17 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    lieu: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    prix: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    avion: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>',
    bateau: '<path d="M3 17l2 4h14l2-4H3z"/><path d="M5 17v-6h14v6"/><path d="M9 11V7h6v4"/><path d="M12 7V3"/>',
    ok: '<path d="m5 12 5 5 9-10"/>',
    horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    maison: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
    liste: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    personne: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    horsligne: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8"/><path d="M19 12.9a10 10 0 0 0-2.4-1.7"/><path d="M12 20h.01"/>',
    partager: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    retour: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    suivant: '<path d="m9 6 6 6-6 6"/>',
    billet: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    balance: '<path d="M12 3v18M5 21h14M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    alerte: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
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
    lampe: '<path d="M9 2h6l-1 6h-4z"/><path d="M10 8h4v13h-4z"/>',
    carte: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    reglages: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };
  const ic = (nom, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${TRACES[nom] || ''}</svg>`;

  // ── Toasts ──
  function toast(message, type = '') {
    let zone = document.getElementById('toast');
    if (!zone) { zone = document.createElement('div'); zone.id = 'toast'; zone.setAttribute('role', 'status'); zone.setAttribute('aria-live', 'polite'); document.body.appendChild(zone); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    zone.appendChild(t);
    setTimeout(() => t.remove(), type === 'erreur' ? 5000 : 3000);
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
          <button type="button" class="btn btn-carre" style="width:52px;height:52px" data-voir="${nom}" aria-label="Afficher le mot de passe">${ic('loupe', 'ic-sm')}</button>
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
          ${inscription ? (vue === 'connexion'
            ? `<button class="btn btn-plein" type="button" data-vue="inscription">Pas encore de compte ? Créer un compte</button>`
            : `<button class="btn btn-lien" type="button" data-vue="connexion">J'ai déjà un compte</button>`) : ''}
        </form>`;
      cible.querySelectorAll('[data-vue]').forEach(b => b.addEventListener('click', () => { vue = b.dataset.vue; dessiner(); }));
      cible.querySelectorAll('[data-voir]').forEach(b => b.addEventListener('click', () => {
        const i = cible.querySelector(`[name="${b.dataset.voir}"]`); i.type = i.type === 'password' ? 'text' : 'password';
      }));
      const form = cible.querySelector('form');
      if (!form) return;
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

  // ── Changer son mot de passe (fenêtre) ──
  function changerMotDePasse({ actuel = '', obligatoire = false } = {}) {
    return new Promise((fini) => {
      const { el, fermer } = modale(`
        <form class="pile" style="--gap:14px">
          <div class="ligne entre"><h2>${obligatoire ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'}</h2>${obligatoire ? '' : `<button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button>`}</div>
          ${actuel ? '' : '<label class="champ">Mot de passe actuel <input class="saisie" name="actuel" type="password" autocomplete="current-password" required></label>'}
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
    lib: 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js',
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
          <div style="display:flex;justify-content:space-between;font-weight:700"><span>${esc(config.appCourt || config.app)}</span><span>${esc(sens?.label || '')} · ${c.mode === 'mer' ? 'BATEAU' : 'AVION'}</span></div>
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

  window.K = {
    API_URL, api, session, stock, config, ErreurReseau,
    esc, gnf, eur, montant, kg, date, heure, uid, normTel, ic, toast, modale, vueConnexion, changerMotDePasse, sha256, etiquette,
  };
})();
