// ── ROUTER: screen navigation with history ─────────────────────────────────

const Router = (() => {
  let current = null;
  let history = [];
  const screens = {};

  const NAV_MAP = {
    'home': 0, 'pickup': 1, 'payment': 1,
    'tracking': 2, 'messages': 3, 'profile': 4
  };

  function register(id, { render, onEnter, onLeave } = {}) {
    screens[id] = { render, onEnter, onLeave };
  }

  function go(id, pushHistory = true) {
    if (id === current) return;

    const prev = current;
    if (prev && screens[prev]?.onLeave) screens[prev].onLeave();

    if (pushHistory && prev) history.push(prev);

    // Render target screen
    const targetEl = document.getElementById(`screen-${id}`);
    if (!targetEl) return;

    if (screens[id]?.render) screens[id].render(targetEl);

    // Animate
    if (prev) {
      const prevEl = document.getElementById(`screen-${prev}`);
      if (prevEl) {
        prevEl.classList.remove('active');
        prevEl.classList.add('prev');
        setTimeout(() => prevEl.classList.remove('prev'), 350);
      }
    }

    targetEl.classList.add('active');
    current = id;

    if (screens[id]?.onEnter) screens[id].onEnter(targetEl);

    updateNavHighlight(id);

    // Update URL param silently
    const url = new URL(window.location);
    url.searchParams.set('screen', id);
    window.history.replaceState({}, '', url);
  }

  function back() {
    if (history.length > 0) {
      const prev = history.pop();
      go(prev, false);
    } else {
      go('home', false);
    }
  }

  function updateNavHighlight(id) {
    const idx = NAV_MAP[id] ?? -1;
    document.querySelectorAll('.nav-item').forEach((btn, i) => {
      btn.classList.toggle('active', i === idx);
    });
  }

  function getCurrent() { return current; }

  return { register, go, back, getCurrent };
})();

window.Router = Router;
