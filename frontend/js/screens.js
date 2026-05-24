// ── SCREENS ────────────────────────────────────────────────────────────────

// ─── HOME ──────────────────────────────────────────────────────────────────
function renderHome(el) {
  const { user, colis } = Store.get();

  el.innerHTML = `
    <div class="screen-header">
      <div class="header-top">
        <div class="logo">Diaspora<span>Link</span></div>
        <div class="header-avatar" onclick="Router.go('profile')">${user.initials}</div>
      </div>
      <div class="header-greeting">Bonjour, ${user.name.split(' ')[0]} 👋</div>
      <div class="header-title">Où envoyez-vous votre colis ?</div>
    </div>

    <div class="screen-body">
      <div class="hero-banner">
        <div class="hero-text">
          <h3>Pick-up à domicile</h3>
          <p>On vient chercher votre colis, où que vous soyez en France.</p>
        </div>
        <button class="hero-cta" onclick="Router.go('pickup')">Planifier</button>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="section-title">Mes colis</span>
          <span style="font-size:13px;color:var(--brand);cursor:pointer;font-weight:500" onclick="Router.go('tracking')">Voir tout</span>
        </div>
        <div class="card" style="padding:12px 16px">
          ${colis.map(c => `
            <div class="colis-item" onclick="Router.go('tracking')">
              <div class="colis-icon-wrap">${c.flag}</div>
              <div class="colis-info">
                <h4>#${c.id}</h4>
                <p>${c.destination} · ${c.recipient}</p>
              </div>
              <div class="colis-right">
                <span class="badge badge-${c.status === 'delivered' ? 'success' : c.status === 'transit' ? 'warning' : 'info'}">${c.statusLabel}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-val">${user.totalShipments}</div>
          <div class="stat-lbl">Colis envoyés</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">9 pays</div>
          <div class="stat-lbl">Destinations actives</div>
        </div>
        <div class="stat-card">
          <div class="stat-val green">${user.rating} ★</div>
          <div class="stat-lbl">Votre note</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">~8j</div>
          <div class="stat-lbl">Délai moyen</div>
        </div>
      </div>

      <div class="card">
        <div class="card-label">Destinations populaires</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${Store.get('countries').slice(0,5).map(c => `
            <div onclick="selectDestAndGo('${c.code}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;min-width:48px">
              <div style="font-size:28px">${c.flag}</div>
              <div style="font-size:10px;color:var(--text-secondary);font-weight:500">${c.name.split(' ')[0]}</div>
            </div>
          `).join('')}
          <div onclick="Router.go('pickup')" style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;min-width:48px">
            <div style="font-size:28px;width:40px;height:40px;border-radius:50%;background:var(--surface2);border:1px dashed var(--border-med);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text-hint)">+</div>
            <div style="font-size:10px;color:var(--text-secondary);font-weight:500">Plus</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function selectDestAndGo(code) {
  Store.set('pickupForm', { country: code });
  Router.go('pickup');
}
window.selectDestAndGo = selectDestAndGo;

// ─── PICKUP ────────────────────────────────────────────────────────────────
function renderPickup(el) {
  const form = Store.get('pickupForm');
  const countries = Store.get('countries');
  const slots = Store.get('slots');
  const packageTypes = Store.get('packageTypes');

  el.innerHTML = `
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div class="header-title">Planifier un pick-up</div>
      <div class="header-subtitle">Étape 1 sur 2</div>
    </div>

    <div class="screen-body">
      <!-- Map -->
      <div class="card" style="padding:14px">
        <div class="card-label">Adresse de collecte</div>
        <div class="map-placeholder" style="margin-bottom:14px">
          <div class="map-pin-emoji">📍</div>
          <div class="map-eta-chip">🕐 Disponible demain</div>
        </div>
        <div class="form-group">
          <label class="form-label">Adresse complète</label>
          <input class="form-input" id="f-address" type="text" value="${form.address}" placeholder="Numéro, rue, ville..." />
        </div>
        <div class="form-row" style="margin-top:10px">
          <div class="form-group">
            <label class="form-label">Date souhaitée</label>
            <input class="form-input" id="f-date" type="date" value="${form.date}" min="${new Date().toISOString().split('T')[0]}" />
          </div>
          <div class="form-group">
            <label class="form-label">Créneau</label>
            <div class="select-wrap">
              <select class="form-select" id="f-slot">
                ${slots.map(s => `<option value="${s.key}" ${form.slot===s.key?'selected':''}>${s.label}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Destination -->
      <div class="card">
        <div class="card-label">Pays de destination</div>
        <div class="destination-countries" id="country-grid">
          ${countries.map(c => `
            <div class="country-chip ${form.country===c.code?'selected':''}" onclick="selectCountry('${c.code}')">
              <span class="flag">${c.flag}</span>
              <span>${c.name.split(' ')[0]}</span>
            </div>
          `).join('')}
        </div>
        <div style="margin-top:12px" class="form-group">
          <label class="form-label">Ville de livraison</label>
          <div class="select-wrap">
            <select class="form-select" id="f-city">
              ${(countries.find(c=>c.code===form.country)?.cities||[]).map(city=>`<option ${form.destinationCity===city?'selected':''}>${city}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:10px" class="form-group">
          <label class="form-label">Nom du destinataire</label>
          <input class="form-input" id="f-recipient-name" type="text" value="${form.recipientName}" placeholder="Prénom Nom" />
        </div>
        <div style="margin-top:10px" class="form-group">
          <label class="form-label">Téléphone du destinataire</label>
          <input class="form-input" id="f-recipient-phone" type="tel" value="${form.recipientPhone}" placeholder="+221 7X XXX XX XX" />
        </div>
      </div>

      <!-- Package -->
      <div class="card">
        <div class="card-label">Type de colis</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
          ${packageTypes.map(p => `
            <div onclick="selectPkgType('${p.key}')" class="country-chip ${form.packageType===p.key?'selected':''}" style="flex-direction:column;gap:3px">
              <span style="font-size:20px">${p.icon}</span>
              <span style="font-size:10px">${p.label.split(' ')[0]}</span>
            </div>
          `).join('')}
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Poids estimé (kg)</label>
            <input class="form-input" id="f-weight" type="number" min="0.1" step="0.5" value="${form.weight}" placeholder="5" />
          </div>
          <div class="form-group">
            <label class="form-label">Valeur déclarée (€)</label>
            <input class="form-input" id="f-value" type="number" min="0" value="${form.value}" placeholder="150" />
          </div>
        </div>
      </div>

      <!-- Price preview -->
      <div class="card" id="price-preview" style="background:var(--brand-pale);border-color:rgba(29,158,117,0.2)">
        <div class="card-label">Estimation tarifaire</div>
        <div id="price-rows"></div>
      </div>

      <button class="btn btn-primary" onclick="submitPickup()">
        Continuer vers le paiement →
      </button>
    </div>
  `;

  updatePricePreview();
  bindPickupInputs();
}

function bindPickupInputs() {
  const ids = ['f-address','f-date','f-slot','f-city','f-recipient-name','f-recipient-phone','f-weight','f-value'];
  const keys = ['address','date','slot','destinationCity','recipientName','recipientPhone','weight','value'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      Store.set('pickupForm', { [keys[i]]: el.value });
      if (id === 'f-weight' || id === 'f-value') updatePricePreview();
    });
  });
}

function selectCountry(code) {
  Store.set('pickupForm', { country: code });
  document.querySelectorAll('#country-grid .country-chip').forEach(c => {
    c.classList.toggle('selected', c.getAttribute('onclick').includes(`'${code}'`));
  });
  const countries = Store.get('countries');
  const cities = countries.find(c=>c.code===code)?.cities || [];
  const sel = document.getElementById('f-city');
  if (sel) sel.innerHTML = cities.map(city=>`<option>${city}</option>`).join('');
  updatePricePreview();
}
window.selectCountry = selectCountry;

function selectPkgType(key) {
  Store.set('pickupForm', { packageType: key });
  document.querySelectorAll('#screen-pickup .country-chip[onclick^="selectPkgType"]').forEach(el => {
    el.classList.toggle('selected', el.getAttribute('onclick').includes(`'${key}'`));
  });
}
window.selectPkgType = selectPkgType;

function updatePricePreview() {
  const p = Store.computePrice();
  const container = document.getElementById('price-rows');
  if (!container) return;
  const fmt = v => v.toFixed(2) + ' €';
  container.innerHTML = `
    <div class="recap-row"><span class="label">Pick-up à domicile</span><span class="amount">${fmt(p.pickup)}</span></div>
    <div class="recap-row"><span class="label">Transport (${Store.get('pickupForm').weight||'?'} kg)</span><span class="amount">${p.transport>0?fmt(p.transport):'—'}</span></div>
    ${p.insurance>0?`<div class="recap-row"><span class="label">Assurance colis</span><span class="amount">${fmt(p.insurance)}</span></div>`:''}
    <div class="recap-total"><span class="label">Total estimé</span><span class="amount">${p.total>Store.get('pickupFee')?fmt(p.total):'—'}</span></div>
  `;
}
window.updatePricePreview = updatePricePreview;

function submitPickup() {
  const form = Store.get('pickupForm');
  if (!form.date) { showToast('Veuillez choisir une date de pick-up'); return; }
  if (!form.recipientName) { showToast('Veuillez saisir le nom du destinataire'); return; }
  if (!form.weight) { showToast('Veuillez indiquer le poids du colis'); return; }
  Router.go('payment');
}
window.submitPickup = submitPickup;

// ─── PAYMENT ───────────────────────────────────────────────────────────────
function renderPayment(el) {
  const price = Store.computePrice();
  const form = Store.get('pickupForm');
  const countries = Store.get('countries');
  const country = countries.find(c=>c.code===form.country);
  const fmt = v => v.toFixed(2) + ' €';

  el.innerHTML = `
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div class="header-title">Paiement</div>
      <div class="header-subtitle">Étape 2 sur 2</div>
    </div>

    <div class="screen-body">
      <!-- Summary -->
      <div class="card">
        <div class="card-label">Récapitulatif de commande</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px;background:var(--brand-pale);border-radius:var(--radius-md)">
          <span style="font-size:24px">${country?.flag||'📦'}</span>
          <div>
            <div style="font-size:14px;font-weight:500">${country?.name||''} · ${form.destinationCity||''}</div>
            <div style="font-size:12px;color:var(--text-secondary)">Pour : ${form.recipientName} · ${form.weight} kg</div>
          </div>
          <span class="badge badge-neutral" style="margin-left:auto">${Store.get('slots').find(s=>s.key===form.slot)?.label||''}</span>
        </div>
        <div class="recap-row"><span class="label">Pick-up à domicile</span><span class="amount">${fmt(price.pickup)}</span></div>
        <div class="recap-row"><span class="label">Transport (${form.weight} kg · ${country?.name})</span><span class="amount">${fmt(price.transport)}</span></div>
        ${price.insurance>0?`<div class="recap-row"><span class="label">Assurance colis</span><span class="amount">${fmt(price.insurance)}</span></div>`:''}
        <div class="recap-total"><span class="label">Total</span><span class="amount">${fmt(price.total)}</span></div>
      </div>

      <!-- Payment method -->
      <div class="card">
        <div class="card-label">Mode de paiement</div>
        <div class="pay-method selected" onclick="selectPay(this)">
          <div class="pay-icon-wrap">💳</div>
          <div class="pay-info">
            <h4>Carte bancaire</h4>
            <p>Visa · Mastercard · Maestro</p>
          </div>
          <input type="radio" class="pay-radio" name="pay" checked />
        </div>
        <div class="pay-method" onclick="selectPay(this)">
          <div class="pay-icon-wrap">📱</div>
          <div class="pay-info">
            <h4>Mobile Money</h4>
            <p>Wave, Orange Money, MTN</p>
          </div>
          <input type="radio" class="pay-radio" name="pay" />
        </div>
        <div class="pay-method" onclick="selectPay(this)">
          <div class="pay-icon-wrap">🏦</div>
          <div class="pay-info">
            <h4>Virement SEPA</h4>
            <p>Délai : 1 jour ouvré</p>
          </div>
          <input type="radio" class="pay-radio" name="pay" />
        </div>
      </div>

      <!-- Card details -->
      <div class="card" id="card-details-section">
        <div class="card-label">Coordonnées carte</div>
        <div class="form-group">
          <label class="form-label">Numéro de carte</label>
          <input class="form-input" id="f-cardnum" type="text" maxlength="19" placeholder="1234 5678 9012 3456" oninput="formatCardNum(this)" />
        </div>
        <div class="form-row" style="margin-top:10px">
          <div class="form-group">
            <label class="form-label">Date d'expiration</label>
            <input class="form-input" type="text" maxlength="5" placeholder="MM/AA" oninput="formatExpiry(this)" />
          </div>
          <div class="form-group">
            <label class="form-label">CVV</label>
            <input class="form-input" type="text" maxlength="3" placeholder="•••" />
          </div>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:6px">
          <span style="font-size:18px">🔒</span>
          <span style="font-size:11px;color:var(--text-hint)">Paiement sécurisé · Chiffrement SSL 256 bits</span>
        </div>
      </div>

      <button class="btn btn-primary" onclick="confirmPayment()">
        🔒 Payer ${fmt(price.total)}
      </button>
      <button class="btn btn-ghost" style="margin-top:8px" onclick="Router.back()">Modifier la commande</button>
    </div>
  `;
}

function selectPay(el) {
  document.querySelectorAll('.pay-method').forEach(m => m.classList.remove('selected'));
  el.classList.add('selected');
  el.querySelector('input[type=radio]').checked = true;
}
window.selectPay = selectPay;

function formatCardNum(el) {
  let v = el.value.replace(/\D/g,'').slice(0,16);
  el.value = v.replace(/(.{4})/g,'$1 ').trim();
}
window.formatCardNum = formatCardNum;

function formatExpiry(el) {
  let v = el.value.replace(/\D/g,'').slice(0,4);
  if (v.length >= 2) v = v.slice(0,2) + '/' + v.slice(2);
  el.value = v;
}
window.formatExpiry = formatExpiry;

function confirmPayment() {
  showToast('Paiement confirmé ✓ Pick-up planifié !');
  setTimeout(() => Router.go('tracking'), 1500);
}
window.confirmPayment = confirmPayment;

// ─── TRACKING ──────────────────────────────────────────────────────────────
function renderTracking(el) {
  const colis = Store.get('colis');
  const active = colis.find(c => c.status === 'transit');

  el.innerHTML = `
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div class="header-title">Suivi de colis</div>
    </div>

    <div class="screen-body">
      ${active ? `
        <div class="card" style="border-color:rgba(239,159,39,0.3);background:linear-gradient(135deg,var(--surface),#fffdf5)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div style="font-size:11px;color:var(--text-hint);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Colis actif · #${active.id}</div>
              <div style="font-family:var(--font-display);font-size:17px;font-weight:700;margin-top:3px">${active.destination}</div>
              <div style="font-size:13px;color:var(--text-secondary)">Pour : ${active.recipient}</div>
            </div>
            <span class="badge badge-warning">${active.flag} ${active.statusLabel}</span>
          </div>
          <div style="background:var(--accent-light);border-radius:var(--radius-md);padding:10px 12px;font-size:13px;color:var(--accent-dark);display:flex;align-items:center;gap:8px">
            <span style="font-size:16px">✈️</span>
            <span>Actuellement à Roissy CDG · Vol AF541</span>
          </div>
        </div>

        <div class="card">
          <div class="card-label">Étapes de livraison</div>
          <div class="timeline">
            ${active.steps.map((step, i) => {
              const isLast = i === active.steps.length - 1;
              const dotClass = step.done ? 'done' : step.active ? 'active' : 'todo';
              const icon = step.done ? '✓' : step.active ? '✈' : '○';
              const lineClass = step.done ? 'done' : '';
              return `
                <div class="tl-step">
                  <div class="tl-left">
                    <div class="tl-dot ${dotClass}">${icon}</div>
                    ${!isLast ? `<div class="tl-line ${lineClass}"></div>` : ''}
                  </div>
                  <div class="tl-content ${step.active?'active':''}">
                    <h4>${step.label}</h4>
                    <p>${step.detail}</p>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <button class="btn btn-outline" onclick="Router.go('messages')">
          💬 Contacter le livreur
        </button>
      ` : ''}

      <div>
        <div class="section-title" style="margin-bottom:10px">Tous mes colis</div>
        <div class="card" style="padding:12px 16px">
          ${colis.map(c => `
            <div class="colis-item">
              <div class="colis-icon-wrap">${c.flag}</div>
              <div class="colis-info">
                <h4>#${c.id}</h4>
                <p>${c.destination} · ${c.date}</p>
              </div>
              <div class="colis-right">
                <div class="colis-price">${c.price.toFixed(2)} €</div>
                <span class="badge badge-${c.status==='delivered'?'success':c.status==='transit'?'warning':'info'}" style="font-size:10px">${c.statusLabel}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ─── MESSAGES ──────────────────────────────────────────────────────────────
function renderMessages(el) {
  const messages = Store.get('messages');

  el.innerHTML = `
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:2px">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:18px">🚚</div>
        <div>
          <div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:white">Colis #DL-2048</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.65)">Moussa Diallo · En ligne</div>
        </div>
        <div style="margin-left:auto">
          <div style="width:8px;height:8px;border-radius:50%;background:#4ade80;margin-left:8px"></div>
        </div>
      </div>
    </div>

    <div class="screen-body" id="chat-body" style="padding-bottom:8px">
      <div class="chat-list" id="chat-list">
        ${messages.map(m => renderMessage(m)).join('')}
      </div>
    </div>

    <div class="chat-input-area">
      <input class="chat-text-input" id="chat-input" type="text" placeholder="Votre message…" onkeydown="chatKeydown(event)" />
      <button class="chat-send-btn" onclick="sendMessage()">➤</button>
    </div>
  `;

  // Scroll to bottom
  setTimeout(() => {
    const body = document.getElementById('chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, 50);
}

function renderMessage(m) {
  if (m.from === 'system') {
    return `<div class="chat-bubble system"><div class="bubble-text">${m.text}</div><div class="bubble-time">${m.time}</div></div>`;
  }
  if (m.from === 'agent') {
    return `<div class="chat-bubble agent"><div class="bubble-sender">${m.sender}</div><div class="bubble-text">${m.text}</div><div class="bubble-time">${m.time}</div></div>`;
  }
  return `<div class="chat-bubble user"><div class="bubble-text">${m.text}</div><div class="bubble-time right">${m.time}</div></div>`;
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const msg = { id: Date.now(), from: 'user', text, time };
  const msgs = Store.get('messages');
  msgs.push(msg);
  Store.set('messages', msgs);
  const list = document.getElementById('chat-list');
  if (list) {
    const div = document.createElement('div');
    div.innerHTML = renderMessage(msg);
    list.appendChild(div.firstChild);
  }
  input.value = '';
  const body = document.getElementById('chat-body');
  if (body) body.scrollTop = body.scrollHeight;

  // Simulate reply after 1.5s
  setTimeout(() => {
    const reply = { id: Date.now()+1, from: 'agent', sender: 'Moussa · Votre livreur', text: 'Message bien reçu ! Je vous tiens informé de l\'avancement.', time: new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) };
    msgs.push(reply);
    Store.set('messages', msgs);
    const list2 = document.getElementById('chat-list');
    if (list2) {
      const div2 = document.createElement('div');
      div2.innerHTML = renderMessage(reply);
      list2.appendChild(div2.firstChild);
      const body2 = document.getElementById('chat-body');
      if (body2) body2.scrollTop = body2.scrollHeight;
    }
  }, 1500);
}
window.sendMessage = sendMessage;

function chatKeydown(e) { if (e.key === 'Enter') sendMessage(); }
window.chatKeydown = chatKeydown;

// ─── PROFILE ───────────────────────────────────────────────────────────────
function renderProfile(el) {
  const user = Store.get('user');
  const colis = Store.get('colis');

  el.innerHTML = `
    <div class="screen-header">
      <div class="header-top">
        <button class="header-back" onclick="Router.back()">←</button>
        <div class="logo">Diaspora<span>Link</span></div>
        <div style="width:36px"></div>
      </div>
      <div class="profile-header-ext">
        <div class="profile-avatar-lg">${user.initials}</div>
        <div>
          <div class="profile-name">${user.name}</div>
          <div class="profile-email">${user.email}</div>
        </div>
      </div>
    </div>

    <div class="screen-body">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-val">${user.totalShipments}</div>
          <div class="stat-lbl">Envois totaux</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${user.totalSpent} €</div>
          <div class="stat-lbl">Total dépensé</div>
        </div>
      </div>

      <div class="card">
        <div class="card-label">Historique des envois</div>
        ${colis.map(c => `
          <div class="colis-item">
            <div class="colis-icon-wrap">${c.flag}</div>
            <div class="colis-info">
              <h4>#${c.id}</h4>
              <p>${c.destination} · ${c.date}</p>
            </div>
            <div class="colis-right">
              <div class="colis-price">${c.price.toFixed(2)} €</div>
              <span class="badge badge-${c.status==='delivered'?'success':c.status==='transit'?'warning':'info'}" style="font-size:10px">${c.statusLabel}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="card-label">Mon compte</div>
        ${[
          { icon:'👤', label:'Informations personnelles', sub:'Nom, téléphone, adresse' },
          { icon:'📍', label:'Adresses enregistrées', sub:'${user.address}' },
          { icon:'👥', label:'Mes destinataires', sub:'Gérer mes contacts famille' },
          { icon:'🔔', label:'Notifications', sub:'Push, SMS, Email' },
          { icon:'🔒', label:'Sécurité', sub:'Mot de passe, biométrie' },
          { icon:'📋', label:'Conditions & confidentialité', sub:'CGU, politique données' },
        ].map(item => `
          <div class="menu-item">
            <div class="menu-icon">${item.icon}</div>
            <div class="menu-text">
              <h4>${item.label}</h4>
              <p>${item.sub}</p>
            </div>
            <span class="menu-arrow">›</span>
          </div>
        `).join('')}
      </div>

      <button class="btn btn-ghost" style="color:var(--coral);border-color:var(--coral)" onclick="showToast('Déconnexion…')">
        Se déconnecter
      </button>
    </div>
  `;
}

// Register all screens
Router.register('home',     { render: renderHome });
Router.register('pickup',   { render: renderPickup });
Router.register('payment',  { render: renderPayment });
Router.register('tracking', { render: renderTracking });
Router.register('messages', { render: renderMessages });
Router.register('profile',  { render: renderProfile });
