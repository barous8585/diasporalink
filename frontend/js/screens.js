// ── ICONES (data URLs — taille fixe garantie sur Android) ──
const IC = {
  box:     "data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/%3E%3Cpolyline points='3.27 6.96 12 12.01 20.73 6.96'/%3E%3Cline x1='12' y1='22.08' x2='12' y2='12'/%3E%3C/svg%3E",
  check:   "data:image/svg+xml,%3Csvg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E",
  plane:   "data:image/svg+xml,%3Csvg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 3L3 10.5l6.75 2.25L12 21l3-6.75L21 3z'/%3E%3C/svg%3E",
  map:     "data:image/svg+xml,%3Csvg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3C/svg%3E",
  clock:   "data:image/svg+xml,%3Csvg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpolyline points='12 6 12 12 16 14'/%3E%3C/svg%3E",
  chat:    "data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E",
  user:    "data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E",
  bell:    "data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9'/%3E%3Cpath d='M13.73 21a2 2 0 0 1-3.46 0'/%3E%3C/svg%3E",
  lock:    "data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='3' y='11' width='18' height='11' rx='2'/%3E%3Cpath d='M7 11V7a5 5 0 0 1 10 0v4'/%3E%3C/svg%3E",
  lockw:   "data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='3' y='11' width='18' height='11' rx='2'/%3E%3Cpath d='M7 11V7a5 5 0 0 1 10 0v4'/%3E%3C/svg%3E",
  pin:     "data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3C/svg%3E",
  send:    "data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='22' y1='2' x2='11' y2='13'/%3E%3Cpolygon points='22 2 15 22 11 13 2 9 22 2' fill='white'/%3E%3C/svg%3E",
  chevron: "data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23CBCBC6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='9 18 15 12 9 6'/%3E%3C/svg%3E",
  clothes: "data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236B6B66' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z'/%3E%3C/svg%3E",
  phone:   "data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236B6B66' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='5' y='2' width='14' height='20' rx='2'/%3E%3Cline x1='12' y1='18' x2='12.01' y2='18'/%3E%3C/svg%3E",
  doc:     "data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236B6B66' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3Cpolyline points='14 2 14 8 20 8'/%3E%3C/svg%3E",
  food:    "data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236B6B66' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M18 8h1a4 4 0 0 1 0 8h-1'/%3E%3Cpath d='M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z'/%3E%3Cline x1='6' y1='1' x2='6' y2='4'/%3E%3Cline x1='10' y1='1' x2='10' y2='4'/%3E%3Cline x1='14' y1='1' x2='14' y2='4'/%3E%3C/svg%3E",
  logout:  "data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C0392B' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'/%3E%3Cpolyline points='16 17 21 12 16 7'/%3E%3Cline x1='21' y1='12' x2='9' y2='12'/%3E%3C/svg%3E",
  circle:  "data:image/svg+xml,%3Csvg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23A0A09A' stroke-width='1.8' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3C/svg%3E",
  home:    "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23A0A09A' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3Cpolyline points='9 22 9 12 15 12 15 22'/%3E%3C/svg%3E",
  homeG:   "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3Cpolyline points='9 22 9 12 15 12 15 22'/%3E%3C/svg%3E",
  plus:    "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23A0A09A' stroke-width='1.7' stroke-linecap='round' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='8' x2='12' y2='16'/%3E%3Cline x1='8' y1='12' x2='16' y2='12'/%3E%3C/svg%3E",
  plusG:   "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.7' stroke-linecap='round' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='8' x2='12' y2='16'/%3E%3Cline x1='8' y1='12' x2='16' y2='12'/%3E%3C/svg%3E",
  mapNav:  "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23A0A09A' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3C/svg%3E",
  mapNavG: "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3C/svg%3E",
  msg:     "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23A0A09A' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E",
  msgG:    "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E",
  profil:  "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23A0A09A' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E",
  profilG: "data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%231A8C64' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E",
};

function img(src, w, h) {
  return `<img src="${src}" width="${w||18}" height="${h||18}" style="display:block;width:${w||18}px;height:${h||18}px" />`;
}

// Met à jour les icônes de la nav selon l'écran actif
function updateNav(active) {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  const items = [
    { screen:'home',     icon:'home',   iconG:'homeG',   label:'Accueil' },
    { screen:'pickup',   icon:'plus',   iconG:'plusG',   label:'Envoyer' },
    { screen:'tracking', icon:'mapNav', iconG:'mapNavG', label:'Suivi'   },
    { screen:'messages', icon:'msg',    iconG:'msgG',    label:'Messages'},
    { screen:'profile',  icon:'profil', iconG:'profilG', label:'Profil'  },
  ];
  nav.innerHTML = items.map((it,i) => {
    const isActive = it.screen === active;
    const dot = it.screen==='tracking' ? `<div class="nav-dot" style="position:absolute;width:7px;height:7px;background:#C0392B;border-radius:50%;top:2px;right:8px;border:2px solid white"></div>` : '';
    return `<button class="nav-item ${isActive?'active':''}" onclick="Router.go('${it.screen}')" style="position:relative">
      <div class="nav-icon">${img(isActive ? IC[it.iconG] : IC[it.icon], 24, 24)}</div>
      <span class="nav-label" style="color:${isActive?'var(--green)':'var(--hint)'};font-weight:${isActive?600:500}">${it.label}</span>
      ${dot}
    </button>`;
  }).join('');
}

// ── HOME ────────────────────────────────────────────────────
function renderHome(el) {
  const { user, colis, countries } = Store.get();
  el.innerHTML = `
    <div class="screen-header">
      <div class="header-top">
        <div class="logo">Diaspora<span>Link</span></div>
        <div class="header-avatar" onclick="Router.go('profile')">${user.initials}</div>
      </div>
      <div class="header-greeting">Bonjour, ${user.name.split(' ')[0]}</div>
      <div class="header-title">Que souhaitez-vous faire ?</div>
    </div>
    <div class="screen-body">
      <div class="hero">
        <div class="hero-text">
          <h3>Nouveau pick-up</h3>
          <p>Collecte à domicile · Livraison en Afrique</p>
        </div>
        <button class="hero-btn" onclick="Router.go('pickup')">Planifier</button>
      </div>
      <div class="section">
        <div class="section-header">
          <span class="section-title">Mes envois</span>
          <button class="section-link" onclick="Router.go('tracking')">Voir tout</button>
        </div>
        <div class="card">
          ${colis.map(c=>`
            <div class="colis-row" onclick="Router.go('tracking')">
              <div class="colis-icon">${img(IC.box,20,20)}</div>
              <div class="colis-main">
                <div class="colis-id">#${c.id}</div>
                <div class="colis-dest">${c.destination} · ${c.recipient}</div>
              </div>
              <div class="colis-right">
                <span class="badge badge-${c.status==='delivered'?'ok':c.status==='transit'?'go':'info'}">${c.statusLabel}</span>
              </div>
              <span class="chevron">${img(IC.chevron,16,16)}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="section">
        <div class="section-header"><span class="section-title">Statistiques</span></div>
        <div class="stats-row">
          <div class="stat"><div class="stat-val">${user.totalShipments}</div><div class="stat-lbl">Colis envoyés</div></div>
          <div class="stat"><div class="stat-val">9</div><div class="stat-lbl">Pays desservis</div></div>
          <div class="stat"><div class="stat-val g">${user.rating}</div><div class="stat-lbl">Note moyenne</div></div>
          <div class="stat"><div class="stat-val">~8j</div><div class="stat-lbl">Délai moyen</div></div>
        </div>
      </div>
      <div class="section">
        <div class="section-header"><span class="section-title">Destinations</span></div>
        <div class="card" style="padding:16px">
          <div style="display:flex;gap:20px;flex-wrap:wrap">
            ${countries.slice(0,6).map(c=>`
              <div onclick="selectDestAndGo('${c.code}')" style="display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;min-width:44px">
                <span style="font-size:28px;line-height:1">${c.flag}</span>
                <span style="font-size:11px;font-weight:500;color:var(--muted)">${c.name.split(' ')[0]}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  updateNav('home');
}
window.selectDestAndGo = (code) => { Store.set('pickupForm',{country:code}); Router.go('pickup'); };

// ── PICKUP ──────────────────────────────────────────────────
function renderPickup(el) {
  const form = Store.get('pickupForm');
  const { countries, slots } = Store.get();
  const pkgs = [
    {key:'clothes',label:'Vêtements',icon:'clothes'},
    {key:'electronics',label:'Électronique',icon:'phone'},
    {key:'documents',label:'Documents',icon:'doc'},
    {key:'food',label:'Alimentaire',icon:'food'},
    {key:'medicine',label:'Médicaments',icon:'box'},
    {key:'mixed',label:'Mixte',icon:'box'},
  ];
  el.innerHTML = `
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div class="header-title">Planifier un pick-up</div>
      <div class="header-sub">Étape 1 sur 2</div>
    </div>
    <div class="screen-body">
      <div class="section" style="padding-top:16px">
        <div class="section-title" style="margin-bottom:10px">Adresse de collecte</div>
        <div class="card">
          <div class="form-block">
            <div class="map-box">
              <div class="map-grid"></div>
              <div class="map-pin-wrap">
                <div class="map-pin">${img(IC.pin,18,18)}</div>
              </div>
              <div class="map-chip">${img(IC.clock,13,13)} Dispo demain</div>
            </div>
            <div class="field">
              <label class="label">Adresse</label>
              <input class="input" id="f-address" type="text" value="${form.address}" placeholder="Numéro, rue, ville…" />
            </div>
            <div class="field-row">
              <div class="field">
                <label class="label">Date</label>
                <input class="input" id="f-date" type="date" value="${form.date}" min="${new Date().toISOString().split('T')[0]}" />
              </div>
              <div class="field">
                <label class="label">Créneau</label>
                <div class="select-wrap">
                  <select class="select" id="f-slot">
                    ${slots.map(s=>`<option value="${s.key}" ${form.slot===s.key?'selected':''}>${s.label}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-title" style="margin-bottom:10px">Destination</div>
        <div class="card">
          <div class="form-block">
            <label class="label">Pays</label>
            <div class="country-grid" id="country-grid">
              ${countries.map(c=>`
                <div class="country-chip ${form.country===c.code?'on':''}" onclick="selectCountry('${c.code}')">
                  <span class="flag">${c.flag}</span>
                  <span>${c.name.split(' ')[0]}</span>
                </div>`).join('')}
            </div>
            <div class="field">
              <label class="label">Ville</label>
              <div class="select-wrap">
                <select class="select" id="f-city">
                  ${(countries.find(c=>c.code===form.country)?.cities||[]).map(v=>`<option ${form.destinationCity===v?'selected':''}>${v}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field" style="margin-top:12px">
              <label class="label">Nom du destinataire</label>
              <input class="input" id="f-rname" type="text" value="${form.recipientName}" placeholder="Prénom Nom" />
            </div>
            <div class="field">
              <label class="label">Téléphone</label>
              <input class="input" id="f-rphone" type="tel" value="${form.recipientPhone}" placeholder="+221 7X XXX XX XX" />
            </div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-title" style="margin-bottom:10px">Colis</div>
        <div class="card">
          <div class="form-block">
            <label class="label">Type de contenu</label>
            <div class="pkg-grid" id="pkg-grid">
              ${pkgs.map(p=>`
                <div class="pkg-chip ${form.packageType===p.key?'on':''}" onclick="selectPkg('${p.key}')">
                  <div class="pkg-icon">${img(IC[p.icon],18,18)}</div>
                  <span>${p.label}</span>
                </div>`).join('')}
            </div>
            <div class="field-row">
              <div class="field">
                <label class="label">Poids (kg)</label>
                <input class="input" id="f-weight" type="number" min="0.1" step="0.5" value="${form.weight}" placeholder="5" />
              </div>
              <div class="field">
                <label class="label">Valeur (€)</label>
                <input class="input" id="f-value" type="number" min="0" value="${form.value}" placeholder="150" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="card" style="border-left:3px solid var(--green)">
          <div class="form-block">
            <div class="section-title" style="margin-bottom:10px">Estimation</div>
            <div id="price-rows"></div>
          </div>
        </div>
      </div>
      <div class="section" style="margin-top:16px">
        <button class="btn btn-primary" onclick="submitPickup()">Continuer vers le paiement</button>
      </div>
    </div>`;
  updatePrice();
  bindPickup();
  updateNav('pickup');
}

function bindPickup() {
  const map=[['f-address','address'],['f-date','date'],['f-slot','slot'],['f-city','destinationCity'],['f-rname','recipientName'],['f-rphone','recipientPhone'],['f-weight','weight'],['f-value','value']];
  map.forEach(([id,key])=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener('input',()=>{ Store.set('pickupForm',{[key]:el.value}); if(['f-weight','f-value'].includes(id)) updatePrice(); });
  });
}
function selectCountry(code) {
  Store.set('pickupForm',{country:code});
  document.querySelectorAll('#country-grid .country-chip').forEach(c=>c.classList.toggle('on',c.getAttribute('onclick').includes(`'${code}'`)));
  const cities=Store.get('countries').find(c=>c.code===code)?.cities||[];
  const sel=document.getElementById('f-city');
  if(sel) sel.innerHTML=cities.map(v=>`<option>${v}</option>`).join('');
  updatePrice();
}
window.selectCountry=selectCountry;
function selectPkg(key) {
  Store.set('pickupForm',{packageType:key});
  document.querySelectorAll('#pkg-grid .pkg-chip').forEach(c=>c.classList.toggle('on',c.getAttribute('onclick').includes(`'${key}'`)));
}
window.selectPkg=selectPkg;
function updatePrice() {
  const p=Store.computePrice();
  const el=document.getElementById('price-rows');
  if(!el) return;
  const f=v=>v.toFixed(2)+' €';
  const w=Store.get('pickupForm').weight;
  el.innerHTML=`
    <div class="recap-line"><span class="lbl">Pick-up à domicile</span><span>${f(p.pickup)}</span></div>
    <div class="recap-line"><span class="lbl">Transport${w?' · '+w+' kg':''}</span><span>${p.transport>0?f(p.transport):'—'}</span></div>
    ${p.insurance>0?`<div class="recap-line"><span class="lbl">Assurance</span><span>${f(p.insurance)}</span></div>`:''}
    <div class="recap-total"><span class="lbl">Total estimé</span><span class="amt">${p.total>p.pickup?f(p.total):'—'}</span></div>`;
}
window.updatePrice=updatePrice;
function submitPickup() {
  const f=Store.get('pickupForm');
  if(!f.date) return showToast('Veuillez choisir une date');
  if(!f.recipientName) return showToast('Nom du destinataire requis');
  if(!f.weight) return showToast('Poids du colis requis');
  Router.go('payment');
}
window.submitPickup=submitPickup;

// ── PAYMENT ─────────────────────────────────────────────────
function renderPayment(el) {
  const p=Store.computePrice();
  const form=Store.get('pickupForm');
  const country=Store.get('countries').find(c=>c.code===form.country);
  const f=v=>v.toFixed(2)+' €';
  el.innerHTML=`
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div class="header-title">Paiement</div>
      <div class="header-sub">Étape 2 sur 2</div>
    </div>
    <div class="screen-body">
      <div class="section" style="padding-top:16px">
        <div class="section-title" style="margin-bottom:10px">Récapitulatif</div>
        <div class="card">
          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)">
            <span style="font-size:28px;line-height:1">${country?.flag}</span>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:600">${country?.name} · ${form.destinationCity}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${form.recipientName} · ${form.weight} kg</div>
            </div>
            <span class="badge badge-grey">${Store.get('slots').find(s=>s.key===form.slot)?.label}</span>
          </div>
          <div class="form-block">
            <div class="recap-line"><span class="lbl">Pick-up à domicile</span><span>${f(p.pickup)}</span></div>
            <div class="recap-line"><span class="lbl">Transport · ${form.weight} kg</span><span>${f(p.transport)}</span></div>
            ${p.insurance>0?`<div class="recap-line"><span class="lbl">Assurance</span><span>${f(p.insurance)}</span></div>`:''}
            <div class="recap-total"><span class="lbl">Total</span><span class="amt">${f(p.total)}</span></div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-title" style="margin-bottom:10px">Moyen de paiement</div>
        <div class="card">
          <div class="pay-row on" onclick="selectPay(this)">
            <div class="pay-logo">💳</div>
            <div class="pay-info"><h4>Carte bancaire</h4><p>Visa · Mastercard</p></div>
            <input type="radio" class="pay-radio" name="pay" checked />
          </div>
          <div class="pay-row" onclick="selectPay(this)">
            <div class="pay-logo">📱</div>
            <div class="pay-info"><h4>Mobile Money</h4><p>Wave · Orange Money</p></div>
            <input type="radio" class="pay-radio" name="pay" />
          </div>
          <div class="pay-row" onclick="selectPay(this)">
            <div class="pay-logo">🏦</div>
            <div class="pay-info"><h4>Virement SEPA</h4><p>Délai 1 jour ouvré</p></div>
            <input type="radio" class="pay-radio" name="pay" />
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-title" style="margin-bottom:10px">Coordonnées carte</div>
        <div class="card">
          <div class="form-block">
            <div class="field">
              <label class="label">Numéro de carte</label>
              <input class="input" type="text" maxlength="19" placeholder="1234 5678 9012 3456" oninput="fmtCard(this)" />
            </div>
            <div class="field-row">
              <div class="field">
                <label class="label">Expiration</label>
                <input class="input" type="text" maxlength="5" placeholder="MM/AA" oninput="fmtExp(this)" />
              </div>
              <div class="field">
                <label class="label">CVV</label>
                <input class="input" type="password" maxlength="3" placeholder="•••" />
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px;color:var(--hint)">
              ${img(IC.lockw,16,16)} <span>Paiement sécurisé · SSL 256 bits</span>
            </div>
          </div>
        </div>
      </div>
      <div class="section" style="margin-top:16px" class="gap10">
        <button class="btn btn-primary" onclick="confirmPayment()">Payer ${f(p.total)}</button>
        <div style="height:10px"></div>
        <button class="btn btn-ghost" onclick="Router.back()">Modifier la commande</button>
      </div>
    </div>`;
  updateNav('payment');
}
function selectPay(el){document.querySelectorAll('.pay-row').forEach(r=>r.classList.remove('on'));el.classList.add('on');el.querySelector('input').checked=true;}
window.selectPay=selectPay;
window.fmtCard=el=>{let v=el.value.replace(/\D/g,'').slice(0,16);el.value=v.replace(/(.{4})/g,'$1 ').trim();};
window.fmtExp=el=>{let v=el.value.replace(/\D/g,'').slice(0,4);if(v.length>=2)v=v.slice(0,2)+'/'+v.slice(2);el.value=v;};
function confirmPayment(){showToast('Paiement confirmé — pick-up planifié');setTimeout(()=>Router.go('tracking'),1400);}
window.confirmPayment=confirmPayment;

// ── TRACKING ────────────────────────────────────────────────
function renderTracking(el) {
  const colis=Store.get('colis');
  const active=colis.find(c=>c.status==='transit');
  el.innerHTML=`
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div class="header-title">Suivi de colis</div>
    </div>
    <div class="screen-body">
      ${active?`
        <div class="track-alert">
          <div class="track-alert-id">#${active.id}</div>
          <div class="track-alert-dest">${active.destination} · ${active.recipient}</div>
          <span class="badge badge-go">${active.statusLabel}</span>
          <div class="track-loc">${img(IC.map,15,15)} <span>Actuellement à Roissy CDG · Vol AF541</span></div>
        </div>
        <div class="section">
          <div class="section-title" style="margin-bottom:10px">Étapes</div>
          <div class="card">
            <div style="padding:16px">
              <div class="tl">
                ${active.steps.map((s,i)=>{
                  const isLast=i===active.steps.length-1;
                  const dotCls=s.done?'done':s.active?'now':'';
                  const ico=s.done?img(IC.check,14,14):s.active?img(IC.plane,14,14):img(IC.circle,14,14);
                  return `<div class="tl-row">
                    <div class="tl-left">
                      <div class="tl-dot ${dotCls}">${ico}</div>
                      ${!isLast?`<div class="tl-line ${s.done?'done':''}"></div>`:''}
                    </div>
                    <div class="tl-content ${s.active?'now':''}">
                      <h4>${s.label}</h4><p>${s.detail}</p>
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="section" style="margin-top:12px">
          <button class="btn btn-outline" onclick="Router.go('messages')" style="gap:10px">
            ${img(IC.chat,18,18)} <span>Contacter le livreur</span>
          </button>
        </div>`:''}
      <div class="section" style="margin-top:16px">
        <div class="section-title" style="margin-bottom:10px">Tous mes envois</div>
        <div class="card">
          ${colis.map(c=>`
            <div class="colis-row">
              <div class="colis-icon">${img(IC.box,20,20)}</div>
              <div class="colis-main">
                <div class="colis-id">#${c.id}</div>
                <div class="colis-dest">${c.destination}</div>
              </div>
              <div class="colis-right">
                <div class="colis-price">${c.price.toFixed(2)} €</div>
                <div class="colis-date">${c.date}</div>
              </div>
              <span class="chevron">${img(IC.chevron,16,16)}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  updateNav('tracking');
}

// ── MESSAGES ────────────────────────────────────────────────
function renderMessages(el) {
  const msgs=Store.get('messages');
  el.innerHTML=`
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
        <div style="width:9px;height:9px;border-radius:50%;background:#4ade80;flex-shrink:0"></div>
        <div>
          <div style="font-size:14px;font-weight:600;color:white">Colis #DL-2048</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.5)">Moussa Diallo · Livreur</div>
        </div>
      </div>
    </div>
    <div class="screen-body" id="chat-body" style="padding-bottom:0">
      <div class="chat-list" id="chat-list">
        ${msgs.map(m=>msgHtml(m)).join('')}
      </div>
    </div>
    <div class="chat-bar">
      <input class="chat-input" id="chat-in" type="text" placeholder="Votre message…" onkeydown="chatKey(event)" />
      <button class="chat-send" onclick="sendMsg()">${img(IC.send,18,18)}</button>
    </div>`;
  updateNav('messages');
  setTimeout(()=>{const b=document.getElementById('chat-body');if(b)b.scrollTop=b.scrollHeight;},50);
}

function msgHtml(m) {
  if(m.from==='system') return `<div class="bubble bubble-sys"><div class="bubble-body">${m.text}</div><div class="bubble-time">${m.time}</div></div>`;
  if(m.from==='agent') return `<div class="bubble bubble-agent"><div class="bubble-sender">${m.sender}</div><div class="bubble-body">${m.text}</div><div class="bubble-time">${m.time}</div></div>`;
  return `<div class="bubble bubble-user"><div class="bubble-body">${m.text}</div><div class="bubble-time">${m.time}</div></div>`;
}
function sendMsg(){
  const inp=document.getElementById('chat-in');
  if(!inp||!inp.value.trim())return;
  const time=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  const msg={id:Date.now(),from:'user',text:inp.value.trim(),time};
  const msgs=Store.get('messages');msgs.push(msg);Store.set('messages',msgs);
  const list=document.getElementById('chat-list');
  if(list){const d=document.createElement('div');d.innerHTML=msgHtml(msg);list.appendChild(d.firstChild);}
  inp.value='';
  const b=document.getElementById('chat-body');if(b)b.scrollTop=b.scrollHeight;
  setTimeout(()=>{
    const reply={id:Date.now()+1,from:'agent',sender:'Moussa · Livreur',text:'Message reçu, je vous tiens informé.',time:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})};
    msgs.push(reply);Store.set('messages',msgs);
    const l2=document.getElementById('chat-list');
    if(l2){const d2=document.createElement('div');d2.innerHTML=msgHtml(reply);l2.appendChild(d2.firstChild);}
    const b2=document.getElementById('chat-body');if(b2)b2.scrollTop=b2.scrollHeight;
  },1500);
}
window.sendMsg=sendMsg;
window.chatKey=e=>{if(e.key==='Enter')sendMsg();};

// ── PROFILE ─────────────────────────────────────────────────
function renderProfile(el) {
  const {user,colis}=Store.get();
  const menuItems=[
    {icon:'user', label:'Informations personnelles',sub:'Nom, téléphone, adresse'},
    {icon:'pin',  label:'Adresses enregistrées',    sub:user.address},
    {icon:'bell', label:'Notifications',            sub:'Push, SMS, Email'},
    {icon:'lock', label:'Sécurité',                 sub:'Mot de passe, biométrie'},
    {icon:'doc',  label:'Conditions & confidentialité',sub:'CGU, données personnelles'},
  ];
  el.innerHTML=`
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div class="profile-top">
        <div class="profile-av">${user.initials}</div>
        <div>
          <div class="profile-name">${user.name}</div>
          <div class="profile-email">${user.email}</div>
        </div>
      </div>
    </div>
    <div class="screen-body">
      <div class="section" style="padding-top:16px">
        <div class="stats-row">
          <div class="stat"><div class="stat-val">${user.totalShipments}</div><div class="stat-lbl">Envois totaux</div></div>
          <div class="stat"><div class="stat-val">${user.totalSpent} €</div><div class="stat-lbl">Total dépensé</div></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title" style="margin-bottom:10px">Historique</div>
        <div class="card">
          ${colis.map(c=>`
            <div class="colis-row">
              <div class="colis-icon">${img(IC.box,20,20)}</div>
              <div class="colis-main">
                <div class="colis-id">#${c.id}</div>
                <div class="colis-dest">${c.destination} · ${c.date}</div>
              </div>
              <div class="colis-right">
                <div class="colis-price">${c.price.toFixed(2)} €</div>
                <span class="badge badge-${c.status==='delivered'?'ok':'go'}" style="font-size:10px">${c.statusLabel}</span>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="section">
        <div class="section-title" style="margin-bottom:10px">Paramètres</div>
        <div class="card">
          ${menuItems.map(item=>`
            <div class="menu-row">
              <div class="menu-ico">${img(IC[item.icon],18,18)}</div>
              <div class="menu-txt"><h4>${item.label}</h4><p>${item.sub}</p></div>
              <div class="menu-arr">${img(IC.chevron,16,16)}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="section" style="margin-top:8px;margin-bottom:8px">
        <div class="card">
          <div class="menu-row" onclick="showToast('Déconnexion…')">
            <div class="menu-ico" style="background:#FDECEA">${img(IC.logout,18,18)}</div>
            <div class="menu-txt"><h4 style="color:var(--danger)">Se déconnecter</h4></div>
          </div>
        </div>
      </div>
    </div>`;
  updateNav('profile');
}

Router.register('home',     {render:renderHome});
Router.register('pickup',   {render:renderPickup});
Router.register('payment',  {render:renderPayment});
Router.register('tracking', {render:renderTracking});
Router.register('messages', {render:renderMessages});
Router.register('profile',  {render:renderProfile});
