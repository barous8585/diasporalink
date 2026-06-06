// ── ÉTAT GLOBAL ────────────────────────────────────────────
let APP = {
  config:    null,   // pays, créneaux, types colis
  colis:     [],     // liste des colis
  colisActif: null,  // colis sélectionné
  form: {            // formulaire pickup
    paysCode: 'SN',
    typeColis: 'vetements',
  },
  authTel:    '',
  authNouvel: false,
};

// ── ICONES NAV ──────────────────────────────────────────────
const NAV_ICONS = {
  home:   { off: '%23A0A09A', on: '%231A8C64', path: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/><polyline points='9 22 9 12 15 12 15 22" },
  pickup: { off: '%23A0A09A', on: '%231A8C64', path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'/><line x1='12' y1='8' x2='12' y2='16'/><line x1='8' y1='12' x2='16' y2='12" },
  colis:  { off: '%23A0A09A', on: '%231A8C64', path: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3" },
  profil: { off: '%23A0A09A', on: '%231A8C64', path: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4" },
};

function navIcon(key, active) {
  const ic = NAV_ICONS[key];
  const c = active ? ic.on : ic.off;
  return `data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='${ic.path}'/%3E%3C/svg%3E`;
}

function refreshNavIcons(active) {
  ['home','pickup','colis','profil'].forEach(k => {
    const el = document.getElementById(`nav-${k}-icon`);
    if (el) el.src = navIcon(k, k === active);
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === active);
  });
}

// ── NAVIGATION ──────────────────────────────────────────────
const MAIN_SCREENS = ['home','pickup','paiement','colis','suivi','messages','profil'];

function navGo(screen) {
  // Masquer tous les sous-écrans
  MAIN_SCREENS.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('active', s === screen);
  });

  refreshNavIcons(screen);
  APP.currentScreen = screen;

  // Initialiser le contenu selon l'écran
  if (screen === 'home')   chargerAccueil();
  if (screen === 'pickup') initPickup();
  if (screen === 'colis')  chargerColis();
  if (screen === 'profil') chargerProfil();
}

// ── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Icônes back
  setupBackIcons();

  // Chat send icon
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.innerHTML = UI.SVG.send('%23FFFFFF', 18);

  // Map pin icon
  const mapPin = document.getElementById('map-pin-icon');
  if (mapPin) mapPin.innerHTML = `<img src="data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3C/svg%3E" style="transform:rotate(45deg);width:16px;height:16px;display:block">`;

  // Init nav icons
  refreshNavIcons('home');

  // Charger la config
  try {
    const data = await API.Config.get();
    APP.config = data;
  } catch(e) {
    console.warn('Config non chargée:', e);
  }

  // Déjà connecté ?
  if (API.Auth.estConnecte()) {
    afficherApp();
  } else {
    // Afficher l'écran auth
    document.getElementById('screen-auth').classList.add('active');
    document.getElementById('screen-app').classList.remove('active');
  }

  // OTP input navigation
  setupOTPInputs();
});

function setupBackIcons() {
  const backSrc = `data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='15 18 9 12 15 6'/%3E%3C/svg%3E`;
  ['pickup-back','paiement-back','colis-back','suivi-back','messages-back','profil-back'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<img src="${backSrc}" width="20" height="20" style="display:block">`;
  });
}

function afficherApp() {
  document.getElementById('screen-auth').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  navGo('home');
}

// ── AUTH ────────────────────────────────────────────────────
function setupOTPInputs() {
  const inputs = document.querySelectorAll('.otp-input');
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/,'');
      if (inp.value && i < inputs.length - 1) inputs[i+1].focus();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i-1].focus();
    });
  });
}

function getOTPValue() {
  return Array.from(document.querySelectorAll('.otp-input')).map(i => i.value).join('');
}

function formatTelephone() {
  const raw = document.getElementById('auth-phone').value.replace(/\D/g,'');
  return '+33' + (raw.startsWith('0') ? raw.slice(1) : raw);
}

async function authEnvoyerOTP() {
  const tel = formatTelephone();
  if (tel.length < 10) return UI.toastErr('Numéro invalide');

  APP.authTel = tel;
  UI.showLoader();

  try {
    const res = await API.Auth.envoyerOTP(tel);

    if (res.nouvelUtilisateur) {
      // Afficher fiche d'inscription
      document.getElementById('auth-phone-sheet').style.display = 'none';
      document.getElementById('auth-register-sheet').style.display = 'block';
      APP.authNouvel = true;
    } else {
      afficherOTP(tel);
    }
  } catch(e) {
    UI.toastErr(e.message || 'Erreur envoi SMS');
  } finally {
    UI.hideLoader();
  }
}

async function authCreerCompte() {
  const prenom = document.getElementById('auth-prenom').value.trim();
  const nom    = document.getElementById('auth-nom').value.trim();
  if (!prenom || !nom) return UI.toastErr('Prénom et nom requis');

  UI.showLoader();
  try {
    await API.Auth.envoyerOTP(APP.authTel, prenom, nom);
    afficherOTP(APP.authTel);
  } catch(e) {
    UI.toastErr(e.message || 'Erreur');
  } finally {
    UI.hideLoader();
  }
}

function afficherOTP(tel) {
  document.getElementById('auth-phone-sheet').style.display = 'none';
  document.getElementById('auth-register-sheet').style.display = 'none';
  document.getElementById('auth-otp-sheet').style.display = 'block';
  document.getElementById('auth-otp-desc').textContent = `Code envoyé au ${tel}`;
  document.querySelector('.otp-input').focus();
}

async function authVerifierOTP() {
  const code = getOTPValue();
  if (code.length !== 6) return UI.toastErr('Entrez les 6 chiffres');

  UI.showLoader();
  try {
    await API.Auth.verifierOTP(APP.authTel, code);
    UI.toastOk('Connexion réussie !');
    afficherApp();
  } catch(e) {
    UI.toastErr(e.message || 'Code invalide');
  } finally {
    UI.hideLoader();
  }
}

async function authRenvoyerOTP() {
  UI.showLoader();
  try {
    await API.Auth.envoyerOTP(APP.authTel);
    UI.toastOk('Code renvoyé !');
    document.querySelectorAll('.otp-input').forEach(i => i.value = '');
    document.querySelector('.otp-input').focus();
  } catch(e) {
    UI.toastErr('Erreur renvoi');
  } finally {
    UI.hideLoader();
  }
}

window.authEnvoyerOTP  = authEnvoyerOTP;
window.authCreerCompte = authCreerCompte;
window.authVerifierOTP = authVerifierOTP;
window.authRenvoyerOTP = authRenvoyerOTP;

// ── ACCUEIL ─────────────────────────────────────────────────
async function chargerAccueil() {
  const user = API.getUser();
  if (user) {
    document.getElementById('home-greeting').textContent = `Bonjour, ${user.prenom} 👋`;
    document.getElementById('home-avatar').textContent = user.initiales || (user.prenom[0] + user.nom[0]).toUpperCase();
  }

  // Pays
  const paysEl = document.getElementById('home-pays');
  if (APP.config?.pays && paysEl) {
    paysEl.innerHTML = APP.config.pays.slice(0,6).map(p => `
      <div onclick="pickupSelectPays('${p.code}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;min-width:40px">
        <span style="font-size:26px;line-height:1">${p.drapeau}</span>
        <span style="font-size:10px;font-weight:500;color:var(--muted)">${p.nom.split(' ')[0]}</span>
      </div>`).join('');
  }

  // Colis récents
  try {
    const data = await API.Colis.mesColis();
    APP.colis = data.colis || [];
    renderColisHome(APP.colis.slice(0,3));

    // Stats
    const nbEl = document.querySelector('#home-stats .stat-val');
    if (nbEl) nbEl.textContent = APP.colis.length;

    // Nav dot
    const actif = APP.colis.some(c => c.statut === 'en_transit' || c.statut === 'collecte');
    document.getElementById('nav-dot').style.display = actif ? 'block' : 'none';
  } catch(e) {
    document.getElementById('home-colis-list').innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div>Aucun envoi pour l'instant</div>`;
  }
}

function renderColisHome(liste) {
  const el = document.getElementById('home-colis-list');
  if (!liste.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div>Aucun envoi pour l'instant<br><button class="btn btn-primary btn-sm" style="margin-top:12px;width:auto;padding:0 20px" onclick="navGo('pickup')">Premier envoi</button></div>`;
    return;
  }
  el.innerHTML = liste.map(c => `
    <div class="row" onclick="voirColis('${c._id}')">
      <div class="row-icon">${UI.SVG.box()}</div>
      <div class="row-main">
        <div class="row-title">#${c.numeroSuivi}</div>
        <div class="row-sub">${c.villeDestination}, ${c.paysDestination} · ${c.nomDestinataire}</div>
      </div>
      <div class="row-right">
        ${UI.badgeStatut(c.statut)}
      </div>
    </div>`).join('');
}

// ── PICKUP ──────────────────────────────────────────────────
function initPickup() {
  if (!APP.config) return;

  // Date min = demain
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  document.getElementById('f-date').min = tmr.toISOString().split('T')[0];

  // Créneaux
  const crSel = document.getElementById('f-creneau');
  crSel.innerHTML = APP.config.creneaux.map(c => `<option value="${c.key}">${c.label}</option>`).join('');

  // Pays
  const paysGrid = document.getElementById('f-pays-grid');
  paysGrid.innerHTML = APP.config.pays.map(p => `
    <div class="country-chip ${APP.form.paysCode === p.code ? 'on' : ''}" onclick="pickupSelectPays('${p.code}')">
      <span class="flag">${p.drapeau}</span>
      <span>${p.nom.split(' ')[0]}</span>
    </div>`).join('');

  // Villes du pays sélectionné
  refreshVilles(APP.form.paysCode);

  // Types de colis
  const typeGrid = document.getElementById('f-type-grid');
  const iconsType = { vetements:'👕', electronique:'📱', medicaments:'💊', documents:'📄', alimentaire:'🥫', mixte:'📦' };
  typeGrid.innerHTML = APP.config.typesColis.map(t => `
    <div class="pkg-chip ${APP.form.typeColis === t.key ? 'on' : ''}" onclick="pickupSelectType('${t.key}')">
      <div class="pkg-icon" style="font-size:18px">${iconsType[t.key]||'📦'}</div>
      <span>${t.label}</span>
    </div>`).join('');

  // Écouter changements poids/valeur
  ['f-poids','f-valeur'].forEach(id => {
    document.getElementById(id).oninput = () => rafraichirTarif();
  });
}

function refreshVilles(paysCode) {
  const pays = APP.config?.pays?.find(p => p.code === paysCode);
  const sel  = document.getElementById('f-ville');
  if (sel && pays) {
    sel.innerHTML = pays.villes.map(v => `<option>${v}</option>`).join('');
  }
}

function pickupSelectPays(code) {
  APP.form.paysCode = code;
  document.querySelectorAll('#f-pays-grid .country-chip').forEach(c => {
    c.classList.toggle('on', c.getAttribute('onclick').includes(`'${code}'`));
  });
  refreshVilles(code);
  rafraichirTarif();
}
window.pickupSelectPays = pickupSelectPays;

function pickupSelectType(key) {
  APP.form.typeColis = key;
  document.querySelectorAll('#f-type-grid .pkg-chip').forEach(c => {
    c.classList.toggle('on', c.getAttribute('onclick').includes(`'${key}'`));
  });
}
window.pickupSelectType = pickupSelectType;

async function rafraichirTarif() {
  const poids  = document.getElementById('f-poids').value;
  const valeur = document.getElementById('f-valeur').value;
  if (!poids) return;

  try {
    const data = await API.Colis.tarif(APP.form.paysCode, poids, valeur);
    const t = data.tarif;
    const f = v => parseFloat(v).toFixed(2) + ' €';
    document.getElementById('tarif-preview').innerHTML = `
      <div class="recap-line"><span class="lbl">Pick-up à domicile</span><span>${f(t.fraisCollecte)}</span></div>
      <div class="recap-line"><span class="lbl">Transport · ${t.poids} kg</span><span>${f(t.fraisTransport)}</span></div>
      ${t.fraisAssurance > 0 ? `<div class="recap-line"><span class="lbl">Assurance</span><span>${f(t.fraisAssurance)}</span></div>` : ''}
      <div class="recap-total"><span class="lbl">Total</span><span class="amt">${f(t.total)}</span></div>`;
    APP.form.tarif = t;
  } catch(e) {}
}

async function pickupSuivant() {
  const adresse     = document.getElementById('f-adresse').value.trim();
  const date        = document.getElementById('f-date').value;
  const creneau     = document.getElementById('f-creneau').value;
  const ville       = document.getElementById('f-ville').value;
  const destinataire = document.getElementById('f-destinataire').value.trim();
  const telDest     = document.getElementById('f-tel-dest').value.trim();
  const poids       = document.getElementById('f-poids').value;

  if (!adresse)     return UI.toastErr('Adresse de collecte requise');
  if (!date)        return UI.toastErr('Date de collecte requise');
  if (!destinataire) return UI.toastErr('Nom du destinataire requis');
  if (!telDest)     return UI.toastErr('Téléphone du destinataire requis');
  if (!poids)       return UI.toastErr('Poids du colis requis');

  // Sauvegarder les données du formulaire
  APP.form.adresse     = adresse;
  APP.form.date        = date;
  APP.form.creneau     = creneau;
  APP.form.ville       = ville;
  APP.form.destinataire = destinataire;
  APP.form.telDest     = telDest;
  APP.form.poids       = poids;
  APP.form.valeur      = document.getElementById('f-valeur').value || 0;

  // Afficher le récap sur l'écran paiement
  afficherRecap();
  navGo('paiement');
}
window.pickupSuivant = pickupSuivant;

function afficherRecap() {
  const f    = APP.form;
  const pays = APP.config?.pays?.find(p => p.code === f.paysCode);
  const t    = f.tarif;
  const fmt  = v => parseFloat(v || 0).toFixed(2) + ' €';

  document.getElementById('recap-commande').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <span style="font-size:26px">${pays?.drapeau || ''}</span>
      <div>
        <div style="font-size:14px;font-weight:600">${pays?.nom || f.paysCode} · ${f.ville}</div>
        <div style="font-size:12px;color:var(--muted)">${f.destinataire} · ${f.poids} kg</div>
      </div>
    </div>
    ${t ? `
    <div class="recap-line"><span class="lbl">Pick-up</span><span>${fmt(t.fraisCollecte)}</span></div>
    <div class="recap-line"><span class="lbl">Transport</span><span>${fmt(t.fraisTransport)}</span></div>
    ${t.fraisAssurance > 0 ? `<div class="recap-line"><span class="lbl">Assurance</span><span>${fmt(t.fraisAssurance)}</span></div>` : ''}
    <div class="recap-total"><span class="lbl">Total</span><span class="amt">${fmt(t.total)}</span></div>
    ` : ''}`;

  const btnPayer = document.getElementById('btn-payer');
  if (btnPayer && t) btnPayer.textContent = `Confirmer — ${fmt(t.total)}`;
}

let _payMode = 'carte';
function selectPay(el, mode) {
  _payMode = mode;
  document.querySelectorAll('.pay-row').forEach(r => r.classList.remove('on'));
  el.classList.add('on');
  el.querySelector('input').checked = true;
}
window.selectPay = selectPay;

async function confirmerCommande() {
  UI.showLoader();
  try {
    const f = APP.form;
    const payload = {
      adresseCollecte:  f.adresse,
      villeCollecte:    f.adresse.split(',').pop().trim() || 'France',
      dateCollecte:     new Date(f.date).toISOString(),
      creneau:          f.creneau,
      paysDestination:  f.paysCode,
      villeDestination: f.ville,
      nomDestinataire:  f.destinataire,
      telDestinataire:  f.telDest,
      typeColis:        f.typeColis,
      poidsKg:          parseFloat(f.poids),
      valeurDeclare:    parseFloat(f.valeur) || 0,
    };

    const data = await API.Colis.creer(payload);
    APP.colisActif = data.colis;
    UI.toastOk('Commande confirmée ! 🎉');

    // Réinitialiser le formulaire
    APP.form = { paysCode: 'SN', typeColis: 'vetements' };

    // Aller sur le suivi du colis créé
    setTimeout(() => {
      navGo('colis');
      voirColis(data.colis._id);
    }, 1000);

  } catch(e) {
    UI.toastErr(e.message || 'Erreur création commande');
  } finally {
    UI.hideLoader();
  }
}
window.confirmerCommande = confirmerCommande;

// ── MES COLIS ───────────────────────────────────────────────
async function chargerColis() {
  UI.showLoader();
  try {
    const data = await API.Colis.mesColis();
    APP.colis = data.colis || [];
    renderListeColis();
  } catch(e) {
    UI.toastErr('Erreur chargement');
  } finally {
    UI.hideLoader();
  }
}

function renderListeColis() {
  const el = document.getElementById('colis-list-container');
  if (!APP.colis.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div>Aucun envoi pour l'instant<br><button class="btn btn-primary btn-sm" style="margin-top:12px;width:auto;padding:0 20px" onclick="navGo('pickup')">Premier envoi</button></div>`;
    return;
  }
  el.innerHTML = `<div class="card">${APP.colis.map(c => `
    <div class="row" onclick="voirColis('${c._id}')">
      <div class="row-icon">${UI.SVG.box()}</div>
      <div class="row-main">
        <div class="row-title">#${c.numeroSuivi}</div>
        <div class="row-sub">${c.villeDestination}, ${c.paysDestination} · ${UI.formatDate(c.createdAt)}</div>
      </div>
      <div class="row-right">
        <div class="row-price">${UI.formatEur(c.tarif?.total)}</div>
        ${UI.badgeStatut(c.statut)}
      </div>
    </div>`).join('')}</div>`;
}

async function voirColis(id) {
  UI.showLoader();
  try {
    const data = await API.Colis.unColis(id);
    APP.colisActif = data.colis;
    afficherSuivi(data.colis);
    navGo('suivi');
  } catch(e) {
    UI.toastErr('Erreur chargement');
  } finally {
    UI.hideLoader();
  }
}
window.voirColis = voirColis;

function afficherSuivi(c) {
  document.getElementById('suivi-titre').textContent = `#${c.numeroSuivi}`;

  const el = document.getElementById('suivi-content');
  el.innerHTML = `
    <div class="track-alert">
      <div class="track-id">#${c.numeroSuivi}</div>
      <div class="track-dest">${c.villeDestination}, ${c.paysDestination} · ${c.nomDestinataire}</div>
      ${UI.badgeStatut(c.statut)}
    </div>

    <div>
      <div class="section-title" style="margin-bottom:8px">Étapes de livraison</div>
      <div class="card" style="padding:16px">
        <div class="tl">
          ${(c.etapes || []).map((e, i) => {
            const isLast = i === c.etapes.length - 1;
            const dotCls = e.statut === 'fait' ? 'done' : e.statut === 'en_cours' ? 'now' : '';
            const ico = e.statut === 'fait'
              ? UI.SVG.check()
              : `<div style="width:8px;height:8px;border-radius:50%;background:${e.statut==='en_cours'?'var(--green)':'var(--line2)'}"></div>`;
            return `
              <div class="tl-row">
                <div class="tl-left">
                  <div class="tl-dot ${dotCls}">${ico}</div>
                  ${!isLast ? `<div class="tl-line ${e.statut === 'fait' ? 'done' : ''}"></div>` : ''}
                </div>
                <div class="tl-content ${e.statut === 'en_cours' ? 'now' : ''}">
                  <h4>${e.label}</h4>
                  <p>${e.detail || ''} ${e.completeLe ? '· ' + UI.formatDate(e.completeLe) : ''}</p>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div>
      <div class="section-title" style="margin-bottom:8px">Détails</div>
      <div class="card">
        <div class="row" style="cursor:default">
          <div class="row-main">
            <div class="row-sub">Adresse de collecte</div>
            <div class="row-title">${c.adresseCollecte}</div>
          </div>
        </div>
        <div class="row" style="cursor:default">
          <div class="row-main">
            <div class="row-sub">Date de collecte</div>
            <div class="row-title">${UI.formatDate(c.dateCollecte)}</div>
          </div>
        </div>
        <div class="row" style="cursor:default">
          <div class="row-main">
            <div class="row-sub">Montant payé</div>
            <div class="row-title">${UI.formatEur(c.tarif?.total)}</div>
          </div>
        </div>
      </div>
    </div>

    <button class="btn btn-outline" onclick="ouvrirMessages('${c._id}')">
      ${UI.SVG.chat('%231A8C64', 18)} Contacter le support
    </button>`;
}

// ── MESSAGES ────────────────────────────────────────────────
async function ouvrirMessages(colisId) {
  APP.colisIdMsg = colisId;
  const c = APP.colisActif;
  if (c) document.getElementById('msg-colis-num').textContent = `#${c.numeroSuivi}`;

  UI.showLoader();
  try {
    const data = await API.Messages.lire(colisId);
    renderMessages(data.messages || []);
    navGo('messages');
  } catch(e) {
    UI.toastErr('Erreur chargement messages');
  } finally {
    UI.hideLoader();
  }
}
window.ouvrirMessages = ouvrirMessages;

function renderMessages(msgs) {
  const list = document.getElementById('chat-list');
  if (!msgs.length) {
    list.innerHTML = `<div class="empty-state">Aucun message · Envoyez le premier !</div>`;
    return;
  }
  const userId = API.getUser()?._id;
  list.innerHTML = msgs.map(m => {
    const isUser = m.expediteur?._id === userId || m.fromRole === 'client';
    if (m.role === 'systeme') return `
      <div class="bubble bubble-sys">
        <div class="bubble-body">${m.texte}</div>
        <div class="bubble-time">${new Date(m.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>`;
    return `
      <div class="bubble ${isUser ? 'bubble-user' : 'bubble-agent'}">
        ${!isUser ? `<div class="bubble-sender">${m.expediteur?.prenom || 'Support'}</div>` : ''}
        <div class="bubble-body">${m.texte}</div>
        <div class="bubble-time">${new Date(m.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>`;
  }).join('');

  setTimeout(() => {
    const body = document.getElementById('chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, 50);
}

async function envoyerMsg() {
  const inp   = document.getElementById('chat-input');
  const texte = inp.value.trim();
  if (!texte || !APP.colisIdMsg) return;

  inp.value = '';
  try {
    const data = await API.Messages.envoyer(APP.colisIdMsg, texte);
    const list = document.getElementById('chat-list');
    const msg  = data.message;
    const div  = document.createElement('div');
    div.className = 'bubble bubble-user';
    div.innerHTML = `<div class="bubble-body">${msg.texte}</div><div class="bubble-time">${new Date(msg.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>`;
    list.appendChild(div);
    const body = document.getElementById('chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  } catch(e) {
    UI.toastErr('Erreur envoi');
  }
}
window.envoyerMsg = envoyerMsg;

// ── PROFIL ──────────────────────────────────────────────────
async function chargerProfil() {
  UI.showLoader();
  try {
    const data = await API.Utilisateur.profil();
    const u = data.utilisateur;
    const s = data.stats;

    document.getElementById('profil-av').textContent  = u.initiales || '?';
    document.getElementById('profil-nom').textContent = u.nomComplet || `${u.prenom} ${u.nom}`;
    document.getElementById('profil-tel').textContent = u.telephone;
    document.getElementById('profil-nb-envois').textContent = s.totalEnvois;
    document.getElementById('profil-total').textContent = UI.formatEur(s.totalDepense);

    // Historique
    const hist = document.getElementById('profil-historique');
    if (!APP.colis.length) {
      hist.innerHTML = `<div class="empty-state" style="padding:20px">Aucun envoi</div>`;
    } else {
      hist.innerHTML = APP.colis.slice(0,5).map(c => `
        <div class="row" onclick="voirColis('${c._id}')">
          <div class="row-icon">${UI.SVG.box()}</div>
          <div class="row-main">
            <div class="row-title">#${c.numeroSuivi}</div>
            <div class="row-sub">${c.villeDestination} · ${UI.formatDate(c.createdAt)}</div>
          </div>
          <div class="row-right">
            <div class="row-price">${UI.formatEur(c.tarif?.total)}</div>
            ${UI.badgeStatut(c.statut)}
          </div>
        </div>`).join('');
    }

    // Déconnexion
    document.querySelector('#profil-historique + .card .row').onclick = () => {
      API.Auth.deconnecter();
      location.reload();
    };

  } catch(e) {
    UI.toastErr('Erreur chargement profil');
  } finally {
    UI.hideLoader();
  }
}

// ── SERVICE WORKER ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Exposer navGo globalement
window.navGo = navGo;
