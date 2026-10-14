// ─────────────────────────────────────────────────────────────
//  App agent : dépôt, chargement, arrivée, guichet, remise, caisse
//  Principe : un scan ne se perd jamais. Il est d'abord enregistré sur le
//  téléphone, puis envoyé au serveur dès que le réseau le permet.
// ─────────────────────────────────────────────────────────────
(function () {
  const { api, session, stock, esc, gnf, eur, montant, kg, date, heure, ic, toast, modale, uid, normTel } = K;
  const main = document.getElementById('contenu');
  let CONFIG = null;       // config publique
  let CTX = stock.lire('ctx');   // contexte agent (lots, colis prêts…), gardé hors-ligne
  let arreterCamera = null;

  document.querySelector('[data-recherche]').innerHTML = ic('loupe');

  // ══════════════════════════════════════════════════════════
  //  FILE D'ATTENTE HORS-LIGNE
  // ══════════════════════════════════════════════════════════
  const file = {
    lire: () => stock.lire('file', []),
    ecrire: (f) => stock.ecrire('file', f),
    ajouter(op) { const f = file.lire(); f.push(op); file.ecrire(f); majPastille(); },
  };
  const journal = {
    lire: () => stock.lire('journal', []),
    ajouter(e) { const j = [e, ...journal.lire()].slice(0, 80); stock.ecrire('journal', j); },
    maj(opId, champs) { stock.ecrire('journal', journal.lire().map(e => e.opId === opId ? { ...e, ...champs } : e)); },
  };

  let synchroEnCours = false, derniereErreur = null;
  async function synchroniser() {
    if (synchroEnCours || !session.connecte()) return;
    const enAttente = file.lire();
    if (!enAttente.length) { majPastille(); return; }
    synchroEnCours = true; majPastille();
    const envoyes = new Set(enAttente.map(o => o.opId));
    let relancer = false;
    try {
      // 1. Scans, par paquets
      const scans = enAttente.filter(o => o.type === 'scan');
      if (scans.length) {
        const r = await api.post('/agent/scans', { scans: scans.map(o => o.payload) }, { delai: 30000 });
        const faits = new Set();
        for (const res of r.resultats) {
          if (res.temporaire) continue;
          faits.add(res.opId);
          journal.maj(res.opId, { etat: res.ok ? 'ok' : 'erreur', message: res.ok ? libelleOk(res) : res.erreur, destinataire: res.destinataire, horsLot: res.horsLot });
        }
        file.ecrire(file.lire().filter(o => !faits.has(o.opId)));
      }
      // 2. Remises faites hors-ligne
      for (const op of file.lire().filter(o => o.type === 'remise')) {
        try {
          await api.post('/agent/remise', op.payload);
          file.ecrire(file.lire().filter(o => o.opId !== op.opId));
          journal.maj(op.opId, { etat: 'ok', message: 'Remise enregistrée' });
        } catch (e) {
          if (e.reseau) throw e;
          file.ecrire(file.lire().filter(o => o.opId !== op.opId));
          journal.maj(op.opId, { etat: 'erreur', message: `Remise refusée : ${e.message}` });
          toast(`Remise ${op.payload.numero} refusée : ${e.message}`, 'erreur');
        }
      }
      derniereErreur = null;
      // Des scans ont pu arriver pendant l'envoi : on les envoie tout de suite
      relancer = file.lire().some(o => !envoyes.has(o.opId));
    } catch (e) {
      derniereErreur = e.reseau ? null : e.message;
    } finally {
      synchroEnCours = false;
      if (relancer) setTimeout(synchroniser, 200);
      majPastille();
      document.dispatchEvent(new CustomEvent('journal-maj'));
    }
  }

  function libelleOk(res) {
    if (res.dejaFait) return 'Déjà enregistré';
    return ({ charger: `Chargé · lot ${res.lotCode || ''}`, arrivee: 'Arrivé', guichet: 'Prêt · code envoyé' })[res.action] || 'OK';
  }

  function majPastille() {
    const b = document.querySelector('[data-synchro]');
    const n = file.lire().length;
    const enLigne = navigator.onLine;
    b.className = `pastille-synchro ${derniereErreur ? 'erreur' : !enLigne || n ? 'hors' : ''}`;
    b.innerHTML = synchroEnCours ? `${ic('synchro', 'ic-sm')} Envoi…`
      : !enLigne ? `${ic('horsligne', 'ic-sm')} Hors ligne${n ? ` · ${n}` : ''}`
      : n ? `${ic('synchro', 'ic-sm')} ${n} à envoyer`
      : `${ic('ok', 'ic-sm')} À jour`;
    b.setAttribute('aria-label', n ? `${n} opérations en attente d'envoi` : 'Tout est envoyé');
  }
  document.querySelector('[data-synchro]').addEventListener('click', async () => {
    synchroniser();
    await rafraichirContexte().catch(() => {});
    toast(navigator.onLine ? 'Données à jour.' : 'Hors ligne : données du dernier chargement.');
  });
  window.addEventListener('online', () => { majPastille(); synchroniser(); });
  window.addEventListener('offline', majPastille);
  setInterval(synchroniser, 20000);

  // ══════════════════════════════════════════════════════════
  //  CONTEXTE (lots, colis prêts au guichet) — gardé pour le hors-ligne
  // ══════════════════════════════════════════════════════════
  async function rafraichirContexte() {
    try {
      CTX = await api.get('/agent/contexte');
      // Retire du cache les colis remis hors-ligne pas encore synchronisés
      const remisLocal = new Set(file.lire().filter(o => o.type === 'remise').map(o => o.payload.numero));
      CTX.colisPrets = CTX.colisPrets.filter(c => !remisLocal.has(c.numeroSuivi));
      stock.ecrire('ctx', CTX);
    } catch (e) { if (!e.reseau) throw e; }
    return CTX;
  }
  setInterval(() => { if (navigator.onLine) rafraichirContexte().catch(() => {}); }, 120000);

  // ══════════════════════════════════════════════════════════
  //  NAVIGATION
  // ══════════════════════════════════════════════════════════
  const ONGLETS = {
    depot:     { lib: 'Dépôt',      ic: 'balance', vue: vueDepot },
    chargement:{ lib: 'Chargement', ic: 'lot',     vue: () => vueScan('charger') },
    arrivee:   { lib: 'Arrivée',    ic: 'avion',   vue: () => vueScan('arrivee') },
    guichet:   { lib: 'Guichet',    ic: 'scan',    vue: () => vueScan('guichet') },
    remise:    { lib: 'Remise',     ic: 'ok',      vue: vueRemise },
    caisse:    { lib: 'Caisse',     ic: 'billet',  vue: vueCaisse },
    fiche:     { lib: 'Recherche',  ic: 'loupe',   vue: vueFiche, cache: true },
  };
  function ongletsVisibles() {
    const u = session.utilisateur();
    if (u?.role === 'admin' && !u.lieu) return ['depot', 'chargement', 'arrivee', 'guichet', 'remise', 'caisse'];
    return CTX?.estGuichet ? ['arrivee', 'guichet', 'remise', 'caisse'] : ['depot', 'chargement', 'caisse'];
  }

  function dessinerNav(actif) {
    const nav = document.querySelector('[data-nav]');
    nav.innerHTML = ongletsVisibles().map(k => `<a href="#/${k}" ${k === actif ? 'aria-current="page"' : ''}>${ic(ONGLETS[k].ic)}${ONGLETS[k].lib}</a>`).join('');
    // Toucher l'onglet déjà ouvert le recharge (retour à l'écran de départ)
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', (e) => {
      if (a.getAttribute('href') === location.hash) { e.preventDefault(); router(); }
    }));
  }

  async function router() {
    if (arreterCamera) { try { await arreterCamera(); } catch {} arreterCamera = null; }
    if (!session.connecte()) { return connexion(); }
    const u = session.utilisateur();
    if (!['agent', 'admin'].includes(u.role)) {
      main.innerHTML = `<div class="pile"><h1>Accès réservé</h1><p class="muet">Ce compte n'est pas un compte agent. Demandez à l'administrateur de vous ajouter à l'équipe.</p><button class="btn" data-sortir>Se déconnecter</button></div>`;
      main.querySelector('[data-sortir]').onclick = () => { session.fermer(); router(); };
      return;
    }
    const lieu = CTX?.lieu;
    document.querySelector('[data-qui]').textContent = `${u.prenom} ${u.nom[0]}. · ${lieu?.nom || (u.role === 'admin' ? 'Administrateur' : 'Lieu non défini')}`;
    let onglet = location.hash.replace(/^#\/?/, '').split('/')[0];
    const visibles = ongletsVisibles();
    if (!ONGLETS[onglet] || (!visibles.includes(onglet) && !ONGLETS[onglet].cache)) onglet = visibles[0];
    document.querySelector('[data-titre]').textContent = ONGLETS[onglet].lib;
    dessinerNav(onglet);
    main.innerHTML = '<div class="chargement"></div>';
    try { await ONGLETS[onglet].vue(); }
    catch (e) { main.innerHTML = `<p class="bandeau bandeau-rouge">${esc(e.message)}</p>`; }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', router);
  document.querySelector('[data-recherche]').addEventListener('click', () => { location.hash = '#/fiche'; });

  function connexion() {
    document.querySelector('[data-nav]').innerHTML = '';
    document.querySelector('[data-titre]').textContent = `${CONFIG?.appCourt || 'TMS'} Agent`;
    document.querySelector('[data-qui]').textContent = 'Espace équipe';
    K.vueConnexion(main, {
      titre: 'Connexion agent', inscription: false,
      surSucces: async () => { await rafraichirContexte().catch(() => {}); location.hash = '#/'; router(); },
    });
  }

  // ══════════════════════════════════════════════════════════
  //  SCAN : chargement, arrivée, guichet
  // ══════════════════════════════════════════════════════════
  const ACTIONS = {
    charger: { titre: 'Mettre dans un lot', consigne: 'Scannez chaque colis chargé' },
    arrivee: { titre: 'Réception en Guinée', consigne: 'Scannez chaque colis reçu' },
    guichet: { titre: 'Mise en rayon', consigne: 'Scannez le colis posé sur l\'étagère' },
  };

  async function vueScan(action) {
    const lots = action === 'charger' ? (CTX?.lotsPreparation || []) : action === 'arrivee' ? (CTX?.lotsEnRoute || []) : [];
    let lotChoisi = stock.lire(`lot_${action}`) || lots[0]?.code || '';
    if (lotChoisi && !lots.some(l => l.code === lotChoisi)) lotChoisi = lots[0]?.code || '';
    let manifeste = null; // numéros attendus dans le lot (pour alerter hors-ligne)

    main.innerHTML = `
      <div class="pile">
        ${action !== 'guichet' ? `
          <label class="champ">${action === 'charger' ? 'Lot en préparation' : 'Lot attendu'}
            <select class="saisie saisie-forte" data-lot>
              ${lots.length ? lots.map(l => `<option value="${esc(l.code)}" ${l.code === lotChoisi ? 'selected' : ''}>${esc(l.code)}${l.reference ? ` · ${esc(l.reference)}` : ''}</option>`).join('')
                : `<option value="">${action === 'charger' ? 'Aucun lot ouvert : demandez à l\'admin' : 'Aucun lot en route'}</option>`}
              ${action === 'arrivee' ? '<option value="">Sans lot (colis isolé)</option>' : ''}
            </select>
          </label>
          <div class="carte pile cache" style="--gap:8px" data-avancement></div>` : `
          <label class="champ">Étagère (facultatif)
            <input class="saisie" data-emplacement placeholder="Ex. B-14" value="${esc(stock.lire('emplacement') || '')}" autocomplete="off">
          </label>`}

        <div class="viseur" data-viseur>
          <div class="cadre" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <button class="btn btn-ocre" data-camera style="position:absolute">${ic('scan')} Ouvrir la caméra</button>
          <div class="consigne">${esc(ACTIONS[action].consigne)}</div>
        </div>

        <form class="ligne" data-saisie style="--gap:8px">
          <label class="grandit"><span class="cache">Numéro de suivi</span>
            <input class="saisie saisie-forte" name="numero" placeholder="Taper ou douchette : TMS-26-…" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase">
          </label>
          <button class="btn btn-noir btn-carre" type="submit" aria-label="Valider">${ic('ok')}</button>
        </form>

        <div class="ligne entre"><h3>Derniers scans</h3><span class="petit muet" data-compte></span></div>
        <div class="pile" style="--gap:8px" data-journal></div>
        ${action === 'charger' ? `<p class="petit muet">Quand tout est chargé, l'admin marque le lot « parti » : tous les clients sont prévenus.</p>` : ''}
      </div>`;

    const $ = (s) => main.querySelector(s);
    const viseur = $('[data-viseur]');

    const dessinerJournal = () => {
      const lignes = journal.lire().filter(e => e.action === action).slice(0, 25);
      $('[data-compte]').textContent = lignes.length ? `${lignes.filter(e => e.etat === 'ok').length} OK · ${lignes.filter(e => e.etat === 'attente').length} en attente` : '';
      $('[data-journal]').innerHTML = lignes.length ? lignes.map(e => `
        <div class="scan ${e.etat}">
          <div class="ico">${ic(e.etat === 'ok' ? 'ok' : e.etat === 'erreur' ? 'alerte' : 'horloge', 'ic-sm')}</div>
          <div class="grandit"><div class="gras">${esc(e.numero)}</div><div class="tres-petit">${esc(e.message || '')}${e.destinataire ? ` · ${esc(e.destinataire)}` : ''}</div></div>
          <span class="tres-petit muet">${esc(heure(e.le))}</span>
        </div>`).join('') : '<p class="vide petit">Aucun scan pour le moment.</p>';
    };
    dessinerJournal();
    let delaiManifeste;
    const ecoute = () => {
      dessinerJournal();
      // Met à jour le compteur du lot après chaque envoi
      clearTimeout(delaiManifeste);
      if (action !== 'guichet' && navigator.onLine) delaiManifeste = setTimeout(() => chargerManifeste(), 400);
    };
    document.addEventListener('journal-maj', ecoute);

    async function chargerManifeste() {
      const box = $('[data-avancement]');
      manifeste = null;
      if (!lotChoisi || !box) { box?.classList.add('cache'); return; }
      const enCache = stock.lire(`manifeste_${lotChoisi}`);
      try {
        const r = await api.get(`/lots/${lotChoisi}`);
        manifeste = { numeros: r.manifeste.map(c => c.numeroSuivi), stats: r.stats };
        stock.ecrire(`manifeste_${lotChoisi}`, manifeste);
      } catch { manifeste = enCache; }
      if (!manifeste) { box.classList.add('cache'); return; }
      const fait = action === 'charger' ? manifeste.stats.nb : manifeste.stats.scannesArrivee;
      const total = action === 'charger' ? null : manifeste.stats.nb;
      box.classList.remove('cache');
      box.innerHTML = total ? `
        <div class="ligne entre"><span class="gras">Lot ${esc(lotChoisi)}</span><span class="muet">${fait} / ${total}</span></div>
        <div class="barre"><span style="width:${Math.round(fait / Math.max(total, 1) * 100)}%"></span></div>`
        : `<div class="ligne entre"><span class="gras">Lot ${esc(lotChoisi)}</span><span class="muet">${fait} colis · ${kg(manifeste.stats.poids)}</span></div>`;
    }
    $('[data-lot]')?.addEventListener('change', (e) => { lotChoisi = e.target.value; stock.ecrire(`lot_${action}`, lotChoisi); chargerManifeste(); });
    $('[data-emplacement]')?.addEventListener('input', (e) => stock.ecrire('emplacement', e.target.value.trim()));
    chargerManifeste();

    function enregistrer(numero) {
      numero = Scanner.extraireNumero(numero);
      if (!/^[A-Z]{2,4}-\d{2}-\d{4,6}$/.test(numero)) { Scanner.bip(false); toast(`« ${numero} » n'est pas un numéro de suivi.`, 'erreur'); return; }
      if (action === 'charger' && !lotChoisi) { Scanner.bip(false); toast('Choisissez d\'abord un lot.', 'erreur'); return; }
      const opId = uid();
      const payload = { opId, numero, action, lot: lotChoisi || undefined, emplacement: $('[data-emplacement]')?.value.trim() || undefined, scanneLe: new Date().toISOString() };
      // Alerte immédiate, même hors-ligne, si le colis n'est pas dans le lot attendu
      const horsLot = action === 'arrivee' && manifeste && lotChoisi && !manifeste.numeros.includes(numero);
      file.ajouter({ opId, type: 'scan', payload, le: Date.now() });
      journal.ajouter({ opId, numero, action, etat: horsLot ? 'erreur' : 'attente', message: horsLot ? `Pas dans le lot ${lotChoisi}` : 'En attente d\'envoi', le: Date.now() });
      Scanner.bip(!horsLot);
      viseur.classList.remove('flash', 'flash-erreur'); void viseur.offsetWidth; viseur.classList.add(horsLot ? 'flash-erreur' : 'flash');
      dessinerJournal();
      synchroniser();
    }

    $('[data-saisie]').addEventListener('submit', (e) => {
      e.preventDefault();
      const champ = e.target.numero;
      if (champ.value.trim()) enregistrer(champ.value);
      champ.value = ''; champ.focus();
    });
    $('[data-camera]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (arreterCamera) { await arreterCamera(); arreterCamera = null; btn.innerHTML = `${ic('scan')} Ouvrir la caméra`; return; }
      try {
        btn.disabled = true;
        arreterCamera = await Scanner.demarrer(viseur, enregistrer);
        btn.innerHTML = `${ic('fermer')} Fermer`; btn.style.cssText = 'position:absolute;top:10px;right:10px';
      } catch (err) { toast(err.message || 'Caméra indisponible. Tapez le numéro.', 'erreur'); }
      finally { btn.disabled = false; }
    });
    // Quand on quitte l'onglet, on arrête d'écouter
    window.addEventListener('hashchange', () => document.removeEventListener('journal-maj', ecoute), { once: true });
  }

  // ══════════════════════════════════════════════════════════
  //  DÉPÔT : pesée, prix final, encaissement, étiquette
  // ══════════════════════════════════════════════════════════
  async function vueDepot() {
    main.innerHTML = `
      <div class="pile">
        <form class="pile" style="--gap:8px" data-cherche>
          <h2>Le client a réservé ?</h2>
          <div class="ligne" style="--gap:8px">
            <input class="saisie saisie-forte grandit" name="q" placeholder="N° de suivi ou téléphone" autocomplete="off">
            <button class="btn btn-noir btn-carre" aria-label="Chercher">${ic('loupe')}</button>
          </div>
        </form>
        <div class="pile" style="--gap:8px" data-resultats></div>
        <button class="btn btn-ocre btn-grand btn-plein" data-nouveau>${ic('plus')} Nouveau colis sans réservation</button>
      </div>`;
    main.querySelector('[data-cherche]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      const zone = main.querySelector('[data-resultats]');
      zone.innerHTML = '<div class="chargement"></div>';
      try {
        const r = await api.get(`/agent/reservations?q=${encodeURIComponent(q)}`);
        zone.innerHTML = r.colis.length ? r.colis.map((c, i) => `
          <button class="choix" data-i="${i}" style="width:100%">
            <span class="nom">${esc(c.numeroSuivi)} · ${esc(c.expediteur.nom)}</span>
            <span class="sous">Pour ${esc(c.destinataire.nom)} · ${c.mode === 'mer' ? 'bateau' : 'avion'} · ${kg(c.poidsEstime)} annoncés</span>
          </button>`).join('') : '<p class="vide petit">Aucune réservation trouvée.</p>';
        zone.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => formulaireDepot(r.colis[b.dataset.i])));
      } catch (err) { zone.innerHTML = `<p class="bandeau bandeau-rouge">${esc(err.message)}</p>`; }
    });
    main.querySelector('[data-nouveau]').addEventListener('click', () => formulaireDepot(null));
  }

  function formulaireDepot(resa) {
    const r = resa || {};
    const etat = {
      mode: r.mode || 'air', typeColis: r.typeColis || 'vetements', guichet: r.guichet || CONFIG.guichets[0]?.code,
      assurance: !!r.assurance, payeurArrivee: !!r.payeurArrivee, methode: 'especes', devise: 'EUR',
    };
    main.innerHTML = `
      <form class="pile" data-depot novalidate>
        <div class="ligne"><button type="button" class="btn btn-rond" data-retour aria-label="Retour">${ic('retour')}</button>
          <h2 class="grandit">${resa ? `Réservation ${esc(r.numeroSuivi)}` : 'Nouveau colis'}</h2></div>

        <div class="carte pile" style="--gap:10px">
          <label class="champ">Poids sur la balance (kg)
            <input class="saisie saisie-forte gros-poids" name="poidsReel" type="number" inputmode="decimal" step="0.1" min="0.1" required placeholder="0,0">
          </label>
          ${r.poidsEstime ? `<p class="petit muet centre" data-ecart>Annoncé par le client : ${kg(r.poidsEstime)}</p>` : ''}
        </div>

        <div class="segments" role="group" aria-label="Transport">${CONFIG.modes.map(m => `<button type="button" data-mode="${m.key}" aria-pressed="${etat.mode === m.key}">${esc(m.label)}</button>`).join('')}</div>
        <label class="champ">Contenu
          <select class="saisie" name="typeColis">${CONFIG.typesColis.map(t => `<option value="${t.key}" ${t.key === etat.typeColis ? 'selected' : ''}>${esc(t.label)}${t.surcharge ? ` (+${Math.round(t.surcharge * 100)} %)` : ''}</option>`).join('')}</select>
        </label>
        <div class="grille-2">
          <label class="champ">Cartons <input class="saisie" name="nbCartons" type="number" inputmode="numeric" min="1" value="${r.nbCartons || 1}"></label>
          <label class="champ">Guichet d'arrivée
            <select class="saisie" name="guichet">${CONFIG.guichets.map(g => `<option value="${esc(g.code)}" ${g.code === etat.guichet ? 'selected' : ''}>${esc(g.nom)}</option>`).join('')}</select>
          </label>
        </div>
        <label class="champ">Description <input class="saisie" name="description" value="${esc(r.description || '')}" placeholder="Ex. vêtements, riz, téléphone"></label>

        <h3>Expéditeur</h3>
        <div class="grille-2">
          <label class="champ">Nom <input class="saisie" name="expNom" value="${esc(r.expediteur?.nom || '')}" required></label>
          <label class="champ">Téléphone <input class="saisie" name="expTel" type="tel" inputmode="tel" value="${esc(r.expediteur?.telephone || '')}" required></label>
        </div>
        <h3>Destinataire</h3>
        <div class="grille-2">
          <label class="champ">Nom <input class="saisie" name="destNom" value="${esc(r.destinataire?.nom || '')}" required></label>
          <label class="champ">Téléphone <input class="saisie" name="destTel" type="tel" inputmode="tel" value="${esc(r.destinataire?.telephone || '')}" required placeholder="6XX XX XX XX"></label>
        </div>

        <label class="case"><input type="checkbox" name="assurance" ${etat.assurance ? 'checked' : ''}> Assurance (${(CONFIG.tauxAssurance * 100).toLocaleString('fr-FR')} % de la valeur)</label>
        <label class="champ ${etat.assurance ? '' : 'cache'}" data-valeur>Valeur déclarée (€) <input class="saisie" name="valeurDeclaree" type="number" inputmode="decimal" min="0" value="${r.valeurDeclaree || ''}"></label>

        <div class="carte-noire pile" style="--gap:6px" aria-live="polite">
          <div class="recap-prix"><span style="color:#D6CFC0">Prix à payer</span><span class="valeur" data-eur>—</span></div>
          <div class="recap-prix"><span style="color:#D6CFC0">en francs guinéens</span><span class="gras" data-gnf>—</span></div>
          <div class="tres-petit" style="color:#D6CFC0" data-detail></div>
        </div>

        <h3>Paiement</h3>
        <label class="case"><input type="checkbox" name="payeurArrivee" ${etat.payeurArrivee ? 'checked' : ''}> Le destinataire paie à l'arrivée</label>
        <div class="pile" style="--gap:8px" data-paiement>
          <div class="grille-3">${[['especes', 'Espèces'], ['carte', 'Carte'], ['virement', 'Virement']].map(([k, l]) => `<button type="button" class="choix choix-ocre" style="align-items:center" data-methode="${k}" aria-pressed="${etat.methode === k}"><span class="nom">${l}</span></button>`).join('')}</div>
          <label class="champ">Montant reçu (€) <input class="saisie saisie-forte" name="montant" type="number" inputmode="decimal" step="0.01" min="0"></label>
          <p class="petit" data-rendu></p>
        </div>

        <button class="btn btn-principal btn-grand btn-plein" type="submit">Enregistrer et imprimer l'étiquette</button>
      </form>`;

    const form = main.querySelector('[data-depot]');
    const $ = (s) => form.querySelector(s);
    let tarif = null;
    const calc = () => {
      const poids = parseFloat(form.poidsReel.value);
      etat.typeColis = form.typeColis.value;
      $('[data-valeur]').classList.toggle('cache', !form.assurance.checked);
      $('[data-paiement]').classList.toggle('cache', form.payeurArrivee.checked);
      form.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === etat.mode));
      form.querySelectorAll('[data-methode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.methode === etat.methode));
      if (!(poids > 0)) { $('[data-eur]').textContent = '—'; $('[data-gnf]').textContent = '—'; $('[data-detail]').textContent = 'Pesez le colis.'; tarif = null; return; }
      tarif = KolisTarif.calculerTarif(CONFIG.regles, { mode: etat.mode, poidsKg: poids, typeColis: etat.typeColis, valeurDeclaree: form.valeurDeclaree.value, assurance: form.assurance.checked });
      $('[data-eur]').textContent = eur(tarif.totalEur);
      $('[data-gnf]').textContent = gnf(tarif.totalGnf);
      $('[data-detail]').textContent = `${kg(tarif.poidsFacture)} × ${eur(tarif.prixKg)}${tarif.surcharge ? ` + ${eur(tarif.surcharge)} supplément` : ''}${tarif.assurance ? ` + ${eur(tarif.assurance)} assurance` : ''}`;
      if (r.poidsEstime) {
        const ecart = Math.round((poids - r.poidsEstime) * 10) / 10;
        $('[data-ecart]').innerHTML = `Annoncé : ${kg(r.poidsEstime)} · ${ecart > 0 ? `<b style="color:var(--rouge)">+${kg(ecart)}</b>` : ecart < 0 ? `${kg(ecart)}` : 'identique'}`;
      }
      if (!form.montant.dataset.touche) form.montant.value = tarif.totalEur;
      const recu = parseFloat(form.montant.value) || 0;
      $('[data-rendu]').innerHTML = etat.methode === 'especes' && recu > tarif.totalEur ? `Monnaie à rendre : <b>${eur(recu - tarif.totalEur)}</b>` : recu < tarif.totalEur && recu > 0 ? `<span style="color:var(--rouge)">Paiement partiel : reste ${eur(tarif.totalEur - recu)}</span>` : '';
    };
    form.addEventListener('input', (e) => { if (e.target.name === 'montant') e.target.dataset.touche = '1'; calc(); });
    form.addEventListener('change', calc);
    form.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { etat.mode = b.dataset.mode; calc(); }));
    form.querySelectorAll('[data-methode]').forEach(b => b.addEventListener('click', () => { etat.methode = b.dataset.methode; calc(); }));
    $('[data-retour]').addEventListener('click', vueDepot);
    calc();
    form.poidsReel.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!tarif) { toast('Pesez le colis.', 'erreur'); form.poidsReel.focus(); return; }
      const manque = ['expNom', 'expTel', 'destNom', 'destTel'].find(k => !form[k].value.trim());
      if (manque) { toast('Complétez les noms et téléphones.', 'erreur'); form[manque].focus(); return; }
      const recu = parseFloat(form.montant.value) || 0;
      const paiement = !form.payeurArrivee.checked && recu > 0
        ? { montant: Math.min(recu, tarif.totalEur), devise: 'EUR', methode: etat.methode, objet: 'transport' } : undefined;
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const res = await api.post('/agent/depot', {
          opId: form.dataset.opId || (form.dataset.opId = uid()),
          numeroSuivi: resa?.numeroSuivi,
          poidsReel: parseFloat(form.poidsReel.value), mode: etat.mode, typeColis: etat.typeColis,
          guichet: form.guichet.value, nbCartons: parseInt(form.nbCartons.value, 10) || 1,
          description: form.description.value, assurance: form.assurance.checked,
          valeurDeclaree: parseFloat(form.valeurDeclaree.value) || 0, payeurArrivee: form.payeurArrivee.checked,
          expediteur: { nom: form.expNom.value.trim(), telephone: normTel(form.expTel.value) },
          destinataire: { nom: form.destNom.value.trim(), telephone: normTel(form.destTel.value) },
          paiement,
        });
        depotTermine(res.colis);
      } catch (err) {
        toast(err.reseau ? 'Pas de réseau : le dépôt a besoin de la connexion pour créer le numéro. Réessayez.' : err.message, 'erreur');
        btn.disabled = false;
      }
    });
  }

  function depotTermine(c) {
    main.innerHTML = `
      <div class="pile">
        <div class="carte-vert pile centre" style="--gap:8px">
          <span class="badge" style="align-self:center;background:var(--ocre);color:var(--encre)">${ic('ok', 'ic-sm')} Enregistré</span>
          <div class="num-grand">${esc(c.numeroSuivi)}</div>
          <div>${esc(c.destinataire.nom)} · ${esc(c.guichetInfo?.nom || c.guichet)}</div>
          <div>${kg(c.poidsReel)} · ${eur(c.tarif.totalEur)} · ${c.solde.soldeGnf > 0 ? `reste ${gnf(c.solde.soldeGnf)}` : 'payé'}</div>
        </div>
        <div class="carte centre qr-apercu" data-qr><div class="chargement"></div></div>
        <button class="btn btn-noir btn-grand btn-plein" data-imprimer>${ic('imprimer')} Imprimer ${c.nbCartons > 1 ? `${c.nbCartons} étiquettes` : 'l\'étiquette'}</button>
        <p class="petit muet centre">Le client a reçu un SMS avec le numéro de suivi.</p>
        <button class="btn btn-principal btn-grand btn-plein" data-suivant>${ic('plus')} Colis suivant</button>
      </div>`;
    Etiquette.apercu(main.querySelector('[data-qr]'), c.numeroSuivi);
    main.querySelector('[data-imprimer]').addEventListener('click', () => Etiquette.imprimer(c, CONFIG));
    main.querySelector('[data-suivant]').addEventListener('click', vueDepot);
  }

  // ══════════════════════════════════════════════════════════
  //  REMISE AU DESTINATAIRE
  // ══════════════════════════════════════════════════════════
  async function vueRemise() {
    main.innerHTML = `
      <div class="pile">
        <form class="ligne" style="--gap:8px" data-cherche>
          <input class="saisie saisie-forte grandit" name="numero" placeholder="N° de suivi (scanner ou taper)" autocomplete="off" style="text-transform:uppercase">
          <button class="btn btn-noir btn-carre" aria-label="Chercher">${ic('loupe')}</button>
        </form>
        <div class="viseur" data-viseur style="aspect-ratio:16/9">
          <button class="btn btn-ocre" data-camera style="position:absolute">${ic('scan')} Scanner l'étiquette</button>
        </div>
        <div class="ligne entre"><h3>Colis prêts ici</h3><span class="petit muet">${(CTX?.colisPrets || []).length}</span></div>
        <input class="saisie" data-filtre placeholder="Filtrer par nom ou téléphone" aria-label="Filtrer">
        <div class="pile" style="--gap:8px" data-liste></div>
      </div>`;
    const liste = main.querySelector('[data-liste]');
    const dessiner = (f = '') => {
      const q = f.toLowerCase();
      const prets = (CTX?.colisPrets || []).filter(c => !q || c.destinataire.nom.toLowerCase().includes(q) || c.destinataire.telephone.includes(q) || c.numeroSuivi.toLowerCase().includes(q) || c.tiersAutorise?.nom?.toLowerCase().includes(q));
      liste.innerHTML = prets.length ? prets.slice(0, 40).map(c => `
        <button class="choix" data-num="${esc(c.numeroSuivi)}" style="width:100%">
          <span class="nom">${esc(c.destinataire.nom)}${c.emplacement ? ` · étagère ${esc(c.emplacement)}` : ''}</span>
          <span class="sous">${esc(c.numeroSuivi)} · depuis ${c.magasinage?.jours || 0} j${c.soldeGnf > 0 ? ` · reste ${gnf(c.soldeGnf)}` : ''}</span>
        </button>`).join('') : '<p class="vide petit">Aucun colis en attente.</p>';
      liste.querySelectorAll('[data-num]').forEach(b => b.addEventListener('click', () => ouvrirRemise(b.dataset.num)));
    };
    dessiner();
    main.querySelector('[data-filtre]').addEventListener('input', (e) => dessiner(e.target.value));
    main.querySelector('[data-cherche]').addEventListener('submit', (e) => { e.preventDefault(); const n = e.target.numero.value.trim(); if (n) ouvrirRemise(Scanner.extraireNumero(n)); });
    main.querySelector('[data-camera]').addEventListener('click', async () => {
      try { arreterCamera = await Scanner.demarrer(main.querySelector('[data-viseur]'), (n) => { Scanner.bip(true); ouvrirRemise(n); }); }
      catch (err) { toast(err.message || 'Caméra indisponible.', 'erreur'); }
    });
  }

  async function ouvrirRemise(numero) {
    if (arreterCamera) { try { await arreterCamera(); } catch {} arreterCamera = null; }
    let c = (CTX?.colisPrets || []).find(x => x.numeroSuivi === numero);
    let horsCache = false;
    if (navigator.onLine) {
      try {
        const r = await api.get(`/agent/colis/${numero}`);
        const f = r.colis;
        if (f.statut !== 'pret') { toast(`${numero} : ${f.statutLabel}`, 'erreur'); return; }
        c = { ...(c || {}), numeroSuivi: f.numeroSuivi, destinataire: f.destinataire, tiersAutorise: f.tiersAutorise, poids: f.poidsReel, nbCartons: f.nbCartons, emplacement: f.emplacement, soldeGnf: f.solde.soldeGnf, magasinage: f.solde.magasinage, detail: f.solde };
        horsCache = !c.empreinteCode;
      } catch (e) { if (!e.reseau) { toast(e.message, 'erreur'); return; } }
    }
    if (!c) { toast('Colis introuvable dans ce guichet (hors-ligne : liste du dernier chargement).', 'erreur'); return; }

    const opId = uid();
    const etat = { code: '', codeOk: null, retirePar: 'destinataire', methode: 'especes' };
    const solde = c.soldeGnf || 0;
    main.innerHTML = `
      <form class="pile" data-remise novalidate>
        <div class="ligne"><button type="button" class="btn btn-rond" data-retour aria-label="Retour">${ic('retour')}</button><h2 class="grandit">Remise du colis</h2></div>
        <div class="carte ligne" style="--gap:14px">
          <div class="pastille" style="width:60px;height:60px;border-radius:14px;background:var(--creme-2);display:flex;align-items:center;justify-content:center">${ic('colis', 'ic-lg')}</div>
          <div class="grandit">
            <div class="titre" style="font-size:18px">${esc(c.numeroSuivi)}</div>
            <div>${esc(c.destinataire.nom)}</div>
            <div class="petit muet">${kg(c.poids)} · ${c.nbCartons || 1} carton(s)${c.emplacement ? ` · étagère ${esc(c.emplacement)}` : ''}</div>
          </div>
        </div>

        <div class="carte pile">
          <div class="ligne"><span class="etape-num" style="width:26px;height:26px;border-radius:13px;background:var(--vert);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700">1</span><h3>Code de retrait</h3></div>
          <div class="code-4" data-code>${[0, 1, 2, 3].map(i => `<input inputmode="numeric" maxlength="1" aria-label="Chiffre ${i + 1}" autocomplete="off">`).join('')}</div>
          <p class="petit gras" data-verdict aria-live="polite"></p>
          <div style="height:1px;background:var(--creme-2)"></div>
          <h3>Qui retire ?</h3>
          <div class="grille-2">
            <button type="button" class="choix choix-noir" style="align-items:center" data-qui="destinataire" aria-pressed="true"><span class="nom">Destinataire</span></button>
            <button type="button" class="choix choix-noir" style="align-items:center" data-qui="tiers" aria-pressed="false"><span class="nom">Autre personne</span></button>
          </div>
          <div class="cache" data-tiers>
            ${c.tiersAutorise?.nom ? `<p class="bandeau bandeau-vert">Autorisé par le client : <b>&nbsp;${esc(c.tiersAutorise.nom)}</b>&nbsp;${esc(c.tiersAutorise.telephone || '')}</p>` : ''}
            <label class="champ" style="margin-top:8px">Nom de la personne présente <input class="saisie" name="nomRetrait" value="${esc(c.tiersAutorise?.nom || '')}"></label>
          </div>
          <label class="case"><input type="checkbox" name="piece"> Pièce d'identité vérifiée</label>
        </div>

        ${solde > 0 ? `
        <div class="carte pile">
          <div class="ligne"><span style="width:26px;height:26px;border-radius:13px;background:var(--vert);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700">2</span><h3 class="grandit">Encaisser</h3><span class="titre" style="font-size:20px">${gnf(solde)}</span></div>
          ${c.magasinage?.fraisGnf ? `<p class="tres-petit muet">Dont frais de garde : ${gnf(c.magasinage.fraisGnf)} (${c.magasinage.joursFactures} j)</p>` : ''}
          <div class="grille-3">${[['especes', 'Espèces'], ['orange_money', 'Orange Money'], ['mtn_momo', 'MTN MoMo']].map(([k, l]) => `<button type="button" class="choix choix-ocre" style="align-items:center;text-align:center" data-methode="${k}" aria-pressed="${k === 'especes'}"><span class="nom" style="font-size:14px">${l}</span></button>`).join('')}</div>
          <label class="champ" data-champ-recu>Montant reçu (GNF) <input class="saisie saisie-forte" name="recu" type="number" inputmode="numeric" min="0" step="500" value="${solde}"></label>
          <label class="champ cache" data-champ-ref>Référence de la transaction <input class="saisie" name="reference" autocomplete="off"></label>
          <div class="bandeau bandeau-ocre cache" data-monnaie></div>
        </div>` : '<p class="bandeau bandeau-vert">' + ic('ok', 'ic-sm') + ' Tout est payé.</p>'}

        <div class="carte pile" style="--gap:10px">
          <div class="ligne entre"><h3>Signature</h3><button type="button" class="btn btn-petit" data-effacer>Effacer</button></div>
          <canvas class="signature" data-signature aria-label="Zone de signature"></canvas>
        </div>

        <button class="btn btn-principal btn-grand btn-plein" type="submit">${ic('ok')} Valider la remise</button>
        <p class="tres-petit muet centre">Un reçu est envoyé par SMS. Fonctionne aussi sans réseau.</p>
      </form>`;

    const form = main.querySelector('[data-remise]');
    const $ = (s) => form.querySelector(s);
    $('[data-retour]').addEventListener('click', () => router());

    // Code à 4 cases, avance automatique
    const cases = [...form.querySelectorAll('[data-code] input')];
    cases[0].focus();
    const verifier = async () => {
      etat.code = cases.map(i => i.value).join('');
      const zone = $('[data-code]'); const verdict = $('[data-verdict]');
      zone.classList.remove('ok', 'faux'); verdict.textContent = ''; etat.codeOk = null;
      if (etat.code.length < 4) return;
      if (c.empreinteCode) {
        etat.codeOk = (await K.sha256(`${c.numeroSuivi}:${etat.code}`)) === c.empreinteCode;
        zone.classList.add(etat.codeOk ? 'ok' : 'faux');
        verdict.innerHTML = etat.codeOk ? `<span style="color:var(--vert)">${ic('ok', 'ic-sm')} Code correct</span>` : '<span style="color:var(--rouge)">Code incorrect</span>';
        Scanner.bip(etat.codeOk);
      } else verdict.textContent = horsCache ? 'Le code sera vérifié à la validation.' : '';
    };
    cases.forEach((inp, i) => {
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(-1); if (inp.value && cases[i + 1]) cases[i + 1].focus(); verifier(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && cases[i - 1]) cases[i - 1].focus(); });
      inp.addEventListener('paste', (e) => { const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4); if (t.length === 4) { e.preventDefault(); t.split('').forEach((d, k) => { cases[k].value = d; }); verifier(); } });
    });

    form.querySelectorAll('[data-qui]').forEach(b => b.addEventListener('click', () => {
      etat.retirePar = b.dataset.qui;
      form.querySelectorAll('[data-qui]').forEach(x => x.setAttribute('aria-pressed', x === b));
      $('[data-tiers]').classList.toggle('cache', etat.retirePar !== 'tiers');
    }));

    const majMonnaie = () => {
      if (!solde) return;
      const recu = parseFloat(form.recu.value) || 0;
      const m = $('[data-monnaie]');
      $('[data-champ-ref]').classList.toggle('cache', etat.methode === 'especes');
      if (etat.methode === 'especes' && recu > solde) { m.classList.remove('cache'); m.innerHTML = `Monnaie à rendre : <b>&nbsp;${gnf(recu - solde)}</b>`; }
      else if (recu < solde) { m.classList.remove('cache'); m.innerHTML = `<span style="color:var(--rouge)">Il manque ${gnf(solde - recu)}</span>`; }
      else m.classList.add('cache');
    };
    form.querySelectorAll('[data-methode]').forEach(b => b.addEventListener('click', () => {
      etat.methode = b.dataset.methode;
      form.querySelectorAll('[data-methode]').forEach(x => x.setAttribute('aria-pressed', x === b));
      majMonnaie();
    }));
    form.recu?.addEventListener('input', majMonnaie);

    const sig = Signature($('[data-signature]'));
    $('[data-effacer]').addEventListener('click', sig.effacer);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (etat.code.length !== 4) { toast('Tapez le code de retrait.', 'erreur'); cases[0].focus(); return; }
      if (etat.codeOk === false) { toast('Code incorrect. Demandez le SMS au destinataire.', 'erreur'); return; }
      if (!form.piece.checked) { toast('Vérifiez la pièce d\'identité.', 'erreur'); return; }
      if (etat.retirePar === 'tiers' && !form.nomRetrait.value.trim()) { toast('Nom de la personne présente requis.', 'erreur'); return; }
      if (solde > 0 && (parseFloat(form.recu.value) || 0) < solde) { toast(`Il faut encaisser ${gnf(solde)}.`, 'erreur'); return; }
      if (sig.vide()) { toast('Faites signer la personne.', 'erreur'); return; }
      const payload = {
        opId, numero: c.numeroSuivi, code: etat.code, pieceVerifiee: true,
        retirePar: etat.retirePar, nomRetrait: etat.retirePar === 'tiers' ? form.nomRetrait.value.trim() : undefined,
        paiement: solde > 0 ? { montant: solde, devise: 'GNF', methode: etat.methode, objet: 'global', reference: form.reference?.value || undefined } : undefined,
        signature: sig.image(),
      };
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await api.post('/agent/remise', payload);
        remiseTerminee(c, false);
      } catch (err) {
        if (err.reseau && etat.codeOk) {
          // Hors-ligne : le code a été vérifié sur le téléphone → on garde la remise pour plus tard
          file.ajouter({ opId, type: 'remise', payload, le: Date.now() });
          journal.ajouter({ opId, numero: c.numeroSuivi, action: 'remise', etat: 'attente', message: 'Remise en attente d\'envoi', le: Date.now() });
          remiseTerminee(c, true);
        } else if (err.reseau) {
          toast('Pas de réseau et code impossible à vérifier ici. Réessayez dans un instant.', 'erreur');
          btn.disabled = false;
        } else { toast(err.message, 'erreur'); btn.disabled = false; }
      }
    });
  }

  function remiseTerminee(c, horsLigne) {
    if (CTX?.colisPrets) { CTX.colisPrets = CTX.colisPrets.filter(x => x.numeroSuivi !== c.numeroSuivi); stock.ecrire('ctx', CTX); }
    main.innerHTML = `
      <div class="pile centre">
        <div class="carte-vert pile" style="--gap:8px">
          <div style="margin:0 auto;width:64px;height:64px;border-radius:32px;background:var(--ocre);color:var(--encre);display:flex;align-items:center;justify-content:center">${ic('ok', 'ic-lg')}</div>
          <h1>Colis remis</h1>
          <p>${esc(c.numeroSuivi)} · ${esc(c.destinataire.nom)}</p>
        </div>
        ${horsLigne ? `<p class="bandeau bandeau-ocre">${ic('horsligne', 'ic-sm')} Pas de réseau : la remise est gardée sur ce téléphone et sera envoyée automatiquement.</p>` : ''}
        <a class="btn btn-principal btn-grand btn-plein" href="#/remise" data-suivant>Colis suivant</a>
      </div>`;
    main.querySelector('[data-suivant]').addEventListener('click', (e) => { e.preventDefault(); router(); });
    if (!horsLigne) rafraichirContexte().catch(() => {});
  }

  // Zone de signature au doigt
  function Signature(canvas) {
    const ctx = canvas.getContext('2d');
    let trace = false, vide = true;
    const ajuster = () => {
      const r = canvas.getBoundingClientRect(); const d = window.devicePixelRatio || 1;
      canvas.width = r.width * d; canvas.height = r.height * d; ctx.scale(d, d);
      ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1B1A16';
    };
    ajuster();
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => { trace = true; vide = false; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
    canvas.addEventListener('pointermove', (e) => { if (!trace) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
    canvas.addEventListener('pointerup', () => { trace = false; });
    return {
      effacer: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); vide = true; },
      vide: () => vide,
      // JPEG léger : la signature voyage même sur une connexion faible
      image: () => { const t = document.createElement('canvas'); t.width = 360; t.height = 140; const c2 = t.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, 360, 140); c2.drawImage(canvas, 0, 0, 360, 140); return t.toDataURL('image/jpeg', 0.6); },
    };
  }

  // ══════════════════════════════════════════════════════════
  //  CAISSE
  // ══════════════════════════════════════════════════════════
  async function vueCaisse() {
    const r = await api.get('/caisse/moi');
    const methodes = Object.fromEntries(CONFIG.methodesPaiement.map(m => [m.key, m.label]));
    const devises = Object.keys(r.totaux);
    main.innerHTML = `
      <div class="pile">
        <div class="carte-vert pile" style="--gap:6px">
          <div class="petit" style="opacity:.9">Ma caisse ${r.depuis ? `depuis le ${esc(date(r.depuis))}` : ''}</div>
          ${devises.length ? devises.map(d => `<div class="titre" style="font-size:28px;font-weight:800">${montant(Object.values(r.totaux[d]).reduce((a, b) => a + b, 0), d)}</div>`).join('') : '<div class="titre" style="font-size:24px">Aucun encaissement</div>'}
        </div>
        ${devises.map(d => `
          <div class="carte">${Object.entries(r.totaux[d]).map(([m, v]) => `<div class="ligne-info"><span>${esc(methodes[m] || m)} (${d})</span><span class="gras chiffres">${montant(v, d)}</span></div>`).join('')}</div>`).join('')}
        ${r.mouvements.length ? `
        <form class="carte pile" data-cloture>
          <h3>Clôturer la journée</h3>
          <p class="petit muet">Comptez les espèces dans la caisse. L'écart éventuel est enregistré.</p>
          ${devises.filter(d => r.totaux[d].especes).map(d => `<label class="champ">Espèces comptées (${d}) <input class="saisie saisie-forte" name="${d}" type="number" inputmode="decimal" min="0" required></label>`).join('')}
          <label class="champ">Commentaire <input class="saisie" name="commentaire"></label>
          <button class="btn btn-noir btn-grand btn-plein">Clôturer la caisse</button>
        </form>
        <h3>Détail</h3>
        <div class="carte">${r.mouvements.map(m => `<div class="ligne-info"><span>${esc(heure(m.le))} · ${esc(m.numeroSuivi || '')} · ${esc(methodes[m.methode] || m.methode)}</span><span class="gras chiffres">${montant(m.montant, m.devise)}</span></div>`).join('')}</div>` : ''}
      </div>`;
    main.querySelector('[data-cloture]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const comptees = {};
      ['EUR', 'GNF'].forEach(d => { if (f.get(d) !== null && f.get(d) !== '') comptees[d] = parseFloat(f.get(d)); });
      if (!confirm('Clôturer la caisse maintenant ?')) return;
      try {
        const res = await api.post('/caisse/cloturer', { especesComptees: comptees, commentaire: f.get('commentaire') });
        const ecarts = Object.entries(res.cloture.ecart || {}).filter(([, v]) => v !== 0);
        toast(ecarts.length ? `Caisse clôturée. Écart : ${ecarts.map(([d, v]) => montant(v, d)).join(', ')}` : 'Caisse clôturée, aucun écart.', ecarts.length ? 'erreur' : 'ok');
        vueCaisse();
      } catch (err) { toast(err.message, 'erreur'); }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  FICHE COLIS (recherche, douane, paiement partiel)
  // ══════════════════════════════════════════════════════════
  async function vueFiche() {
    main.innerHTML = `
      <div class="pile">
        <form class="ligne" style="--gap:8px" data-cherche>
          <input class="saisie saisie-forte grandit" name="numero" placeholder="N° de suivi" autocomplete="off" style="text-transform:uppercase" autofocus>
          <button class="btn btn-noir btn-carre" aria-label="Chercher">${ic('loupe')}</button>
        </form>
        <div data-fiche></div>
      </div>`;
    main.querySelector('[data-cherche]').addEventListener('submit', async (e) => {
      e.preventDefault();
      afficherFiche(Scanner.extraireNumero(e.target.numero.value));
    });
  }

  async function afficherFiche(numero) {
    const zone = main.querySelector('[data-fiche]');
    zone.innerHTML = '<div class="chargement"></div>';
    try {
      const { colis: c } = await api.get(`/agent/colis/${numero}`);
      const estGuichet = CTX?.estGuichet || session.utilisateur().role === 'admin';
      zone.innerHTML = `
        <div class="pile">
          <div class="carte pile" style="--gap:6px">
            <div class="ligne entre"><span class="titre" style="font-size:20px">${esc(c.numeroSuivi)}</span><span class="badge b-${c.statut}">${esc(c.statutLabel)}</span></div>
            <div class="ligne-info"><span>Expéditeur</span><span>${esc(c.expediteur.nom)} · ${esc(c.expediteur.telephone)}</span></div>
            <div class="ligne-info"><span>Destinataire</span><span>${esc(c.destinataire.nom)} · ${esc(c.destinataire.telephone)}</span></div>
            ${c.tiersAutorise?.nom ? `<div class="ligne-info"><span>Autorisé</span><span>${esc(c.tiersAutorise.nom)}</span></div>` : ''}
            <div class="ligne-info"><span>Guichet</span><span>${esc(c.guichetInfo?.nom || c.guichet)}</span></div>
            <div class="ligne-info"><span>Poids</span><span>${kg(c.poidsReel || c.poidsEstime)} · ${c.nbCartons} carton(s)</span></div>
            <div class="ligne-info"><span>Lot</span><span>${esc(c.lotCode || '—')}</span></div>
            <div class="ligne-info"><span>Transport</span><span>${eur(c.tarif?.totalEur)} (${gnf(c.tarif?.totalGnf)})</span></div>
            <div class="ligne-info"><span>Douane</span><span>${gnf(c.fraisDouaneGnf)}</span></div>
            <div class="ligne-info"><span>Reste à payer</span><span class="gras">${gnf(c.solde.soldeGnf)}</span></div>
          </div>
          ${estGuichet && !['remis', 'annule'].includes(c.statut) ? `
          <form class="carte pile" data-douane>
            <h3>Droits de douane</h3>
            <div class="ligne" style="--gap:8px"><input class="saisie grandit" name="douane" type="number" inputmode="numeric" min="0" step="500" value="${c.fraisDouaneGnf || ''}" placeholder="Montant en GNF"><button class="btn btn-noir">Enregistrer</button></div>
          </form>` : ''}
          <button class="btn btn-plein" data-reimprimer>${ic('imprimer', 'ic-sm')} Réimprimer l'étiquette</button>
          <div class="carte"><h3 style="margin-bottom:12px">Historique</h3><div class="frise">${[...c.historique].reverse().map(h => `
            <div class="etape"><div class="rail"><div class="point"></div><div class="trait"></div></div><div class="texte"><div class="gras">${esc(h.label)}</div><div class="petit muet">${esc(date(h.le))}${h.detail ? ` · ${esc(h.detail)}` : ''}</div></div></div>`).join('')}</div></div>
        </div>`;
      zone.querySelector('[data-douane]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api.patch(`/agent/colis/${c.numeroSuivi}/douane`, { fraisDouaneGnf: parseFloat(e.target.douane.value) || 0 }); toast('Douane enregistrée.', 'ok'); afficherFiche(c.numeroSuivi); }
        catch (err) { toast(err.message, 'erreur'); }
      });
      zone.querySelector('[data-reimprimer]').addEventListener('click', () => Etiquette.imprimer(c, CONFIG));
    } catch (e) { zone.innerHTML = `<p class="bandeau bandeau-rouge">${esc(e.message)}</p>`; }
  }

  // ══════════════════════════════════════════════════════════
  //  ÉTIQUETTES (QR code, 10 × 15 cm, une par carton)
  // ══════════════════════════════════════════════════════════
  const Etiquette = K.etiquette;

  // ══════════════════════════════════════════════════════════
  //  DÉMARRAGE
  // ══════════════════════════════════════════════════════════
  async function demarrer() {
    majPastille();
    try { CONFIG = await K.config(); } catch (e) {
      main.innerHTML = `<p class="bandeau bandeau-rouge">Impossible de joindre le serveur et aucune donnée en mémoire.</p><button class="btn" onclick="location.reload()">Réessayer</button>`;
      return;
    }
    if (session.connecte()) await rafraichirContexte().catch(() => {});
    router();
    synchroniser();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  demarrer();
})();
