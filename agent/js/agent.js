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
  let ecouteJournal = null;

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
          journal.maj(res.opId, { etat: res.ok ? (res.info ? 'info' : 'ok') : 'erreur', message: res.ok ? libelleOk(res) : res.erreur, destinataire: res.destinataire, horsLot: res.horsLot, avant: res.avant, actionFaite: res.actionFaite || (res.ok && !res.dejaFait && !res.info ? res.action : undefined), aEnvoyer: res.aEnvoyer });
        }
        file.ecrire(file.lire().filter(o => !faits.has(o.opId)));
      }
      // 2. Remises (guichet) et livraisons (livreur) faites hors-ligne
      const ROUTE_OP = { remise: '/agent/remise', livre: '/livreur/livre' };
      for (const op of file.lire().filter(o => ROUTE_OP[o.type])) {
        try {
          await api.post(ROUTE_OP[op.type], op.payload);
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
    if (res.action === 'auto') return res.message || 'Fait';
    if (res.dejaFait) return 'Déjà enregistré';
    return ({ charger: `Chargé · lot ${res.lotCode || ''}`, arrivee: 'Arrivé', acheminer: `Envoyé vers ${res.versAgence || 'l\'agence'}`, guichet: 'Prêt · code envoyé' })[res.action] || 'OK';
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
  const estLivreur = () => session.utilisateur()?.role === 'livreur';
  async function rafraichirContexte() {
    try {
      if (estLivreur()) {
        // Livreur : ses courses (et celles de son agence), gardées pour le hors-ligne
        const r = await api.get('/livreur/courses');
        const livresLocal = new Set(file.lire().filter(o => o.type === 'livre').map(o => o.payload.numero));
        CTX = { lieu: r.lieu, pays: r.lieu?.pays || null, courses: r.courses.filter(c => !(c.type === 'livraison' && livresLocal.has(c.numeroSuivi))), majLe: r.majLe };
        stock.ecrire('ctx', CTX);
        return CTX;
      }
      CTX = await api.get('/agent/contexte');
      // Retire du cache les colis remis hors-ligne pas encore synchronisés
      const remisLocal = new Set(file.lire().filter(o => o.type === 'remise').map(o => o.payload.numero));
      CTX.colisPrets = CTX.colisPrets.filter(c => !remisLocal.has(c.numeroSuivi));
      stock.ecrire('ctx', CTX);
    } catch (e) { if (!e.reseau) throw e; }
    return CTX;
  }
  setInterval(() => { if (navigator.onLine) rafraichirContexte().catch(() => {}); }, 120000);
  // Écrans « liste » redessinés seuls toutes les 60 s (courses du livreur, colis prêts au guichet)
  // Écrans « liste » redessinés seuls : en direct quand un colis de l'agence change, au retour
  // sur l'app et toutes les 30 s (jamais pendant une saisie, un scan ou un formulaire rempli)
  async function rafraichirEcran() {
    if (document.hidden || !navigator.onLine || document.querySelector('.modale-fond') || arreterCamera) return;
    await rafraichirContexte().catch(() => {});
    majPastille();
    main.classList.remove('entree'); // rafraîchissement silencieux : pas d'animation
    const onglet = location.hash.replace(/^#\/?/, '').split('/')[0];
    const actif = document.activeElement;
    if (actif && main.contains(actif) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(actif.tagName)) return;
    if (onglet === 'caisse' && main.querySelector('[data-caisse]') && ![...main.querySelectorAll('input')].some(i => i.value)) { const y = window.scrollY; await vueCaisse(); window.scrollTo(0, y); }
    if ((onglet === 'jour' || onglet === '') && !estLivreur() && main.querySelector('.guide') && !main.querySelector('.guide[open]')) { const y = window.scrollY; await vueAujourdhui(); window.scrollTo(0, y); }
    if (onglet === 'courses' && main.querySelector('[data-seg]')) { const y = window.scrollY; await vueCourses(); window.scrollTo(0, y); }
    if (onglet === 'remise' && main.querySelector('[data-liste]')) { main.querySelector('[data-filtre]')?.dispatchEvent(new Event('input')); }
  }
  K.tempsReel(rafraichirEcran);

  // ══════════════════════════════════════════════════════════
  //  NAVIGATION
  // ══════════════════════════════════════════════════════════
  // Chaque agence TMS fait tout : dépôt, scans, remise, caisse
  const ONGLETS = {
    jour:    { lib: 'Accueil', ic: 'grille', vue: vueAujourdhui },
    depot:   { lib: 'Dépôt',     ic: 'balance', vue: vueDepot },
    scanner: { lib: 'Scanner',   ic: 'scan',    vue: () => vueScan(stock.lire('action_scan') || 'auto') },
    remise:  { lib: 'Remise',    ic: 'ok',      vue: vueRemise },
    caisse:  { lib: 'Caisse',    ic: 'billet',  vue: vueCaisse },
    courses: { lib: 'Courses',   ic: 'moto',    vue: vueCourses },
    fiche:   { lib: 'Recherche', ic: 'loupe',   vue: vueFiche, cache: true },
  };
  // Anciens liens (#/chargement…) → onglet Scanner sur la bonne action
  const ANCIENS = { chargement: 'charger', arrivee: 'arrivee', guichet: 'guichet' };
  const ongletsVisibles = () => estLivreur() ? ['courses', 'caisse'] : ['jour', 'depot', 'scanner', 'remise', 'caisse'];

  // Pays et devise de l'agence de l'agent (admin sans agence : France / €)
  const paysAgent = () => CTX?.pays || null;
  const deviseAgent = () => CONFIG?.pays?.[paysAgent()]?.devise || 'EUR';
  // Moyens de paiement au comptoir, dans les deux sens (France → Guinée et Guinée → France) :
  // espèces, carte par QR code (Stripe, si activé), Orange Money ; MTN MoMo en Guinée ;
  // terminal de carte et virement en France.
  const moyensEnLigne = () => Object.values(CONFIG?.moyensPaiement || {}).flat();
  const stripeActif = () => moyensEnLigne().some(m => m.key === 'carte');
  const compteMobile = (k) => moyensEnLigne().find(m => m.key === k && m.numero) || null;
  const MOBILES = ['orange_money', 'mtn_momo'];
  const methodesDe = (devise, { qr = true } = {}) => [
    ['especes', 'Espèces'],
    ...(qr && stripeActif() ? [['stripe', 'Carte (QR)']] : []),
    ['orange_money', 'Orange Money'],
    ...(devise === 'GNF' ? [['mtn_momo', 'MTN MoMo']] : [['carte', 'Carte (terminal)'], ['virement', 'Virement']]),
  ];
  const nomMethode = (k) => (methodesDe('GNF').concat(methodesDe('EUR')).find(([x]) => x === k) || [k, k])[1];
  // Rappel du compte marchand quand le client paie par mobile money
  const aideMobile = (k, gnfDu) => {
    const c = compteMobile(k);
    return `${ic('billet', 'ic-sm')}<span>Le client envoie <b>${gnf(gnfDu)}</b> par ${esc(nomMethode(k))}${c ? ` au <b class="chiffres">${esc(c.numero)}</b>${c.titulaire ? ` (${esc(c.titulaire)})` : ''}` : ' sur le compte marchand de l\'agence'}, puis vous montre le SMS : notez la référence.</span>`;
  };

  // Paiement par carte au comptoir : QR code Stripe que le client scanne avec son téléphone.
  // L'écran se met à jour tout seul quand le paiement arrive.
  async function panneauCarte(zone, numero, { surPaye, tel } = {}) {
    zone.innerHTML = '<div class="chargement"></div>';
    let s2;
    try { s2 = await api.post('/paiements/creer-session', { numero, objet: 'solde' }); }
    catch (err) { zone.innerHTML = `<p class="bandeau bandeau-rouge">${esc(err.message)}</p>`; return; }
    let svg = '';
    try { svg = await Etiquette.qr(s2.url); } catch {}
    const wa = String(tel || '').replace(/\D/g, '');
    zone.innerHTML = `
      <div class="carte pile centre carte-qr-paiement" style="--gap:10px">
        <div class="gras">${ic('carte', 'ic-sm')} Paiement par carte</div>
        <p class="petit muet">Le client scanne ce QR code avec l'appareil photo de son téléphone et paie par carte (paiement sécurisé).</p>
        <div class="qr-apercu qr-paiement">${svg || '<p class="petit">QR indisponible : envoyez le lien.</p>'}</div>
        <div class="grille-2">
          <a class="btn btn-petit" href="${esc(s2.url)}" target="_blank" rel="noopener">${ic('carte', 'ic-sm')} Payer sur cet appareil</a>
          <a class="btn btn-petit" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(`${CONFIG.appCourt || 'TMS'} : lien de paiement de votre colis ${numero} : ${s2.url}`)}" target="_blank" rel="noopener">${ic('bulle', 'ic-sm')} Lien par WhatsApp</a>
        </div>
        <p class="petit gras" data-etat-carte aria-live="polite">${ic('horloge', 'ic-sm')} En attente du paiement…</p>
      </div>`;
    const debut = Date.now();
    const verifier = async () => {
      if (!zone.isConnected) return;
      try {
        const r = await api.get(`/paiements/a-payer/${encodeURIComponent(numero)}`);
        if (!(r.solde.gnf > 0)) {
          zone.querySelector('[data-etat-carte]').innerHTML = `<span style="color:var(--vert)">${ic('ok', 'ic-sm')} Paiement par carte reçu</span>`;
          try { Scanner.bip(true); } catch {}
          surPaye?.();
          return;
        }
      } catch {}
      if (Date.now() - debut < 30 * 60000) setTimeout(verifier, 4000);
    };
    setTimeout(verifier, 4000);
  }
  const agenceDe = (code) => CONFIG?.agences?.find(a => a.code === code) || null;

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
    if (!['agent', 'admin', 'livreur'].includes(u.role)) {
      main.innerHTML = `<div class="pile"><h1>Accès réservé</h1><p class="muet">Ce compte n'est pas un compte agent. Demandez à l'administrateur de vous ajouter à l'équipe.</p><button class="btn" data-sortir>Se déconnecter</button></div>`;
      main.querySelector('[data-sortir]').onclick = () => { session.fermer(); router(); };
      return;
    }
    const lieu = CTX?.lieu;
    document.querySelector('[data-qui]').textContent = `${u.prenom} ${u.nom[0]}. · ${u.role === 'livreur' ? 'Livreur · ' : ''}${lieu?.nom || (u.role === 'admin' ? 'Administrateur' : 'Lieu non défini')}`;
    document.querySelector('[data-recherche]').classList.toggle('cache', u.role === 'livreur');
    let onglet = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (ANCIENS[onglet]) { stock.ecrire('action_scan', ANCIENS[onglet]); onglet = 'scanner'; }
    const visibles = ongletsVisibles();
    if (!ONGLETS[onglet] || (!visibles.includes(onglet) && !ONGLETS[onglet].cache)) onglet = visibles[0];
    document.querySelector('[data-titre]').textContent = ONGLETS[onglet].lib;
    dessinerNav(onglet);
    main.classList.add('entree');
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

  // Bouton « Ouvrir la caméra » d'un viseur : ouvrir / fermer, lampe torche, erreurs claires
  function brancherCamera(viseur, surCode) {
    const btn = viseur.querySelector('[data-camera]');
    // Solution de secours qui marche sur tous les téléphones : photographier l'étiquette
    // avec l'appareil photo, puis lire le QR code de la photo.
    const photo = document.createElement('label');
    photo.className = 'btn btn-petit btn-photo-etiquette';
    photo.innerHTML = `${ic('scan', 'ic-sm')} <span>Photo de l'étiquette</span><input type="file" accept="image/*" capture="environment" hidden>`;
    viseur.appendChild(photo);
    photo.querySelector('input').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const lib = photo.querySelector('span'); lib.textContent = 'Lecture du QR code…';
      try { surCode(await Scanner.lirePhoto(f)); }
      catch (err) { Scanner.bip(false); toast(err.message, 'erreur'); }
      finally { lib.textContent = 'Photo de l\'étiquette'; }
    });
    const remettre = () => {
      viseur.querySelector('.actions-viseur')?.remove();
      btn.classList.remove('cache');
    };
    // Aide pas à pas quand la caméra est bloquée : comment autoriser, puis réessayer
    const aideAutorisation = (message) => {
      const { el, fermer } = modale(`
        <div class="pile" style="--gap:14px">
          <div class="ligne entre"><h2>Autoriser la caméra</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
          ${message ? `<p class="bandeau bandeau-ocre petit">${esc(message.split('. ')[0].replace(/\.$/, ''))}.</p>` : ''}
          <ol class="etapes-autorisation">${Scanner.etapesAutorisation().map(e => `<li>${esc(e)}</li>`).join('')}</ol>
          <button type="button" class="btn btn-principal btn-grand" data-reessayer>${ic('scan', 'ic-sm')} Réessayer la caméra</button>
          <button type="button" class="btn btn-plein" data-photo-aide>${ic('scan', 'ic-sm')} Photographier l'étiquette à la place</button>
        </div>`);
      el.querySelector('[data-reessayer]').addEventListener('click', () => { fermer(); btn.click(); });
      el.querySelector('[data-photo-aide]').addEventListener('click', () => { fermer(); photo.querySelector('input').click(); });
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      // Bloquée d'avance pour ce site : on explique tout de suite comment débloquer
      const etat = await Scanner.etatPermission();
      if (etat === 'denied') { btn.disabled = false; aideAutorisation('La caméra est bloquée pour ce site.'); return; }
      // Première fois : Chrome / Safari va afficher sa fenêtre d'autorisation
      let indice = null;
      if (etat !== 'granted') {
        indice = document.createElement('div');
        indice.className = 'indice-autorisation';
        indice.innerHTML = `${ic('alerte', 'ic-sm')}<span>Touchez <b>« Autoriser »</b> dans la fenêtre ${Scanner.IOS ? 'de Safari' : 'de Chrome'} pour utiliser la caméra.</span>`;
        viseur.appendChild(indice);
      }
      try {
        arreterCamera = await Scanner.demarrer(viseur, surCode);
        indice?.remove();
        btn.classList.add('cache');
        const barre = document.createElement('div');
        barre.className = 'actions-viseur';
        barre.innerHTML = `${arreterCamera.lampe ? `<button type="button" class="btn btn-petit" data-lampe aria-pressed="false">${ic('lampe', 'ic-sm')} Lampe</button>` : ''}<button type="button" class="btn btn-ocre btn-petit" data-fermer-camera>${ic('fermer', 'ic-sm')} Fermer</button>`;
        viseur.appendChild(barre);
        const stop = arreterCamera;
        barre.querySelector('[data-fermer-camera]').addEventListener('click', async () => { await stop(); if (arreterCamera === stop) arreterCamera = null; remettre(); });
        barre.querySelector('[data-lampe]')?.addEventListener('click', (e) => {
          const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
          e.currentTarget.setAttribute('aria-pressed', on); stop.lampe(on);
        });
        // Caméra coupée de l'extérieur (appli en arrière-plan) : on remet le bouton
        const obs = new MutationObserver(() => { if (!viseur.classList.contains('actif')) { obs.disconnect(); remettre(); } });
        obs.observe(viseur, { attributes: true, attributeFilter: ['class'] });
      } catch (err) {
        indice?.remove();
        photo.classList.add('btn-ocre');
        if (err.code === 'sans_camera') toast(err.message, 'erreur', { duree: 9000 });
        else aideAutorisation(err.message);
      } finally { btn.disabled = false; }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  AUJOURD'HUI : le travail de l'agence, le même pour tous ses agents
  // ══════════════════════════════════════════════════════════
  const ETAPES_GUIDE = [
    ['Dépôt', 'Le client apporte son colis : pesez-le, encaissez, collez l\'étiquette (onglet Dépôt).'],
    ['Mise en lot', 'Avant le départ, scannez chaque colis : il entre tout seul dans le lot avion ou bateau qui part.'],
    ['Départ', 'Le responsable marque le lot « parti » : les clients sont prévenus.'],
    ['Arrivée', 'À la plateforme d\'arrivée, scannez chaque colis qui sort du lot.'],
    ['En rayon', 'Dans l\'agence de retrait, scannez le colis en le posant sur l\'étagère : le destinataire reçoit son code. S\'il doit aller dans une autre agence, le scan l\'y envoie.'],
    ['Remise', 'Le destinataire donne son code (onglet Remise) : pièce d\'identité, paiement du reste, signature.'],
  ];
  async function vueAujourdhui() {
    let r = stock.lire('aujourdhui');
    try { r = await api.get('/agent/aujourdhui'); stock.ecrire('aujourdhui', { ...r, le: Date.now() }); }
    catch (e) { if (!e.reseau || !r) throw e; }
    const u = session.utilisateur();
    const taches = r.taches || [];
    const aFaire = taches.filter(t => !t.info);
    main.innerHTML = `
      <div class="pile">
        <div>
          <h1 style="font-size:24px">Bonjour ${esc(u.prenom)}</h1>
          <p class="muet petit">${esc(r.lieu?.nom || '')} · ${aFaire.length ? `${aFaire.length} chose(s) à faire` : 'tout est à jour'}${r.faitsAujourdhui ? ` · ${r.faitsAujourdhui} encaissement(s) aujourd'hui dans l'agence` : ''}</p>
          ${r.le && !navigator.onLine ? `<p class="bandeau bandeau-ocre petit">${ic('horsligne', 'ic-sm')} Hors ligne : situation du ${esc(date(r.le))}.</p>` : ''}
        </div>
        <div data-notifs></div>
        <div class="pile grille-cartes" style="--gap:12px">
          ${taches.length ? taches.map(t => `
            <div class="carte tache t-${esc(t.onglet || 'info')} ${t.urgent ? 'urgent' : ''} ${t.info ? 'info' : ''}">
              <div class="ligne" style="--gap:12px;align-items:flex-start">
                <span class="nb-tache">${esc(t.nb)}</span>
                <div class="grandit"><div class="gras">${esc(t.titre)}</div><div class="petit muet">${esc(t.aide || '')}</div></div>
              </div>
              ${t.progression !== undefined ? `<div class="barre"><span style="width:${Math.round(t.progression * 100)}%"></span></div>` : ''}
              ${t.onglet ? `<a class="btn btn-principal btn-plein" href="#/${t.onglet}" data-tache="${esc(t.cle)}">${t.onglet === 'scanner' ? `${ic('scan', 'ic-sm')} Scanner` : t.onglet === 'remise' ? `${ic('ok', 'ic-sm')} Remettre` : t.onglet === 'caisse' ? `${ic('billet', 'ic-sm')} Ma caisse` : `${ic('balance', 'ic-sm')} Dépôt`}</a>` : ''}
            </div>`).join('') : `<div class="carte centre pile" style="--gap:6px"><div style="margin:0 auto">${ic('ok', 'ic-lg')}</div><div class="gras">Rien en attente</div><div class="petit muet">Les nouveaux dépôts et les lots en route apparaîtront ici.</div></div>`}
        </div>
        ${r.lotsPrepa?.length ? `<p class="petit muet">Lots en préparation : ${r.lotsPrepa.map(l => `${esc(l.code)} (${l.nb} colis)`).join(' · ')}. Un lot s'ouvre tout seul s'il n'y en a pas.</p>` : ''}
        <details class="carte guide">
          <summary class="gras">Comment ça marche ?</summary>
          <ol class="pile" style="--gap:10px;margin-top:12px;padding-left:20px">${ETAPES_GUIDE.map(([t, d]) => `<li><b>${esc(t)}</b> : ${esc(d)}</li>`).join('')}</ol>
          <p class="petit muet" style="margin-top:10px">Chaque étape peut être faite par un agent différent : l'app sait où en est chaque colis. Dans « Scanner », vous n'avez rien à choisir.</p>
        </details>
      </div>`;
    K.notifications.carte(main.querySelector('[data-notifs]'), { texte: 'Lot en route vers votre agence, colis à mettre en rayon, nouvelle réservation : prévenu tout de suite.' });
    // Les tâches de scan ouvrent le scanner en mode automatique
    main.querySelectorAll('[data-tache]').forEach(a => a.addEventListener('click', () => { if (a.getAttribute('href') === '#/scanner') stock.ecrire('action_scan', 'auto'); }));
  }

  // ══════════════════════════════════════════════════════════
  //  SCAN : chargement, arrivée, guichet
  // ══════════════════════════════════════════════════════════
  const ACTIONS = {
    auto:      { lib: 'Automatique', titre: 'Scanner',                    consigne: 'Scannez n\'importe quel colis' },
    charger:   { lib: 'Charger',     titre: 'Mettre dans un lot',         consigne: 'Scannez chaque colis chargé' },
    arrivee:   { lib: 'Arrivée',     titre: 'Réception d\'un lot',         consigne: 'Scannez chaque colis reçu' },
    acheminer: { lib: 'Vers agence', titre: 'Envoi vers une autre agence', consigne: 'Scannez les colis qui partent vers une autre agence' },
    guichet:   { lib: 'En rayon',    titre: 'Mise en rayon',              consigne: 'Scannez le colis posé sur l\'étagère' },
  };

  async function vueScan(action) {
    if (!ACTIONS[action]) action = 'auto';
    const manuel = action !== 'auto';
    stock.ecrire('action_scan', action);
    const lots = action === 'charger' ? (CTX?.lotsPreparation || []) : action === 'arrivee' ? (CTX?.lotsEnRoute || []) : [];
    let lotChoisi = stock.lire(`lot_${action}`) || lots[0]?.code || '';
    if (lotChoisi && !lots.some(l => l.code === lotChoisi)) lotChoisi = lots[0]?.code || '';
    let manifeste = null; // numéros attendus dans le lot (pour alerter hors-ligne)

    main.innerHTML = `
      <div class="pile">
        ${manuel ? `
          <div class="ligne entre"><span class="petit gras">Étape choisie à la main</span><button type="button" class="btn-lien" data-action="auto">Revenir au mode automatique</button></div>
          <div class="segments" role="group" aria-label="Étape">${Object.entries(ACTIONS).filter(([k]) => k !== 'auto').map(([k, a]) => `<button type="button" data-action="${k}" aria-pressed="${k === action}">${esc(a.lib)}</button>`).join('')}</div>`
        : `<div class="bandeau bandeau-vert petit">${ic('scan', 'ic-sm')}<span>Scannez n'importe quel colis : l'app fait la bonne étape toute seule.</span></div>`}
        <div data-dernier></div>
        ${action === 'acheminer' ? `
          <p class="bandeau bandeau-ocre">${ic('colis', 'ic-sm')}<span>${CTX?.aAcheminer ? `<b>${CTX.aAcheminer}</b> colis arrivé(s) ici doivent partir vers d'autres agences.` : 'Aucun colis en attente d\'envoi vers une autre agence.'} Le destinataire est prévenu par SMS.</span></p>` : ''}
        ${action === 'charger' || action === 'arrivee' ? `
          <label class="champ">${action === 'charger' ? 'Lot en préparation' : 'Lot attendu'}
            <select class="saisie saisie-forte" data-lot>
              ${lots.length ? lots.map(l => `<option value="${esc(l.code)}" ${l.code === lotChoisi ? 'selected' : ''}>${esc(l.code)} · ${esc(CONFIG.sens.find(x => x.key === (l.sens || 'FR-GN'))?.label || '')}${l.reference ? ` · ${esc(l.reference)}` : ''}</option>`).join('')
                : `<option value="">${action === 'charger' ? 'Aucun lot ouvert : demandez à l\'admin' : 'Aucun lot en route'}</option>`}
              ${action === 'arrivee' ? '<option value="">Sans lot (colis isolé)</option>' : ''}
            </select>
          </label>
          <div class="carte pile cache" style="--gap:8px" data-avancement></div>` : action === 'acheminer' ? '' : `
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

        ${manuel ? '' : '<button type="button" class="btn-lien petit" data-action="charger" style="align-self:flex-start">Choisir l\'étape moi-même</button>'}
        <div class="ligne entre"><h3>Derniers scans</h3><span class="petit muet" data-compte></span></div>
        <div class="pile" style="--gap:8px" data-journal></div>
        ${action === 'charger' ? `<p class="petit muet">Quand tout est chargé, l'admin marque le lot « parti » : tous les clients sont prévenus.</p>` : ''}
      </div>`;

    const $ = (s) => main.querySelector(s);
    const viseur = $('[data-viseur]');
    main.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', async () => {
      if (arreterCamera) { try { await arreterCamera(); } catch {} arreterCamera = null; }
      vueScan(b.dataset.action);
    }));

    const dessinerJournal = () => {
      const lignes = journal.lire().filter(e => e.action === action).slice(0, 25);
      const d = lignes[0];
      const zoneDernier = $('[data-dernier]');
      if (zoneDernier) zoneDernier.innerHTML = d ? `
        <div class="dernier-scan ${d.etat}">
          <div class="ligne" style="--gap:12px">
            <div class="ico">${ic(d.etat === 'ok' ? 'ok' : d.etat === 'erreur' ? 'alerte' : d.etat === 'info' ? 'colis' : 'horloge')}</div>
            <div class="grandit">
              <div class="message">${esc(d.message || '')}</div>
              <div class="petit">${esc(d.numero)}${d.destinataire ? ` · ${esc(d.destinataire)}` : ''}</div>
            </div>
          </div>
          ${d.etat === 'ok' && d.actionFaite ? `<button type="button" class="btn btn-petit" data-annuler-scan="${esc(d.opId)}" style="align-self:flex-start">Annuler cette étape</button>` : ''}
          ${d.avant ? `<div class="tres-petit avant">Étape précédente : ${esc(d.avant.label)}${d.avant.lieu ? ` à ${esc(d.avant.lieu)}` : ''}${d.avant.par ? ` par ${esc(d.avant.par)}` : ''}, ${esc(date(d.avant.le))}</div>` : ''}
        </div>` : '';
      $('[data-compte]').textContent = lignes.length ? `${lignes.filter(e => e.etat === 'ok').length} OK · ${lignes.filter(e => e.etat === 'attente').length} en attente` : '';
      $('[data-journal]').innerHTML = lignes.length ? lignes.map(e => `
        <div class="scan ${e.etat}">
          <div class="ico">${ic(e.etat === 'ok' ? 'ok' : e.etat === 'erreur' ? 'alerte' : e.etat === 'info' ? 'colis' : 'horloge', 'ic-sm')}</div>
          <div class="grandit"><div class="gras">${esc(e.numero)}</div><div class="tres-petit">${esc(e.message || '')}${e.destinataire ? ` · ${esc(e.destinataire)}` : ''}</div></div>
          <span class="tres-petit muet">${esc(heure(e.le))}</span>
        </div>`).join('') : '<p class="vide petit">Aucun scan pour le moment.</p>';
    };
    dessinerJournal();
    // Erreur de scan (mauvais colis, mauvaise étape) : on annule la dernière étape du colis
    main.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-annuler-scan]');
      if (!b) return;
      const ent = journal.lire().find(x => x.opId === b.dataset.annulerScan);
      if (!ent || !confirm(`Annuler « ${ent.message} » pour ${ent.numero} ?`)) return;
      b.disabled = true;
      try {
        const r = await api.post('/agent/annuler', { numero: ent.numero, motif: 'Erreur de scan' });
        journal.maj(ent.opId, { etat: 'info', message: `Étape annulée : ${r.annulee}`, actionFaite: undefined });
        Scanner.bip(true); dessinerJournal(); rafraichirContexte().catch(() => {});
      } catch (err) { toast(err.reseau ? 'Pas de réseau : réessayez dans un instant.' : err.message, 'erreur'); b.disabled = false; }
    });
    let delaiManifeste;
    const ecoute = () => {
      dessinerJournal();
      // Met à jour le compteur du lot après chaque envoi
      clearTimeout(delaiManifeste);
      if ((action === 'charger' || action === 'arrivee') && navigator.onLine) delaiManifeste = setTimeout(() => chargerManifeste(), 400);
    };
    // Une seule écoute à la fois (on change souvent d'action sans changer d'onglet)
    if (ecouteJournal) document.removeEventListener('journal-maj', ecouteJournal);
    ecouteJournal = ecoute;
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
    brancherCamera(viseur, enregistrer);
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
            <span class="sous">Pour ${esc(c.destinataire.nom)} · ${K.libMode(c.mode)} · ${kg(c.poidsEstime)} annoncés${c.ramassage?.statut === 'faite' ? ` · ramassé par ${esc(c.ramassage.livreurNom || 'un livreur')}` : ''}${(c.paiements || []).length ? ` · <b style="color:var(--vert)">déjà payé en ligne : ${c.paiements.map(p => esc(montant(p.montant, p.devise))).join(' + ')}</b>` : ''}</span>
          </button>`).join('') : '<p class="vide petit">Aucune réservation trouvée.</p>';
        zone.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => formulaireDepot(r.colis[b.dataset.i])));
      } catch (err) { zone.innerHTML = `<p class="bandeau bandeau-rouge">${esc(err.message)}</p>`; }
    });
    main.querySelector('[data-nouveau]').addEventListener('click', () => formulaireDepot(null));
  }

  function formulaireDepot(resa) {
    const r = resa || {};
    // Agence de départ : celle de l'agent (un admin sans agence la choisit)
    const choisirDepart = !CTX?.lieu;
    const ramasse = r.ramassage?.demande && r.ramassage.statut !== 'annulee' ? r.ramassage : null;
    const livPrevue = r.livraison?.demande && r.livraison.statut !== 'annulee' ? r.livraison : null;
    const etat = {
      livraison: !!livPrevue,
      depot: CTX?.lieu?.code || r.depot || CONFIG.agences[0]?.code,
      mode: r.mode || 'air', typeColis: r.typeColis || 'vetements', guichet: r.guichet || '',
      assurance: !!r.assurance, payeurArrivee: !!r.payeurArrivee, methode: 'especes',
      articles: Object.fromEntries((r.articles || []).map(a => [a.cle, a.quantite])),
    };
    const paysDepart = () => agenceDe(etat.depot)?.pays || 'FR';
    const paysDest = () => (paysDepart() === 'FR' ? 'GN' : 'FR');
    const sens = () => `${paysDepart()}-${paysDest()}`;
    const articlesDispo = () => (CONFIG.articles || []).filter(a => Number.isFinite(parseFloat(a.prix?.[sens()]?.[etat.mode])));
    const articlesChoisis = () => articlesDispo().filter(a => etat.articles[a.cle] > 0).map(a => ({ cle: a.cle, quantite: etat.articles[a.cle] }));
    const devisePaie = () => CONFIG.pays[paysDepart()]?.devise || 'EUR'; // on paie dans la devise du pays de dépôt
    const optionsRetrait = () => {
      const parVille = {};
      CONFIG.agences.filter(a => a.pays === paysDest()).forEach(a => { (parVille[a.ville || 'Autres'] = parVille[a.ville || 'Autres'] || []).push(a); });
      return Object.entries(parVille).map(([v, l]) => `<optgroup label="${esc(v)}">${l.map(a => `<option value="${esc(a.code)}" ${a.code === etat.guichet ? 'selected' : ''}>${esc(a.nom)}${a.commune ? ` (${esc(a.commune)})` : ''}</option>`).join('')}</optgroup>`).join('');
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
          <p class="petit centre" data-repartition></p>
        </div>

        <div class="carte pile" style="--gap:2px" data-bloc-articles>
          <div class="gras">Articles à la pièce</div>
          <div class="tres-petit muet" style="margin-bottom:6px">Chaussures, téléphones… payés à la pièce. Pesez tout le colis : leur poids forfaitaire est retiré du poids au kilo.</div>
          <div class="pile" style="--gap:0" data-articles></div>
        </div>

        <h3>Transport et retrait</h3>
        ${choisirDepart ? `<label class="champ">Agence de départ <select class="saisie" name="depot">${CONFIG.agences.map(a => `<option value="${esc(a.code)}" ${a.code === etat.depot ? 'selected' : ''}>${esc(a.nom)} · ${esc(CONFIG.pays[a.pays]?.nom || a.pays)}</option>`).join('')}</select></label>` : ''}
        <div class="segments" role="group" aria-label="Transport">${CONFIG.modes.map(m => `<button type="button" data-mode="${m.key}" aria-pressed="${etat.mode === m.key}">${esc(m.label)}</button>`).join('')}</div>
        <label class="champ">Type d'affaires au kilo
          <select class="saisie" name="typeColis">${CONFIG.typesColis.map(t => `<option value="${t.key}" ${t.key === etat.typeColis ? 'selected' : ''}>${esc(t.label)}${t.surcharge ? ` (+${Math.round(t.surcharge * 100)} %)` : ''}</option>`).join('')}</select>
        </label>
        <label class="champ"><span data-lib-retrait>Agence de retrait</span>
          <select class="saisie saisie-forte" name="guichet" data-retrait></select>
        </label>
        <label class="case"><input type="checkbox" name="livraisonDom" ${etat.livraison ? 'checked' : ''}> Livraison à domicile à l'arrivée</label>
        <div class="pile ${etat.livraison ? '' : 'cache'}" style="--gap:8px" data-zone-liv>
          ${K.champsAdresse('liv', livPrevue?.adresse || {}, { maPosition: false, positionFacultative: true, aide: 'Collez la localisation envoyée par le destinataire (WhatsApp). Sinon, il pourra l\'envoyer depuis son suivi.' })}
        </div>
        ${ramasse ? `<p class="bandeau bandeau-vert petit">${ic('moto', 'ic-sm')} Ramassé à domicile${ramasse.livreurNom ? ` par ${esc(ramasse.livreurNom)}` : ''} : ${esc(montant(ramasse.prix, ramasse.devise))} ajoutés au prix.</p>` : ''}
        <div class="grille-2">
          <label class="champ">Cartons <input class="saisie" name="nbCartons" type="number" inputmode="numeric" min="1" value="${r.nbCartons || 1}"></label>
          <label class="champ">Description <input class="saisie" name="description" value="${esc(r.description || '')}" placeholder="Ex. vêtements, riz"></label>
        </div>

        <h3>Expéditeur</h3>
        <div class="grille-2">
          <label class="champ">Nom <input class="saisie" name="expNom" value="${esc(r.expediteur?.nom || '')}" required></label>
          <label class="champ">Téléphone <input class="saisie" name="expTel" type="tel" inputmode="tel" value="${esc(r.expediteur?.telephone || '')}" required></label>
        </div>
        <h3>Destinataire</h3>
        <div class="grille-2">
          <label class="champ">Nom <input class="saisie" name="destNom" value="${esc(r.destinataire?.nom || '')}" required></label>
          <label class="champ">Téléphone <input class="saisie" name="destTel" type="tel" inputmode="tel" value="${esc(r.destinataire?.telephone || '')}" required></label>
        </div>

        <h3>Options</h3>
        <label class="case"><input type="checkbox" name="assurance" ${etat.assurance ? 'checked' : ''}> Assurance (${(CONFIG.tauxAssurance * 100).toLocaleString('fr-FR')} % de la valeur)</label>
        <label class="champ ${etat.assurance ? '' : 'cache'}" data-valeur><span data-lib-valeur>Valeur déclarée</span> <input class="saisie" name="valeurDeclaree" type="number" inputmode="decimal" min="0" value="${r.valeurDeclaree || ''}"></label>

        <div class="carte-noire pile" style="--gap:6px" aria-live="polite" data-hors-etape>
          <div class="recap-prix cache" data-ligne-deja><span style="color: var(--gris)">Déjà payé en ligne</span><span class="gras" data-deja>0</span></div>
          <div class="recap-prix"><span style="color: var(--gris)">Prix à payer</span><span class="valeur" data-prix>0</span></div>
          <div class="recap-prix"><span style="color: var(--gris)">soit</span><span class="gras" data-prix-autre>0</span></div>
          <div class="tres-petit" style="color: var(--gris)" data-detail></div>
        </div>

        <h3>Paiement</h3>
        <label class="case"><input type="checkbox" name="payeurArrivee" ${etat.payeurArrivee ? 'checked' : ''}> Le destinataire paie à l'arrivée</label>
        <div class="pile" style="--gap:8px" data-paiement>
          <div class="grille-3" data-methodes></div>
          <p class="bandeau bandeau-bleu petit cache" data-aide-methode></p>
          <label class="champ" data-champ-montant><span data-lib-montant>Montant reçu</span> <input class="saisie saisie-forte" name="montant" type="number" inputmode="decimal" step="0.01" min="0"></label>
          <label class="champ cache" data-champ-ref>Référence de la transaction <input class="saisie" name="reference" autocomplete="off" autocapitalize="characters"></label>
          <p class="petit" data-rendu></p>
        </div>

        <h3>Photo du colis</h3>
        <div class="carte pile" style="--gap:8px">
          <p class="petit muet">Photographiez le colis fermé, étiquette visible. C'est la preuve de son état en cas de réclamation.</p>
          <div class="vignettes" data-photo-apercu></div>
          <label class="btn btn-plein">${ic('scan', 'ic-sm')} <span data-lib-photo>Prendre la photo</span><input type="file" accept="image/*" capture="environment" data-photo-colis hidden></label>
        </div>

        <h3>Conditions d'envoi</h3>
        ${r.cgv?.version ? `<p class="bandeau bandeau-vert petit">${ic('ok', 'ic-sm')} Conditions acceptées en ligne le ${esc(date(r.cgv.accepteesLe, false))}.</p>` : `
        <div class="carte pile" style="--gap:8px">
          <button type="button" class="btn btn-petit" data-voir-interdits>${ic('alerte', 'ic-sm')} Montrer la liste des objets interdits</button>
          <label class="case" style="align-items:flex-start"><input type="checkbox" name="cgvAcceptees" style="margin-top:2px"> <span>Le client a vu la liste des objets interdits, confirme que son colis n'en contient pas et accepte les conditions générales.</span></label>
        </div>`}

        <button class="btn btn-principal btn-grand btn-plein" type="submit">Enregistrer et imprimer l'étiquette</button>
      </form>`;

    const form = main.querySelector('[data-depot]');
    K.sectionner(form);
    const $ = (s) => form.querySelector(s);
    let photoColis = null;
    $('[data-photo-colis]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        photoColis = await K.photoReduite(f, { max: 1280, qualite: 0.65 });
        $('[data-photo-apercu]').innerHTML = `<img src="${photoColis}" alt="Photo du colis">`;
        $('[data-lib-photo]').textContent = 'Reprendre la photo';
      } catch (err) { toast(err.message, 'erreur'); }
    });
    $('[data-voir-interdits]')?.addEventListener('click', () => modale(`
      <div class="pile texte-legal" style="--gap:8px">
        <div class="ligne entre"><h2>Objets interdits</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        ${KolisLegal.listeInterdits()}
      </div>`));
    let tarif = null, paysAffiche = null;
    const adrLiv = K.brancherAdresse(form, 'liv', { valeur: livPrevue?.adresse || {}, agence: () => agenceDe(form.guichet.value), config: CONFIG, surChange: () => tarif && calc() });
    // Courses à domicile en GNF au taux du colis : ramassage fait + livraison si son prix est connu
    const domicileGnf = () => {
      if (!tarif) return 0;
      let t = ramasse?.prix ? KolisTarif.enGnf(ramasse.prix, ramasse.devise, tarif.taux) : 0;
      const c = form.livraisonDom.checked ? adrLiv.course() : null;
      if (c?.ok) t += c.prixGnf;
      else if (form.livraisonDom.checked && livPrevue?.prixGnf) t += livPrevue.prixGnf; // prix déjà fixé à la réservation
      return t;
    };
    // Ce que le client a déjà payé en ligne sur sa réservation (livraison, ramassage, acompte)
    const dejaPayeGnf = () => (tarif ? (r.paiements || []).reduce((t, p) => t + KolisTarif.enGnf(p.montant, p.devise, tarif.taux), 0) : 0);
    const mobile = () => MOBILES.includes(etat.methode);
    // Orange Money / MTN : le client paie en GNF sur le compte marchand, même depuis la France
    const deviseSaisie = () => (mobile() ? 'GNF' : devisePaie());
    const aPayerEn = (dv) => {
      const resteGnf = tarif.totalGnf + domicileGnf() - dejaPayeGnf();
      return Math.max(0, dv === 'EUR' ? Math.round((tarif.totalEur + (domicileGnf() - dejaPayeGnf()) / tarif.taux) * 100) / 100 : Math.round(resteGnf));
    };
    const aPayer = () => aPayerEn(deviseSaisie());
    const dev = (n) => montant(n, deviseSaisie());
    const majPays = () => {
      if (paysAffiche === paysDepart()) return;
      paysAffiche = paysDepart();
      if (!CONFIG.agences.some(a => a.code === etat.guichet && a.pays === paysDest())) etat.guichet = '';
      $('[data-retrait]').innerHTML = optionsRetrait();
      if (etat.guichet) $('[data-retrait]').value = etat.guichet;
      $('[data-lib-retrait]').textContent = `Agence de retrait en ${CONFIG.pays[paysDest()]?.nom}`;
      form.destTel.placeholder = paysDest() === 'GN' ? '6XX XX XX XX' : '06 XX XX XX XX';
      const methodes = methodesDe(devisePaie());
      if (!methodes.some(([k]) => k === etat.methode)) etat.methode = 'especes';
      $('[data-methodes]').innerHTML = methodes.map(([k, l]) => `<button type="button" class="choix choix-ocre" style="align-items:center;text-align:center" data-methode="${k}" aria-pressed="${etat.methode === k}"><span class="nom" style="font-size:14px">${l}</span></button>`).join('');
      form.querySelectorAll('[data-methode]').forEach(b => b.addEventListener('click', () => {
        const avant = deviseSaisie();
        etat.methode = b.dataset.methode;
        if (deviseSaisie() !== avant) delete form.montant.dataset.touche; // € ↔ GNF : on repart du montant dû
        calc();
      }));
      delete form.montant.dataset.touche;
    };
    const calc = () => {
      if (form.depot) etat.depot = form.depot.value;
      majPays();
      etat.guichet = form.guichet.value;
      const poids = parseFloat(form.poidsReel.value);
      etat.typeColis = form.typeColis.value;
      $('[data-valeur]').classList.toggle('cache', !form.assurance.checked);
      $('[data-paiement]').classList.toggle('cache', form.payeurArrivee.checked);
      $('[data-zone-liv]').classList.toggle('cache', !form.livraisonDom.checked);
      $('[data-champ-ref]').classList.toggle('cache', ['especes', 'stripe'].includes(etat.methode));
      $('[data-champ-montant]').classList.toggle('cache', etat.methode === 'stripe');
      $('[data-lib-montant]').textContent = `Montant reçu (${deviseSaisie() === 'EUR' ? '€' : 'GNF'})`;
      form.montant.step = deviseSaisie() === 'EUR' ? '0.01' : '500';
      form.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === etat.mode));
      form.querySelectorAll('[data-methode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.methode === etat.methode));
      const deviseTarif = CONFIG.tarifs[sens()]?.devise || 'EUR';
      $('[data-lib-valeur]').textContent = `Valeur déclarée (${deviseTarif === 'EUR' ? '€' : 'GNF'})`;
      const dispo = articlesDispo();
      $('[data-bloc-articles]').classList.toggle('cache', !dispo.length);
      // La liste n'est reconstruite que si les articles ou leurs prix changent : sinon un clic
      // sur « + » juste après la saisie du poids serait perdu (la liste changerait sous le doigt)
      const signature = JSON.stringify(dispo.map(a => [a.cle, a.label, a.prix[sens()][etat.mode]]));
      if ($('[data-articles]').dataset.signature !== signature) {
        $('[data-articles]').dataset.signature = signature;
        $('[data-articles]').innerHTML = dispo.map(a => {
        const q = etat.articles[a.cle] || 0;
        return `<div class="ligne-article${q ? ' choisi' : ''}">
          <div><div class="nom">${esc(a.label)}</div><div class="tres-petit muet">${esc(montant(parseFloat(a.prix[sens()][etat.mode]), deviseTarif))} la pièce · compte ${esc(String(a.poids || 0).replace('.', ','))} kg</div></div>
          <div class="compteur">
            <button type="button" class="btn btn-rond" data-art-moins="${esc(a.cle)}" aria-label="Retirer : ${esc(a.label)}" ${q ? '' : 'disabled'}>−</button>
            <span class="gras">${q}</span>
            <button type="button" class="btn btn-rond" data-art-plus="${esc(a.cle)}" aria-label="Ajouter : ${esc(a.label)}">+</button>
          </div>
        </div>`;
      }).join('');
      }
      $('[data-articles]').querySelectorAll('.ligne-article').forEach(l => {
        const cle = l.querySelector('[data-art-plus]').dataset.artPlus;
        const q = etat.articles[cle] || 0;
        l.classList.toggle('choisi', q > 0);
        l.querySelector('.compteur .gras').textContent = q;
        l.querySelector('[data-art-moins]').disabled = !q;
      });
      if (!(poids > 0)) { $('[data-repartition]').textContent = ''; $('[data-prix]').textContent = 'À peser'; $('[data-prix-autre]').textContent = ''; $('[data-detail]').textContent = 'Pesez le colis.'; tarif = null; return; }
      tarif = KolisTarif.calculerTarif(CONFIG.regles, { sens: sens(), mode: etat.mode, poidsKg: poids, typeColis: etat.typeColis, valeurDeclaree: form.valeurDeclaree.value, assurance: form.assurance.checked, articles: articlesChoisis() });
      $('[data-repartition]').innerHTML = tarif.articles.length
        ? `${kg(tarif.poidsFacture)} au kilo · ${kg(tarif.poidsArticles)} comptés dans les articles${poids < tarif.poidsArticles ? ' <b style="color:var(--rouge)">(la balance indique moins que les articles : vérifiez)</b>' : ''}` : '';
      const deja = dejaPayeGnf();
      $('[data-ligne-deja]').classList.toggle('cache', !(deja > 0));
      if (deja > 0) $('[data-deja]').textContent = devisePaie() === 'EUR' ? eur(deja / tarif.taux) : gnf(deja);
      $('[data-prix]').textContent = montant(aPayerEn(devisePaie()), devisePaie());
      $('[data-prix-autre]').textContent = devisePaie() === 'EUR' ? gnf(aPayerEn('GNF')) : eur(aPayerEn('EUR'));
      const aide = $('[data-aide-methode]');
      aide.classList.toggle('cache', !(mobile() || etat.methode === 'stripe') || form.payeurArrivee.checked);
      if (mobile()) aide.innerHTML = aideMobile(etat.methode, aPayerEn('GNF'));
      else if (etat.methode === 'stripe') aide.innerHTML = `${ic('carte', 'ic-sm')}<span>Après l'enregistrement, un <b>QR code de paiement</b> s'affiche : le client le scanne et paie par carte sur son téléphone.</span>`;
      const md = (n) => montant(n, tarif.devise);
      const cLiv = form.livraisonDom.checked ? adrLiv.course() : null;
      $('[data-detail]').textContent = `${tarif.transport || !tarif.articles.length ? `${kg(tarif.poidsFacture)} × ${md(tarif.prixKg)}` : ''}${tarif.articles.map(l => `${tarif.transport ? ' + ' : ''}${l.quantite} × ${l.label.toLowerCase()} (${md(l.montant)})`).join(tarif.transport ? '' : ' + ')}${tarif.surcharge ? ` + ${md(tarif.surcharge)} supplément` : ''}${tarif.assurance ? ` + ${md(tarif.assurance)} assurance` : ''}${ramasse?.prix ? ` + ${montant(ramasse.prix, ramasse.devise)} ramassage` : ''}${cLiv?.ok ? ` + ${montant(cLiv.prix, cLiv.devise)} livraison` : form.livraisonDom.checked ? ' + livraison (prix quand la position sera connue)' : ''}`;
      if (r.poidsEstime) {
        const ecart = Math.round((poids - r.poidsEstime) * 10) / 10;
        $('[data-ecart]').innerHTML = `Annoncé : ${kg(r.poidsEstime)} · ${ecart > 0 ? `<b style="color:var(--rouge)">+${kg(ecart)}</b>` : ecart < 0 ? `${kg(ecart)}` : 'identique'}`;
      }
      if (!form.montant.dataset.touche) form.montant.value = aPayer();
      const recu = parseFloat(form.montant.value) || 0;
      const trop = Math.round(dejaPayeGnf() - tarif.totalGnf - domicileGnf());
      if (trop > 0) { $('[data-rendu]').innerHTML = `<b style="color:var(--rouge)">Le client a payé ${devisePaie() === 'EUR' ? eur(trop / tarif.taux) : gnf(trop)} de trop en ligne : à lui rendre.</b>`; return; }
      $('[data-rendu]').innerHTML = etat.methode === 'especes' && recu > aPayer() ? `Monnaie à rendre : <b>${dev(recu - aPayer())}</b>` : recu < aPayer() && recu > 0 ? `<span style="color:var(--rouge)">Paiement partiel : reste ${dev(aPayer() - recu)}</span>` : '';
    };
    form.addEventListener('input', (e) => { if (e.target.name === 'montant') e.target.dataset.touche = '1'; calc(); });
    form.addEventListener('change', (e) => { if (e.target.name === 'guichet') adrLiv.recalculer(); calc(); });
    form.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { etat.mode = b.dataset.mode; calc(); }));
    $('[data-articles]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-art-plus],[data-art-moins]');
      if (!b) return;
      const cle = b.dataset.artPlus || b.dataset.artMoins;
      const q = Math.min(Math.max((etat.articles[cle] || 0) + (b.dataset.artPlus ? 1 : -1), 0), 99);
      if (q) etat.articles[cle] = q; else delete etat.articles[cle];
      calc();
    });
    $('[data-retour]').addEventListener('click', vueDepot);
    calc();
    form.poidsReel.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!tarif) { toast('Pesez le colis.', 'erreur'); form.poidsReel.focus(); return; }
      if (!form.guichet.value) { toast('Choisissez l\'agence de retrait.', 'erreur'); form.guichet.focus(); return; }
      const manque = ['expNom', 'expTel', 'destNom', 'destTel'].find(k => !form[k].value.trim());
      if (manque) { toast('Complétez les noms et téléphones.', 'erreur'); form[manque].focus(); return; }
      if (form.cgvAcceptees && !form.cgvAcceptees.checked) { toast('Faites confirmer au client les conditions et l\'absence d\'objet interdit.', 'erreur'); form.cgvAcceptees.focus(); return; }
      if (!photoColis && !confirm('Pas de photo du colis : en cas de réclamation, il n\'y aura aucune preuve de son état au dépôt. Enregistrer quand même ?')) return;
      let livraison;
      if (form.livraisonDom.checked) {
        const a = adrLiv.lire();
        // Adresse incomplète : la livraison est enregistrée « à compléter », jamais bloquante
        const c = a.position ? adrLiv.course() : null;
        if (c && !c.ok) { toast(`Livraison : ${c.message}`, 'erreur'); return; }
        livraison = { demande: true, adresse: a };
      } else if (livPrevue) livraison = { demande: false };
      const recu = parseFloat(form.montant.value) || 0;
      const parCarteQr = !form.payeurArrivee.checked && etat.methode === 'stripe' && aPayer() > 0;
      const paiement = !form.payeurArrivee.checked && !parCarteQr && recu > 0
        ? { montant: Math.min(recu, aPayer()), devise: deviseSaisie(), methode: etat.methode, objet: 'global', reference: form.reference.value.trim() || undefined } : undefined;
      if (paiement && mobile() && !paiement.reference) { toast('Notez la référence de la transaction (SMS de confirmation du client).', 'erreur'); form.reference.focus(); return; }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const res = await api.post('/agent/depot', {
          opId: form.dataset.opId || (form.dataset.opId = uid()),
          numeroSuivi: resa?.numeroSuivi,
          depot: etat.depot,
          poidsReel: parseFloat(form.poidsReel.value), mode: etat.mode, typeColis: etat.typeColis,
          guichet: form.guichet.value, nbCartons: parseInt(form.nbCartons.value, 10) || 1,
          articles: articlesChoisis(),
          description: form.description.value, assurance: form.assurance.checked,
          valeurDeclaree: parseFloat(form.valeurDeclaree.value) || 0, payeurArrivee: form.payeurArrivee.checked,
          expediteur: { nom: form.expNom.value.trim(), telephone: normTel(form.expTel.value) },
          destinataire: { nom: form.destNom.value.trim(), telephone: normTel(form.destTel.value) },
          livraison,
          paiement,
          cgvAcceptees: form.cgvAcceptees ? form.cgvAcceptees.checked : undefined,
          photo: photoColis || undefined,
        }, { delai: 45000 });
        depotTermine(res.colis, { carte: parCarteQr });
      } catch (err) {
        toast(err.reseau ? 'Pas de réseau : le dépôt a besoin de la connexion pour créer le numéro. Réessayez.' : err.message, 'erreur');
        btn.disabled = false;
      }
    });
  }

  // Factures du colis : ouvrir (imprimer / PDF) ou envoyer au client par WhatsApp
  async function blocFactures(zone, numero, { tel, filtre } = {}) {
    if (!zone) return;
    try {
      let { factures } = await api.get(`/factures/colis/${numero}`);
      if (filtre) factures = factures.filter(filtre);
      if (!factures.length) {
        // Rien d'émis : l'agent peut émettre la facture de ce qui est dû (colis pesé)
        zone.innerHTML = `<button type="button" class="btn btn-plein" data-emettre>${ic('liste', 'ic-sm')} Émettre la facture</button>`;
        zone.querySelector('[data-emettre]').addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          try { await api.post(`/factures/colis/${numero}/emettre`); toast('Facture émise.', 'ok'); blocFactures(zone, numero, { tel, filtre }); }
          catch (err) { toast(err.status === 409 ? 'Rien à facturer pour le moment.' : err.message, 'erreur'); zone.innerHTML = ''; }
        });
        return;
      }
      const wa = String(tel || '').replace(/[^\d]/g, '');
      zone.innerHTML = factures.map(f => {
        const lien = K.lienFacture(f);
        const texte = `${CONFIG.app} : votre ${f.type === 'avoir' ? 'avoir' : 'facture'} ${f.numero} pour le colis ${numero} (${montant(f.totalTTC, f.devise)}) : ${lien}`;
        return `
          <div class="carte pile" style="--gap:8px">
            <div class="ligne entre"><span class="gras">${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${esc(f.numero)}</span><span class="gras chiffres">${montant(f.totalTTC, f.devise)}</span></div>
            <div class="grille-3">
              <a class="btn btn-petit" href="${esc(lien)}" target="_blank" rel="noopener">${ic('liste', 'ic-sm')} Voir</a>
              <a class="btn btn-petit" href="${esc(lien)}&imprimer=1" target="_blank" rel="noopener">${ic('imprimer', 'ic-sm')} Imprimer</a>
              <a class="btn btn-petit" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(texte)}" target="_blank" rel="noopener">${ic('bulle', 'ic-sm')} WhatsApp</a>
            </div>
          </div>`;
      }).join('');
    } catch { zone.innerHTML = '<p class="petit muet centre">Facture consultable plus tard dans la fiche du colis.</p>'; }
  }

  // Message pour le destinataire : numéro de suivi, agence, code de retrait (sans SMS, c'est
  // l'expéditeur ou l'agent qui le lui transmet par WhatsApp)
  const messageDestinataire = (c) => {
    const base = (CONFIG.frontendUrl || 'https://tms-colis.netlify.app').replace(/\/$/, '');
    return `Bonjour ${c.destinataire.nom}, ${c.expediteur.nom} vous envoie un colis avec ${CONFIG.app || 'Talib Multi Services'}.\n`
      + `N° de suivi : ${c.numeroSuivi}\nRetrait : ${c.guichetInfo?.nom || c.guichet}${c.guichetInfo?.adresse ? `, ${c.guichetInfo.adresse}` : ''}\n`
      + (c.codeRetrait ? `Code de retrait : ${c.codeRetrait} (à donner à l'agence avec votre pièce d'identité, ne le partagez pas)\n` : '')
      + `Suivi : ${base}/?suivi=${c.numeroSuivi}`;
  };
  const blocCode = (c) => !c.codeRetrait ? '' : `
    <div class="carte pile centre carte-code" style="--gap:6px">
      <div class="petit gras">Code de retrait du destinataire</div>
      <div class="code-4">${c.codeRetrait.split('').map(d => `<div>${esc(d)}</div>`).join('')}</div>
      <p class="tres-petit muet">Donnez-le à l'expéditeur. Le destinataire le présente à l'agence avec sa pièce d'identité.</p>
      <div class="grille-2">
        <a class="btn btn-petit btn-plein" href="https://wa.me/${esc(String(c.destinataire.telephone || '').replace(/\D/g, ''))}?text=${encodeURIComponent(messageDestinataire(c))}" target="_blank" rel="noopener">${ic('bulle', 'ic-sm')} Au destinataire</a>
        <a class="btn btn-petit btn-plein" href="https://wa.me/${esc(String(c.expediteur.telephone || '').replace(/\D/g, ''))}?text=${encodeURIComponent(messageDestinataire(c))}" target="_blank" rel="noopener">${ic('bulle', 'ic-sm')} À l'expéditeur</a>
      </div>
    </div>`;

  function depotTermine(c, { carte = false } = {}) {
    const resteTxt = c.solde.soldeGnf > 0 ? `reste ${deviseAgent() === 'EUR' ? eur(c.solde.soldeEur) : gnf(c.solde.soldeGnf)}` : 'payé';
    main.innerHTML = `
      <div class="pile">
        <div class="carte-vert pile centre" style="--gap:8px">
          <span class="badge" style="align-self:center;background:var(--ocre);color:var(--encre)">${ic('ok', 'ic-sm')} Enregistré</span>
          <div class="num-grand">${esc(c.numeroSuivi)}</div>
          <div>${esc(c.destinataire.nom)} · ${esc(c.guichetInfo?.nom || c.guichet)}</div>
          <div data-reste-depot>${kg(c.poidsReel)} · ${c.tarif.devise === 'GNF' ? gnf(c.tarif.totalGnf) : eur(c.tarif.totalEur)} · ${resteTxt}</div>
        </div>
        ${c.solde.tropPayeGnf > 0 ? `<p class="bandeau bandeau-rouge">${ic('billet', 'ic-sm')}<span>Payé en ligne en trop : <b>${deviseAgent() === 'EUR' ? eur(c.solde.tropPayeGnf / (c.tarif.taux || CONFIG.tauxEurGnf)) : gnf(c.solde.tropPayeGnf)}</b>. Rendez-le au client (l'administrateur est prévenu).</span></p>` : ''}
        ${carte && c.solde.soldeGnf > 0 ? '<div data-paiement-carte></div>' : ''}
        ${blocCode(c)}
        <div class="carte centre qr-apercu" data-qr><div class="chargement"></div></div>
        <button class="btn btn-noir btn-grand btn-plein" data-imprimer>${ic('imprimer')} Imprimer ${c.nbCartons > 1 ? `${c.nbCartons} étiquettes` : 'l\'étiquette'}</button>
        <div class="pile" style="--gap:8px" data-factures-depot></div>
        <p class="petit muet centre">Le numéro de suivi est aussi envoyé à l'expéditeur (SMS ou notification).</p>
        <button class="btn btn-principal btn-grand btn-plein" data-suivant>${ic('plus')} Colis suivant</button>
      </div>`;
    Etiquette.apercu(main.querySelector('[data-qr]'), c.numeroSuivi);
    blocFactures(main.querySelector('[data-factures-depot]'), c.numeroSuivi, { tel: c.expediteur?.telephone });
    const zCarte = main.querySelector('[data-paiement-carte]');
    if (zCarte) panneauCarte(zCarte, c.numeroSuivi, {
      tel: c.expediteur?.telephone,
      surPaye: () => {
        main.querySelector('[data-reste-depot]').innerHTML = `${kg(c.poidsReel)} · ${c.tarif.devise === 'GNF' ? gnf(c.tarif.totalGnf) : eur(c.tarif.totalEur)} · <b>payé par carte</b>`;
        blocFactures(main.querySelector('[data-factures-depot]'), c.numeroSuivi, { tel: c.expediteur?.telephone });
      },
    });
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
        <div class="pile grille-cartes" style="--gap:8px" data-liste></div>
      </div>`;
    const liste = main.querySelector('[data-liste]');
    const dessiner = (f = '') => {
      const q = f.toLowerCase();
      const prets = (CTX?.colisPrets || []).filter(c => !q || c.destinataire.nom.toLowerCase().includes(q) || c.destinataire.telephone.includes(q) || c.numeroSuivi.toLowerCase().includes(q) || c.tiersAutorise?.nom?.toLowerCase().includes(q));
      liste.innerHTML = prets.length ? prets.slice(0, 40).map(c => `
        <button class="choix" data-num="${esc(c.numeroSuivi)}" style="width:100%">
          <span class="nom">${esc(c.destinataire.nom)}${c.emplacement ? ` · étagère ${esc(c.emplacement)}` : ''}${c.aLivrer ? ' · <span class="badge">à livrer</span>' : ''}</span>
          <span class="sous">${esc(c.numeroSuivi)} · depuis ${c.magasinage?.jours || 0} j${c.soldeGnf > 0 ? ` · reste ${deviseAgent() === 'EUR' ? eur(c.soldeEur) : gnf(c.soldeGnf)}` : ''}</span>
        </button>`).join('') : '<p class="vide petit">Aucun colis en attente.</p>';
      liste.querySelectorAll('[data-num]').forEach(b => b.addEventListener('click', () => ouvrirRemise(b.dataset.num)));
    };
    dessiner();
    main.querySelector('[data-filtre]').addEventListener('input', (e) => dessiner(e.target.value));
    main.querySelector('[data-cherche]').addEventListener('submit', (e) => { e.preventDefault(); const n = e.target.numero.value.trim(); if (n) ouvrirRemise(Scanner.extraireNumero(n)); });
    brancherCamera(main.querySelector('[data-viseur]'), (n) => { Scanner.bip(true); ouvrirRemise(n); });
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
        c = { ...(c || {}), numeroSuivi: f.numeroSuivi, destinataire: f.destinataire, tiersAutorise: f.tiersAutorise, poids: f.poidsReel, nbCartons: f.nbCartons, emplacement: f.emplacement, soldeGnf: f.solde.soldeGnf, soldeEur: f.solde.soldeEur, magasinage: f.solde.magasinage, detail: f.solde };
        horsCache = !c.empreinteCode;
      } catch (e) { if (!e.reseau) { toast(e.message, 'erreur'); return; } }
    }
    if (!c) { toast('Colis introuvable dans ce guichet (hors-ligne : liste du dernier chargement).', 'erreur'); return; }

    const opId = uid();
    const etat = { code: '', codeOk: null, retirePar: 'destinataire', methode: 'especes', sansCode: false, cartePayee: false };
    // On encaisse dans la devise du pays de l'agence (€ en France, GNF en Guinée) ;
    // Orange Money / MTN se paient en GNF sur le compte marchand.
    const devise = deviseAgent();
    const mobile = () => MOBILES.includes(etat.methode);
    const deviseSaisie = () => (mobile() ? 'GNF' : devise);
    const soldeEn = (dv) => (c.soldeGnf > 0 ? (dv === 'EUR' ? (c.soldeEur || 0) : c.soldeGnf) : 0);
    const solde = soldeEn(devise);
    const dev = (n) => montant(n, deviseSaisie());
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
          <div class="ligne"><span class="etape-num" style="width:26px;height:26px;border-radius:13px;background: var(--marine);color: #fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700">1</span><h3>Code de retrait</h3></div>
          <div class="pile" style="--gap:8px" data-avec-code>
            <div class="code-4" data-code>${[0, 1, 2, 3].map(i => `<input inputmode="numeric" maxlength="1" aria-label="Chiffre ${i + 1}" autocomplete="off">`).join('')}</div>
            <p class="petit gras" data-verdict aria-live="polite"></p>
            <button type="button" class="btn btn-petit" data-sans-code>${ic('alerte', 'ic-sm')} La personne n'a pas le code</button>
          </div>
          <div class="pile cache" style="--gap:8px" data-zone-sans-code>
            <p class="bandeau bandeau-ocre petit">${ic('alerte', 'ic-sm')}<span>Retrait sans code : demandez le <b>numéro de téléphone du destinataire</b> (sans le lui montrer), vérifiez la pièce d'identité et notez son numéro. L'administrateur est prévenu.</span></p>
            <label class="champ">Téléphone du destinataire, donné par la personne <input class="saisie" name="telConfirme" type="tel" inputmode="tel" autocomplete="off" placeholder="${paysAgent() === 'GN' ? '6XX XX XX XX' : '06 XX XX XX XX'}"></label>
            <label class="champ">N° de la pièce d'identité <input class="saisie" name="pieceNumero" autocomplete="off" autocapitalize="characters"></label>
            <button type="button" class="btn btn-petit" data-avec-code-retour>J'ai le code finalement</button>
          </div>
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
          <div class="ligne"><span style="width:26px;height:26px;border-radius:13px;background: var(--marine);color: #fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700">2</span><h3 class="grandit">Encaisser</h3><span class="titre" style="font-size:20px">${dev(solde)}</span></div>
          ${c.magasinage?.fraisGnf ? `<p class="tres-petit muet">Dont frais de garde : ${gnf(c.magasinage.fraisGnf)} (${c.magasinage.joursFactures} j)</p>` : ''}
          <div class="grille-3">${methodesDe(devise).map(([k, l]) => `<button type="button" class="choix choix-ocre" style="align-items:center;text-align:center" data-methode="${k}" aria-pressed="${k === 'especes'}"><span class="nom" style="font-size:14px">${l}</span></button>`).join('')}</div>
          <p class="bandeau bandeau-bleu petit cache" data-aide-methode></p>
          <div data-zone-carte></div>
          <label class="champ" data-champ-recu><span data-lib-recu>Montant reçu (${devise === 'EUR' ? '€' : 'GNF'})</span> <input class="saisie saisie-forte" name="recu" type="number" inputmode="decimal" min="0" step="${devise === 'EUR' ? '0.01' : '500'}" value="${solde}"></label>
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

    // Retrait sans code (SMS jamais reçu) : téléphone du destinataire + pièce d'identité
    const basculerSansCode = (oui) => {
      etat.sansCode = oui;
      $('[data-avec-code]').classList.toggle('cache', oui);
      $('[data-zone-sans-code]').classList.toggle('cache', !oui);
      if (oui) form.telConfirme.focus(); else cases[0].focus();
    };
    $('[data-sans-code]').addEventListener('click', () => basculerSansCode(true));
    $('[data-avec-code-retour]').addEventListener('click', () => basculerSansCode(false));

    const majMonnaie = () => {
      if (!solde) return;
      const du = soldeEn(deviseSaisie());
      const recu = parseFloat(form.recu.value) || 0;
      const m = $('[data-monnaie]');
      $('[data-champ-ref]').classList.toggle('cache', ['especes', 'stripe'].includes(etat.methode));
      $('[data-champ-recu]').classList.toggle('cache', etat.methode === 'stripe');
      const aide = $('[data-aide-methode]');
      aide.classList.toggle('cache', !mobile());
      if (mobile()) aide.innerHTML = aideMobile(etat.methode, c.soldeGnf);
      if (etat.methode === 'stripe') { m.classList.add('cache'); return; }
      if (etat.methode === 'especes' && recu > du) { m.classList.remove('cache'); m.innerHTML = `Monnaie à rendre : <b>&nbsp;${dev(Math.round((recu - du) * 100) / 100)}</b>`; }
      else if (recu < du) { m.classList.remove('cache'); m.innerHTML = `<span style="color:var(--rouge)">Il manque ${dev(Math.round((du - recu) * 100) / 100)}</span>`; }
      else m.classList.add('cache');
    };
    form.querySelectorAll('[data-methode]').forEach(b => b.addEventListener('click', () => {
      const avant = deviseSaisie();
      etat.methode = b.dataset.methode;
      form.querySelectorAll('[data-methode]').forEach(x => x.setAttribute('aria-pressed', x === b));
      if (deviseSaisie() !== avant) {
        form.recu.value = soldeEn(deviseSaisie());
        form.recu.step = deviseSaisie() === 'EUR' ? '0.01' : '500';
        $('[data-lib-recu]').textContent = `Montant reçu (${deviseSaisie() === 'EUR' ? '€' : 'GNF'})`;
      }
      const zc = $('[data-zone-carte]');
      if (etat.methode === 'stripe' && !etat.cartePayee) panneauCarte(zc, c.numeroSuivi, { tel: c.destinataire?.telephone, surPaye: () => { etat.cartePayee = true; } });
      else if (etat.methode !== 'stripe') zc.innerHTML = '';
      majMonnaie();
    }));
    form.recu?.addEventListener('input', majMonnaie);

    const sig = Signature($('[data-signature]'));
    $('[data-effacer]').addEventListener('click', sig.effacer);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (etat.sansCode) {
        if (!navigator.onLine) { toast('Le retrait sans code a besoin du réseau.', 'erreur'); return; }
        if (!form.telConfirme.value.trim()) { toast('Demandez le numéro de téléphone du destinataire.', 'erreur'); form.telConfirme.focus(); return; }
        if (form.pieceNumero.value.trim().length < 4) { toast('Notez le numéro de la pièce d\'identité.', 'erreur'); form.pieceNumero.focus(); return; }
      } else {
        if (etat.code.length !== 4) { toast('Tapez le code de retrait.', 'erreur'); cases[0].focus(); return; }
        if (etat.codeOk === false) { toast('Code incorrect. Demandez le code au destinataire, ou passez par « La personne n\'a pas le code ».', 'erreur'); return; }
      }
      if (!form.piece.checked) { toast('Vérifiez la pièce d\'identité.', 'erreur'); return; }
      if (etat.retirePar === 'tiers' && !form.nomRetrait.value.trim()) { toast('Nom de la personne présente requis.', 'erreur'); return; }
      const parCarte = solde > 0 && etat.methode === 'stripe';
      if (parCarte && !etat.cartePayee) { toast('Attendez la confirmation du paiement par carte (QR code).', 'erreur'); return; }
      const duSaisie = soldeEn(deviseSaisie());
      if (solde > 0 && !parCarte && (parseFloat(form.recu.value) || 0) < duSaisie) { toast(`Il faut encaisser ${dev(duSaisie)}.`, 'erreur'); return; }
      if (solde > 0 && mobile() && !form.reference.value.trim()) { toast('Notez la référence de la transaction (SMS de confirmation).', 'erreur'); form.reference.focus(); return; }
      if (sig.vide()) { toast('Faites signer la personne.', 'erreur'); return; }
      const payload = {
        opId, numero: c.numeroSuivi, pieceVerifiee: true,
        ...(etat.sansCode ? { sansCode: true, telephoneConfirme: normTel(form.telConfirme.value), pieceNumero: form.pieceNumero.value.trim() } : { code: etat.code }),
        retirePar: etat.retirePar, nomRetrait: etat.retirePar === 'tiers' ? form.nomRetrait.value.trim() : undefined,
        paiement: solde > 0 && !parCarte ? { montant: duSaisie, devise: deviseSaisie(), methode: etat.methode, objet: 'global', reference: form.reference?.value || undefined } : undefined,
        signature: sig.image(),
      };
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await api.post('/agent/remise', payload);
        remiseTerminee(c, false);
      } catch (err) {
        if (err.reseau && etat.codeOk && !etat.sansCode) {
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
        <div class="pile" style="--gap:8px" data-factures-remise></div>
        <a class="btn btn-principal btn-grand btn-plein" href="#/remise" data-suivant>Colis suivant</a>
      </div>`;
    main.querySelector('[data-suivant]').addEventListener('click', (e) => { e.preventDefault(); router(); });
    if (!horsLigne) {
      rafraichirContexte().catch(() => {});
      // Facture complémentaire émise à la remise (douane, garde…), ou facture complète si le destinataire paie
      blocFactures(main.querySelector('[data-factures-remise]'), c.numeroSuivi, { tel: c.destinataire?.telephone, filtre: (f) => Date.now() - new Date(f.date) < 10 * 60000 });
    }
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
      <div class="pile" data-caisse>
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
        <h3>Mon compte</h3>
        <div class="grille-2">
          <button class="btn" type="button" data-mdp>Mot de passe</button>
          <button class="btn" type="button" data-sortir>${ic('sortie', 'ic-sm')} Déconnexion</button>
        </div>
      </div>`;
    main.querySelector('[data-mdp]').addEventListener('click', () => K.changerMotDePasse());
    main.querySelector('[data-sortir]').addEventListener('click', () => {
      if (file.lire().length && !confirm('Des opérations ne sont pas encore envoyées. Elles resteront sur ce téléphone. Se déconnecter quand même ?')) return;
      session.fermer(); stock.suppr('ctx'); CTX = null; location.hash = '#/'; router();
    });
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
  //  COURSES À DOMICILE (livreurs) : ramassages et livraisons
  // ══════════════════════════════════════════════════════════
  const MOTIFS_ECHEC = ['Absent', 'Ne répond pas au téléphone', 'Adresse introuvable', 'Ne peut pas payer', 'Refuse le colis'];
  const libMoment = (k) => (CONFIG.moments || []).find(m => m.key === k)?.label || '';
  const lienItineraire = (p) => p?.lat ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : '';
  const telWa = (t) => String(t || '').replace(/[^\d]/g, '');
  // Position du téléphone au moment de valider (contrôle a posteriori) — jamais bloquant
  const positionRapide = () => Promise.race([K.gpsActuel().catch(() => null), new Promise(r => setTimeout(() => r(null), 8000))]);

  async function vueCourses() {
    if (navigator.onLine) await rafraichirContexte().catch(e => toast(e.message, 'erreur'));
    const moi = session.utilisateur()._id;
    const toutes = CTX?.courses || [];
    const miennes = toutes.filter(c => String(c.livreur) === String(moi));
    const libres = toutes.filter(c => !c.livreur);
    const onglet = stock.lire('onglet_courses') || 'miennes';
    const liste = onglet === 'miennes' ? miennes : libres;
    main.innerHTML = `
      <div class="pile">
        <div data-notifs></div>
        <div class="segments" role="group" aria-label="Courses">
          <button type="button" data-seg="miennes" aria-pressed="${onglet === 'miennes'}">Mes courses (${miennes.length})</button>
          <button type="button" data-seg="libres" aria-pressed="${onglet === 'libres'}">À prendre (${libres.length})</button>
        </div>
        ${CTX?.majLe && !navigator.onLine ? `<p class="bandeau bandeau-ocre">${ic('horsligne', 'ic-sm')} Hors ligne : liste du ${esc(date(CTX.majLe))}.</p>` : ''}
        <div class="pile grille-cartes" style="--gap:12px">${liste.length ? liste.map(carteCourse).join('') : `<p class="vide petit">${onglet === 'miennes' ? 'Aucune course pour vous. Regardez « À prendre ».' : 'Aucune course en attente.'}</p>`}</div>
      </div>`;
    main.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => { stock.ecrire('onglet_courses', b.dataset.seg); vueCourses(); }));
    K.notifications.carte(main.querySelector('[data-notifs]'), { texte: 'Nouvelle course pour vous ou dans votre agence : prévenu tout de suite.' });
    main.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => actionCourse(b.dataset.act, toutes.find(c => c.numeroSuivi === b.dataset.num && c.type === b.dataset.type), b)));
  }

  function carteCourse(c) {
    const a = c.adresse || {};
    const p = a.position;
    const aLAgence = c.type === 'ramassage' || ['pret', 'en_livraison'].includes(c.statutColis);
    const moi = String(c.livreur) === String(session.utilisateur()._id);
    const tel = a.telephone || c.contact?.telephone;
    const devise = deviseAgent();
    const btn = (act, lib, cls = '') => `<button type="button" class="btn ${cls}" data-act="${act}" data-num="${esc(c.numeroSuivi)}" data-type="${c.type}">${lib}</button>`;
    let actions = '';
    if (!c.livreur) actions = btn('prendre', `${ic('ok', 'ic-sm')} Je m'en charge`, 'btn-principal');
    else if (moi && c.type === 'ramassage') actions = btn('ramasse', `${ic('ok', 'ic-sm')} Colis ramassé`, 'btn-principal') + btn('echec', 'Pas pu') + btn('lacher', 'Rendre');
    else if (moi && c.statut === 'en_route') actions = btn('livrer', `${ic('ok', 'ic-sm')} Remettre le colis`, 'btn-principal') + btn('echec', 'Pas pu livrer');
    else if (moi && aLAgence) actions = (p?.lat ? btn('depart', `${ic('moto', 'ic-sm')} Je pars livrer`, 'btn-principal') : '<p class="bandeau bandeau-ocre petit">Position du destinataire manquante : appelez-le pour qu\'il l\'envoie depuis son suivi.</p>') + btn('lacher', 'Rendre');
    else if (moi) actions = '<p class="petit muet">Pas encore arrivé à l\'agence.</p>' + btn('lacher', 'Rendre');
    return `
      <div class="carte course">
        <div class="entete-course">
          <span class="type-course ${c.type}">${c.type === 'ramassage' ? 'Ramassage' : 'Livraison'}</span>
          <span class="petit muet grandit">${esc(c.numeroSuivi)}</span>
          ${c.prix ? `<span class="gras">${esc(montant(c.prix, c.devise))}</span>` : ''}
        </div>
        <div class="gras" style="font-size:17px">${esc(a.nom || c.contact?.nom || '')}</div>
        <div class="adresse-course">${a.rue ? `${esc(a.rue)}<br>` : ''}${esc([a.quartier, a.ville].filter(Boolean).join(', '))}${a.repere ? `<br><span class="muet">${esc(a.repere)}</span>` : ''}</div>
        ${p?.source === 'adresse' ? `<div class="tres-petit" style="color:var(--ocre-texte)">${ic('alerte', 'ic-sm')} Position approximative (d'après l'adresse écrite) : appelez avant de partir.</div>` : !p?.lat ? `<div class="tres-petit" style="color:var(--ocre-texte)">${ic('alerte', 'ic-sm')} Pas de position : appelez le client pour trouver l'adresse.</div>` : ''}
        <div class="petit muet">${esc([c.distanceKm && `${String(c.distanceKm).replace('.', ',')} km de l'agence`, [c.jour && date(c.jour, false), libMoment(c.moment)].filter(Boolean).join(' '), c.nbCartons && `${c.nbCartons} carton(s)`, c.poids && kg(c.poids)].filter(Boolean).join(' · '))}</div>
        ${c.type === 'livraison' && c.soldeGnf > 0 ? `<div class="bandeau bandeau-ocre petit">${ic('billet', 'ic-sm')} À encaisser : <b>&nbsp;${esc(devise === 'EUR' ? eur(c.soldeEur) : gnf(c.soldeGnf))}</b></div>` : ''}
        ${c.echecs?.length ? `<div class="tres-petit rouge">${c.echecs.length} passage(s) manqué(s) : ${esc(c.echecs.at(-1).motif)}</div>` : ''}
        <div class="actions-course">
          ${tel ? `<a class="btn btn-petit" href="tel:${esc(tel)}">${ic('tel', 'ic-sm')} Appeler</a><a class="btn btn-petit" href="https://wa.me/${esc(telWa(tel))}" target="_blank" rel="noopener">${ic('bulle', 'ic-sm')} WhatsApp</a>` : ''}
          ${p?.lat ? `<a class="btn btn-petit" href="${esc(lienItineraire(p))}" target="_blank" rel="noopener">${ic('lieu', 'ic-sm')} Itinéraire</a>` : ''}
        </div>
        <div class="actions-course">${actions}</div>
      </div>`;
  }

  async function actionCourse(act, c, bouton) {
    if (!c) return;
    const corps = { numero: c.numeroSuivi, type: c.type };
    try {
      if (act === 'livrer') return formulaireLivraison(c);
      if (act === 'echec') return echecCourse(c);
      if (act === 'lacher' && !confirm('Rendre cette course ? Un autre livreur pourra la prendre.')) return;
      bouton.disabled = true;
      if (act === 'prendre') { await api.post('/livreur/prendre', corps); toast('Course ajoutée à vos courses.', 'ok'); stock.ecrire('onglet_courses', 'miennes'); }
      if (act === 'lacher') { await api.post('/livreur/lacher', corps); toast('Course rendue.'); }
      if (act === 'depart') { await api.post('/livreur/depart', corps); toast('Bonne route ! Le destinataire est prévenu.', 'ok'); }
      if (act === 'ramasse') {
        toast('Enregistrement…');
        await api.post('/livreur/ramasse', { ...corps, opId: uid(), position: await positionRapide() });
        toast('Ramassé. Rapportez le colis à l\'agence pour la pesée.', 'ok');
      }
      vueCourses();
    } catch (e) { toast(e.reseau ? 'Pas de réseau : réessayez dans un instant.' : e.message, 'erreur'); if (bouton) bouton.disabled = false; }
  }

  function echecCourse(c) {
    const { el, fermer } = modale(`
      <form class="pile" style="--gap:12px">
        <div class="ligne entre"><h2>Que s'est-il passé ?</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        ${MOTIFS_ECHEC.map(m => `<button type="button" class="choix" data-motif="${esc(m)}"><span class="nom">${esc(m)}</span></button>`).join('')}
        <label class="champ">Autre raison <input class="saisie" name="motif"></label>
        <button class="btn btn-principal" type="submit">Valider</button>
        ${c.type === 'livraison' ? '<p class="tres-petit muet">Rapportez le colis à l\'agence : il est remis en rayon.</p>' : ''}
      </form>`);
    const envoyer = async (motif) => {
      try { await api.post('/livreur/echec', { numero: c.numeroSuivi, type: c.type, motif }); fermer(); toast('Noté. Le client est prévenu.'); vueCourses(); }
      catch (e) { toast(e.message, 'erreur'); }
    };
    el.querySelectorAll('[data-motif]').forEach(b => b.addEventListener('click', () => envoyer(b.dataset.motif)));
    el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const m = e.target.motif.value.trim(); if (m) envoyer(m); else toast('Choisissez une raison.', 'erreur'); });
  }

  // Remise chez le destinataire : code (vérifié sur le téléphone), paiement, signature. Marche hors-ligne.
  function formulaireLivraison(c) {
    const opId = uid();
    const devise = deviseAgent();
    const solde = c.soldeGnf > 0 ? (devise === 'EUR' ? c.soldeEur : c.soldeGnf) : 0;
    const etat = { code: '', codeOk: null, methode: 'especes' };
    main.innerHTML = `
      <form class="pile" novalidate>
        <div class="ligne"><button type="button" class="btn btn-rond" data-retour aria-label="Retour">${ic('retour')}</button><h2 class="grandit">Remise à domicile</h2></div>
        <div class="carte"><div class="gras">${esc(c.contact?.nom || '')}</div><div class="petit muet">${esc(c.numeroSuivi)} · ${c.nbCartons || 1} carton(s)</div></div>
        <div class="carte pile">
          <h3>1. Code donné par le destinataire</h3>
          <div class="code-4" data-code>${[0, 1, 2, 3].map(i => `<input inputmode="numeric" maxlength="1" aria-label="Chiffre ${i + 1}" autocomplete="off">`).join('')}</div>
          <p class="petit gras" data-verdict aria-live="polite"></p>
        </div>
        ${solde > 0 ? `
        <div class="carte pile">
          <div class="ligne entre"><h3>2. Encaisser</h3><span class="titre" style="font-size:20px">${montant(solde, devise)}</span></div>
          <div class="grille-3">${methodesDe(devise, { qr: false }).filter(([k]) => devise === 'GNF' || !MOBILES.includes(k)).map(([k, l]) => `<button type="button" class="choix choix-ocre" style="align-items:center;text-align:center" data-methode="${k}" aria-pressed="${k === 'especes'}"><span class="nom" style="font-size:14px">${l}</span></button>`).join('')}</div>
          <label class="champ cache" data-champ-ref>Référence de la transaction <input class="saisie" name="reference" autocomplete="off"></label>
          <label class="case"><input type="checkbox" name="encaisse"> J'ai reçu ${montant(solde, devise)}</label>
        </div>` : `<p class="bandeau bandeau-vert">${ic('ok', 'ic-sm')} Tout est payé.</p>`}
        <div class="carte pile" style="--gap:10px">
          <div class="ligne entre"><h3>Signature</h3><button type="button" class="btn btn-petit" data-effacer>Effacer</button></div>
          <canvas class="signature" data-signature aria-label="Zone de signature"></canvas>
        </div>
        <button class="btn btn-principal btn-grand btn-plein" type="submit">${ic('ok')} Colis remis</button>
      </form>`;
    const form = main.querySelector('form');
    const $ = (q) => form.querySelector(q);
    $('[data-retour]').addEventListener('click', () => router());
    const cases = [...form.querySelectorAll('[data-code] input')];
    cases[0].focus();
    const verifier = async () => {
      etat.code = cases.map(i => i.value).join('');
      const zone = $('[data-code]'), verdict = $('[data-verdict]');
      zone.classList.remove('ok', 'faux'); verdict.textContent = ''; etat.codeOk = null;
      if (etat.code.length < 4 || !c.empreinteCode) return;
      etat.codeOk = (await K.sha256(`${c.numeroSuivi}:${etat.code}`)) === c.empreinteCode;
      zone.classList.add(etat.codeOk ? 'ok' : 'faux');
      verdict.innerHTML = etat.codeOk ? `<span class="vert">${ic('ok', 'ic-sm')} Code correct</span>` : '<span class="rouge">Code incorrect</span>';
      Scanner.bip(etat.codeOk);
    };
    cases.forEach((inp, i) => {
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(-1); if (inp.value && cases[i + 1]) cases[i + 1].focus(); verifier(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && cases[i - 1]) cases[i - 1].focus(); });
    });
    form.querySelectorAll('[data-methode]').forEach(b => b.addEventListener('click', () => {
      etat.methode = b.dataset.methode;
      form.querySelectorAll('[data-methode]').forEach(x => x.setAttribute('aria-pressed', x === b));
      $('[data-champ-ref]').classList.toggle('cache', etat.methode === 'especes');
    }));
    const sig = Signature($('[data-signature]'));
    $('[data-effacer]').addEventListener('click', sig.effacer);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (etat.code.length !== 4) { toast('Tapez le code du destinataire.', 'erreur'); return; }
      if (etat.codeOk === false) { toast('Code incorrect.', 'erreur'); return; }
      if (solde > 0 && !form.encaisse.checked) { toast(`Encaissez ${montant(solde, devise)} avant de remettre.`, 'erreur'); return; }
      if (sig.vide()) { toast('Faites signer le destinataire.', 'erreur'); return; }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      const payload = {
        opId, numero: c.numeroSuivi, code: etat.code, signature: sig.image(), position: await positionRapide(),
        paiement: solde > 0 ? { montant: solde, devise, methode: etat.methode, objet: 'global', reference: form.reference?.value || undefined } : undefined,
      };
      const fini = (horsLigne) => {
        if (CTX?.courses) { CTX.courses = CTX.courses.filter(x => !(x.numeroSuivi === c.numeroSuivi && x.type === 'livraison')); stock.ecrire('ctx', CTX); }
        main.innerHTML = `
          <div class="pile centre">
            <div class="carte-vert pile" style="--gap:8px"><h1>Colis livré</h1><p>${esc(c.numeroSuivi)} · ${esc(c.contact?.nom || '')}</p></div>
            ${horsLigne ? `<p class="bandeau bandeau-ocre">${ic('horsligne', 'ic-sm')} Pas de réseau : la livraison est gardée sur ce téléphone et sera envoyée automatiquement.</p>` : ''}
            <div class="pile" style="--gap:8px" data-factures-livraison></div>
            <a class="btn btn-principal btn-grand btn-plein" href="#/courses" data-suivant>Course suivante</a>
          </div>`;
        main.querySelector('[data-suivant]').addEventListener('click', (ev) => { ev.preventDefault(); router(); });
        if (!horsLigne) blocFactures(main.querySelector('[data-factures-livraison]'), c.numeroSuivi, { tel: c.adresse?.telephone || c.contact?.telephone, filtre: (f) => Date.now() - new Date(f.date) < 10 * 60000 });
      };
      try { await api.post('/livreur/livre', payload); fini(false); }
      catch (err) {
        if (err.reseau && etat.codeOk) {
          file.ajouter({ opId, type: 'livre', payload, le: Date.now() });
          journal.ajouter({ opId, numero: c.numeroSuivi, action: 'livraison', etat: 'attente', message: 'Livraison en attente d\'envoi', le: Date.now() });
          fini(true);
        } else { toast(err.reseau ? 'Pas de réseau et code impossible à vérifier ici.' : err.message, 'erreur'); btn.disabled = false; }
      }
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
      // Douane saisie dans le pays d'arrivée, dans sa devise
      const paysDest = String(c.sens || 'FR-GN').split('-')[1];
      const deviseDouane = CONFIG.pays[paysDest]?.devise || 'GNF';
      const peutDouane = !paysAgent() || paysAgent() === paysDest;
      const taux = c.tarif?.taux || CONFIG.tauxEurGnf;
      zone.innerHTML = `
        <div class="pile">
          <div class="carte pile" style="--gap:6px">
            <div class="ligne entre"><span class="titre" style="font-size:20px">${esc(c.numeroSuivi)}</span><span class="badge b-${c.statut}">${esc(c.statutLabel)}</span></div>
            <div class="ligne-info"><span>Expéditeur</span><span>${esc(c.expediteur.nom)} · ${esc(c.expediteur.telephone)}</span></div>
            <div class="ligne-info"><span>Destinataire</span><span>${esc(c.destinataire.nom)} · ${esc(c.destinataire.telephone)}</span></div>
            ${c.tiersAutorise?.nom ? `<div class="ligne-info"><span>Autorisé</span><span>${esc(c.tiersAutorise.nom)}</span></div>` : ''}
            <div class="ligne-info"><span>Guichet</span><span>${esc(c.guichetInfo?.nom || c.guichet)}</span></div>
            <div class="ligne-info"><span>Poids</span><span>${kg(c.poidsReel || c.poidsEstime)} · ${c.nbCartons} carton(s)</span></div>
            <div class="ligne-info"><span>Lot</span><span>${esc(c.lotCode || 'Pas encore')}</span></div>
            <div class="ligne-info"><span>Sens</span><span>${esc(CONFIG.sens.find(x => x.key === (c.sens || 'FR-GN'))?.label || '')}</span></div>
            <div class="ligne-info"><span>Transport</span><span>${eur(c.tarif?.totalEur)} (${gnf(c.tarif?.totalGnf)})</span></div>
            <div class="ligne-info"><span>Douane</span><span>${deviseDouane === 'EUR' ? eur((c.fraisDouaneGnf || 0) / taux) : gnf(c.fraisDouaneGnf)}</span></div>
            <div class="ligne-info"><span>Reste à payer</span><span class="gras">${deviseDouane === 'EUR' ? eur(c.solde.soldeEur) : gnf(c.solde.soldeGnf)}</span></div>
          </div>
          ${blocCode(c)}
          ${c.solde.soldeGnf > 0 && stripeActif() && c.tarif && !c.tarif.estime && !['remis', 'annule'].includes(c.statut) ? `<button class="btn btn-plein" data-qr-carte>${ic('carte', 'ic-sm')} Faire payer le reste par carte (QR code)</button><div data-zone-qr-fiche></div>` : ''}
          ${peutDouane && !['remis', 'annule'].includes(c.statut) ? `
          <form class="carte pile" data-douane>
            <h3>Droits de douane</h3>
            <div class="ligne" style="--gap:8px"><input class="saisie grandit" name="douane" type="number" inputmode="decimal" min="0" step="${deviseDouane === 'EUR' ? '0.01' : '500'}" value="${c.fraisDouaneGnf ? (deviseDouane === 'EUR' ? Math.round(c.fraisDouaneGnf / taux * 100) / 100 : c.fraisDouaneGnf) : ''}" placeholder="Montant en ${deviseDouane === 'EUR' ? '€' : 'GNF'}"><button class="btn btn-noir">Enregistrer</button></div>
          </form>` : ''}
          <button class="btn btn-plein" data-reimprimer>${ic('imprimer', 'ic-sm')} Réimprimer l'étiquette</button>
          ${(() => { const d = [...c.historique].reverse().find(h => h.statut && !h.annule); return d?.retour && d.statut !== 'remis' ? `<button class="btn btn-plein" data-annuler-etape>Annuler la dernière étape (${esc(d.label)})</button>` : ''; })()}
          ${c.tarif && !c.tarif.estime ? `<h3>Factures</h3><div class="pile" style="--gap:8px" data-factures-fiche></div>` : ''}
          <div class="carte"><h3 style="margin-bottom:12px">Historique</h3><div class="frise">${[...c.historique].reverse().map(h => `
            <div class="etape ${h.annule ? 'annulee' : ''}"><div class="rail"><div class="point"></div><div class="trait"></div></div><div class="texte"><div class="gras">${esc(h.label)}${h.annule ? ' (annulée)' : ''}</div><div class="petit muet">${esc(date(h.le))}${h.detail ? ` · ${esc(h.detail)}` : ''}${h.agent?.prenom ? ` · par ${esc(h.agent.prenom)} ${esc((h.agent.nom || '')[0] || '')}.` : ''}</div></div></div>`).join('')}</div></div>
        </div>`;
      zone.querySelector('[data-douane]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api.patch(`/agent/colis/${c.numeroSuivi}/douane`, { montant: parseFloat(e.target.douane.value) || 0, devise: deviseDouane }); toast('Douane enregistrée.', 'ok'); afficherFiche(c.numeroSuivi); }
        catch (err) { toast(err.message, 'erreur'); }
      });
      zone.querySelector('[data-reimprimer]').addEventListener('click', () => Etiquette.imprimer(c, CONFIG));
      zone.querySelector('[data-qr-carte]')?.addEventListener('click', (e) => {
        e.currentTarget.remove();
        panneauCarte(zone.querySelector('[data-zone-qr-fiche]'), c.numeroSuivi, { tel: c.payeurArrivee ? c.destinataire.telephone : c.expediteur.telephone, surPaye: () => setTimeout(() => afficherFiche(c.numeroSuivi), 1500) });
      });
      zone.querySelector('[data-annuler-etape]')?.addEventListener('click', async () => {
        const motif = prompt('Pourquoi annuler cette étape ? (noté dans l\'historique)');
        if (motif === null) return;
        try { const r = await api.post('/agent/annuler', { numero: c.numeroSuivi, motif }); toast(`Étape annulée : ${r.annulee}.`, 'ok'); afficherFiche(c.numeroSuivi); }
        catch (err) { toast(err.message, 'erreur'); }
      });
      const zf = zone.querySelector('[data-factures-fiche]');
      if (zf) {
        await blocFactures(zf, c.numeroSuivi, { tel: c.statut === 'remis' || c.payeurArrivee ? c.destinataire.telephone : c.expediteur.telephone });
        if (!zf.innerHTML.trim()) zf.innerHTML = '<p class="petit muet">Aucune facture pour l\'instant (émise au dépôt, ou à la remise si le destinataire paie).</p>';
      }
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
  K.miseAJourAuto();
  K.garderSession();
  demarrer();
})();
