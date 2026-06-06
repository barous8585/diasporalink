// ── TOAST ──────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}
function toastOk(msg)  { toast(msg, 'ok'); }
function toastErr(msg) { toast(msg, 'err'); }

// ── LOADER ─────────────────────────────────────────────────
function showLoader()  { document.getElementById('loader')?.classList.add('show'); }
function hideLoader()  { document.getElementById('loader')?.classList.remove('show'); }

// ── NAVIGATION ─────────────────────────────────────────────
function goTo(screen) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === `screen-${screen}`);
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === screen);
  });
  window._currentScreen = screen;
}

// ── FORMAT ─────────────────────────────────────────────────
function formatEur(v)  { return parseFloat(v || 0).toFixed(2) + ' €'; }
function formatDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTel(t)  { return t || '—'; }

// ── BADGE STATUT ───────────────────────────────────────────
function badgeStatut(statut) {
  const map = {
    en_attente:  ['badge-grey', 'En attente'],
    confirme:    ['badge-info', 'Confirmé'],
    collecte:    ['badge-info', 'Collecté'],
    en_transit:  ['badge-go',   'En transit'],
    arrive:      ['badge-go',   'Arrivé'],
    livre:       ['badge-ok',   'Livré'],
    annule:      ['badge-err',  'Annulé'],
  };
  const [cls, label] = map[statut] || ['badge-grey', statut];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ── ICONE SVG (data URL) ────────────────────────────────────
const SVG = {
  box:     (c='%231A8C64', s=20) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/%3E%3Cpolyline points='3.27 6.96 12 12.01 20.73 6.96'/%3E%3Cline x1='12' y1='22.08' x2='12' y2='12'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  user:    (c='%231A8C64', s=20) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  map:     (c='%231A8C64', s=20) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  chat:    (c='%231A8C64', s=20) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  home:    (c='%231A8C64', s=24) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/%3E%3Cpolyline points='9 22 9 12 15 12 15 22'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  plus:    (c='%231A8C64', s=24) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='1.7' stroke-linecap='round' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='8' x2='12' y2='16'/%3E%3Cline x1='8' y1='12' x2='16' y2='12'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  send:    (c='white',     s=18) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='22' y1='2' x2='11' y2='13'/%3E%3Cpolygon points='22 2 15 22 11 13 2 9 22 2' fill='${c}'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  check:   (c='white',     s=14) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  chevron: (c='%23CBCBC6', s=16) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='9 18 15 12 9 6'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
  back:    (c='white',     s=20) => `<img src="data:image/svg+xml,%3Csvg width='${s}' height='${s}' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='15 18 9 12 15 6'/%3E%3C/svg%3E" width="${s}" height="${s}" style="display:block">`,
};

window.UI = { toast, toastOk, toastErr, showLoader, hideLoader, goTo, formatEur, formatDate, badgeStatut, SVG };
