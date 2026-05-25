// ── APP: bootstrap ─────────────────────────────────────────────────────────

function showToast(msg) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}
window.showToast = showToast;

function updateTime() {
  const el = document.getElementById('status-time');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

function boot() {
  updateTime();
  setInterval(updateTime, 30000);
  registerSW();

  // Check URL for initial screen
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('screen') || 'home';
  const validScreens = ['home','pickup','payment','tracking','messages','profile'];
  Router.go(validScreens.includes(initial) ? initial : 'home', false);
}

document.addEventListener('DOMContentLoaded', boot);
