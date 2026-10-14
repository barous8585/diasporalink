// ─────────────────────────────────────────────────────────────
//  Back-office : tableau de bord, lots, colis, caisses, réglages, équipe
// ─────────────────────────────────────────────────────────────
(function () {
  const { api, session, stock, esc, gnf, eur, montant, kg, date, heure, ic, toast, modale, normTel } = K;
  const main = document.getElementById('contenu');
  let CONFIG = null;
  const LIB_STATUT_LOT = { preparation: 'En préparation', parti: 'Parti', arrive: 'Arrivé', cloture: 'Clôturé' };
  const badge = (statut, lib) => `<span class="badge b-${esc(statut)}">${esc(lib || CONFIG?.statuts?.[statut] || statut)}</span>`;
  const nomLieu = (code) => (CONFIG?.agences || []).find(l => l.code === code)?.nom || code || 'Aucune';
  const libSens = (sens) => CONFIG?.sens?.find(x => x.key === (sens || 'FR-GN'))?.label || '';
  const optionsAgences = (pays, choisi) => {
    const parVille = {};
    (CONFIG?.agences || []).filter(a => !pays || a.pays === pays).forEach(a => { const k = `${CONFIG.pays[a.pays]?.nom} · ${a.ville || 'Autres'}`; (parVille[k] = parVille[k] || []).push(a); });
    return Object.entries(parVille).map(([v, l]) => `<optgroup label="${esc(v)}">${l.map(a => `<option value="${esc(a.code)}" ${a.code === choisi ? 'selected' : ''}>${esc(a.nom)}</option>`).join('')}</optgroup>`).join('');
  };

  document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = ic(el.dataset.ic, el.classList.contains('logo-carre') ? '' : 'ic-sm'); });

  // ── Routeur ──
  const routes = [
    [/^\/?$/, tableauDeBord, 'bord'],
    [/^\/lots$/, () => lots(), 'lots'],
    [/^\/lots\/([\w-]+)$/, (c) => lots(c), 'lots'],
    [/^\/colis$/, colis, 'colis'],
    [/^\/caisses$/, caisses, 'caisses'],
    [/^\/courses$/, courses, 'courses'],
    [/^\/reclamations$/, () => reclamations(), 'reclamations'],
    [/^\/reclamations\/([\w-]+)$/, (n) => reclamation(n), 'reclamations'],
    [/^\/factures$/, factures, 'factures'],
    [/^\/reglages$/, reglages, 'reglages'],
    [/^\/equipe$/, equipe, 'equipe'],
  ];

  // ── Menu en tiroir (téléphone) ──
  const menu = document.querySelector('[data-menu]');
  const voile = document.querySelector('[data-voile]');
  const boutonMenu = document.querySelector('[data-ouvrir-menu]');
  const basculerMenu = (ouvrir) => {
    menu.classList.toggle('ouvert', ouvrir); voile.classList.toggle('ouvert', ouvrir);
    boutonMenu.setAttribute('aria-expanded', ouvrir);
  };
  boutonMenu.addEventListener('click', () => basculerMenu(!menu.classList.contains('ouvert')));
  voile.addEventListener('click', () => basculerMenu(false));
  menu.addEventListener('click', (e) => { if (e.target.closest('a, button')) basculerMenu(false); });

  // ── Tableaux lisibles sur téléphone : chaque cellule reçoit le nom de sa colonne ──
  function etiqueterTableaux(racine = main) {
    racine.querySelectorAll('table.tableau').forEach(t => {
      const libs = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (!td.hasAttribute('data-lib') && !td.hasAttribute('colspan')) td.setAttribute('data-lib', libs[i] || ''); }));
    });
  }
  new MutationObserver(() => etiqueterTableaux()).observe(main, { childList: true, subtree: true });

  // ── Rafraîchissement automatique des pages « vivantes » ──
  // Toutes les 45 s si la page est visible et que personne n'est en train de saisir.
  const VIVANTES = new Set(['bord', 'lots', 'courses', 'reclamations']);
  let pageActuelle = null;
  setInterval(() => {
    if (document.hidden || !VIVANTES.has(pageActuelle) || document.querySelector('.modale-fond')) return;
    const actif = document.activeElement;
    if (actif && main.contains(actif) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(actif.tagName)) return;
    if (/^#\/(lots|reclamations)\/./.test(location.hash)) return; // fiche ouverte : on ne bouge pas
    const y = window.scrollY;
    router({ silencieux: true }).then(() => window.scrollTo(0, y));
  }, 45000);

  async function router({ silencieux = false } = {}) {
    if (!session.connecte()) return connexion();
    const u = session.utilisateur();
    if (u.role !== 'admin') {
      document.querySelector('[data-menu]').classList.add('cache'); document.body.classList.add('hors-session');
      main.innerHTML = `<div class="pile" style="max-width:420px"><h1>Accès réservé</h1><p class="muet">Ce compte n'est pas administrateur.</p><button class="btn" data-sortir2>Se déconnecter</button></div>`;
      main.querySelector('[data-sortir2]').onclick = () => { session.fermer(); router(); };
      return;
    }
    document.querySelector('[data-menu]').classList.remove('cache'); document.body.classList.remove('hors-session');
    if (!router.pastille) { router.pastille = true; majPastilleRec(); }
    const chemin = location.hash.replace(/^#/, '').split('?')[0] || '/';
    for (const [re, vue, nav] of routes) {
      const m = chemin.match(re);
      if (!m) continue;
      document.querySelectorAll('[data-nav]').forEach(a => a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
      pageActuelle = nav;
      document.querySelector('[data-titre-mobile]').textContent = document.querySelector(`[data-nav="${nav}"]`)?.textContent.replace(/\d+$/, '').trim() || 'Back-office';
      main.classList.toggle('entree', !silencieux);
      if (!silencieux) main.innerHTML = '<div class="chargement"></div>';
      try { await vue(...m.slice(1)); }
      catch (e) { main.innerHTML = `<p class="bandeau bandeau-rouge">${esc(e.message)}</p>`; }
      return;
    }
    location.hash = '#/';
  }

  function connexion() {
    document.querySelector('[data-menu]').classList.add('cache'); document.body.classList.add('hors-session');
    main.innerHTML = '<div style="max-width:420px;margin:40px auto" data-zone></div>';
    K.vueConnexion(main.querySelector('[data-zone]'), { titre: 'Back-office', surSucces: () => router() });
  }

  function majEncartTaux() {
    const jours = CONFIG.tauxMisAJourLe ? Math.floor((Date.now() - new Date(CONFIG.tauxMisAJourLe)) / 86400000) : null;
    document.querySelector('[data-taux]').innerHTML = `<b>Taux du jour</b><br>1 € = ${gnf(CONFIG.tauxEurGnf)}<br>${jours === null ? '' : jours === 0 ? 'mis à jour aujourd\'hui' : `mis à jour il y a ${jours} j`}<br><a href="#/reglages">Modifier</a>`;
  }

  // ══════════════════════════════════════════════════════════
  //  TABLEAU DE BORD
  // ══════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════
  //  TABLEAU DE BORD : toute l'entreprise d'un coup d'œil
  // ══════════════════════════════════════════════════════════
  const COULEUR_MODE = { express: '#eb6834', air: '#2a78d6', mer: '#1baf7a' };   // palette validée (ordre fixe)
  const LIB_MODE = { express: 'Express', air: 'Avion', mer: 'Bateau' };
  const LIB_METHODE = { especes: 'Espèces', carte: 'Carte au comptoir', virement: 'Virement', orange_money: 'Orange Money', mtn_momo: 'MTN MoMo', carte_en_ligne: 'Carte en ligne', orange_money_en_ligne: 'Orange Money en ligne', mtn_momo_en_ligne: 'MTN MoMo en ligne' };
  const nf = (n, d = 0) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: d });
  const eurC = (n) => (Math.abs(n) >= 10000 ? `${nf(n / 1000, 1)} k€` : eur(n));
  const delta = (v, p) => {
    if (!p && !v) return '<span class="delta neutre">stable</span>';
    if (!p) return '<span class="delta haut">nouveau</span>';
    const d = Math.round(((v - p) / p) * 100);
    return `<span class="delta ${d > 0 ? 'haut' : d < 0 ? 'bas' : 'neutre'}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)} %</span>`;
  };
  // Colonnes (empilées si plusieurs séries) en SVG, avec infobulle au survol
  function colonnes(donnees, series, { hauteur = 180, format = (v) => nf(v), etroit = false } = {}) {
    // Largeur de dessin proche de la largeur réelle : le texte des axes garde une taille lisible
    const n = donnees.length, L = innerWidth < 760 || etroit ? 360 : 640, H = hauteur, bas = 22, haut = 18;
    const total = (d) => series.reduce((a, s) => a + (d[s.cle] || 0), 0);
    const max = Math.max(1, ...donnees.map(total));
    const pas = Math.pow(10, Math.floor(Math.log10(max)));
    const ech = Math.ceil(max / pas) * pas;
    const bande = L / n, larg = Math.max(3, Math.min(24, bande * 0.62));
    const y = (v) => H - bas - (v / ech) * (H - bas - haut);
    const graduations = [0, ech / 2, ech];
    let svg = graduations.map(g => `<line x1="0" x2="${L}" y1="${y(g)}" y2="${y(g)}" class="grille"/><text x="0" y="${y(g) - 3}" class="axe">${format(g)}</text>`).join('');
    donnees.forEach((d, i) => {
      const x = i * bande + (bande - larg) / 2;
      let cumul = 0;
      const tip = `${new Date(d.jour).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} : ${series.map(s => `${s.lib} ${format(d[s.cle] || 0)}`).join(' · ')}`;
      series.forEach((s, k) => {
        const v = d[s.cle] || 0; if (!v) return;
        const y1 = y(cumul + v), y0 = y(cumul);
        const h = Math.max(1, y0 - y1 - (cumul > 0 ? 2 : 0));
        const dernier = series.slice(k + 1).every(t => !(d[t.cle] > 0));
        svg += `<path d="${dernier ? `M${x},${y1 + h} V${y1 + 4} Q${x},${y1} ${x + 4},${y1} H${x + larg - 4} Q${x + larg},${y1} ${x + larg},${y1 + 4} V${y1 + h} Z` : `M${x},${y1} h${larg} v${h} h${-larg} Z`}" fill="${s.couleur}"/>`;
        cumul += v;
      });
      svg += `<rect x="${i * bande}" y="0" width="${bande}" height="${H - bas}" fill="transparent" data-tip="${esc(tip)}"/>`;
      if (n <= 14 || i % Math.ceil(n / 8) === 0 || i === n - 1) svg += `<text x="${x + larg / 2}" y="${H - 6}" class="axe" text-anchor="middle">${new Date(d.jour).toLocaleDateString('fr-FR', { day: 'numeric', month: n > 31 ? 'short' : undefined })}</text>`;
    });
    return `<svg class="graphe" viewBox="0 0 ${L} ${H}" role="img" aria-label="Graphique">${svg}</svg>`;
  }
  // Colonnes groupées (2 séries côte à côte, même unité) : facturé et encaissé par mois
  function colonnesGroupees(donnees, series, { cle = 'mois', format = (v) => nf(v) } = {}) {
    const n = donnees.length, L = innerWidth < 760 ? 360 : 900, H = 200, bas = 22, haut = 18;
    const max = Math.max(1, ...donnees.flatMap(d => series.map(s => d[s.cle] || 0)));
    const pas = Math.pow(10, Math.floor(Math.log10(max)));
    const ech = Math.ceil(max / pas) * pas;
    const bande = L / n, larg = Math.max(3, Math.min(22, (bande * 0.7) / series.length - 2));
    const y = (v) => H - bas - (Math.max(0, v) / ech) * (H - bas - haut);
    let svg = [0, ech / 2, ech].map(g => `<line x1="0" x2="${L}" y1="${y(g)}" y2="${y(g)}" class="grille"/><text x="0" y="${y(g) - 3}" class="axe">${format(g)}</text>`).join('');
    donnees.forEach((d, i) => {
      const x0 = i * bande + (bande - (larg + 2) * series.length) / 2;
      const libMois = new Date(`${d[cle]}-01`).toLocaleDateString('fr-FR', { month: 'short' });
      series.forEach((s, k) => {
        const v = d[s.cle] || 0; if (v <= 0) return;
        const x = x0 + k * (larg + 2), y1 = y(v), h = H - bas - y1;
        svg += `<path d="M${x},${y1 + h} V${y1 + 4} Q${x},${y1} ${x + 4},${y1} H${x + larg - 4} Q${x + larg},${y1} ${x + larg},${y1 + 4} V${y1 + h} Z" fill="${s.couleur}"/>`;
      });
      svg += `<rect x="${i * bande}" y="0" width="${bande}" height="${H - bas}" fill="transparent" data-tip="${esc(`${new Date(`${d[cle]}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} : ${series.map(s => `${s.lib} ${format(d[s.cle] || 0)}`).join(' · ')}`)}"/>`;
      svg += `<text x="${i * bande + bande / 2}" y="${H - 6}" class="axe" text-anchor="middle">${libMois}</text>`;
    });
    return `<svg class="graphe" viewBox="0 0 ${L} ${H}" role="img" aria-label="Chiffre d'affaires par mois">${svg}</svg>`;
  }
  function barresH(items, { couleur = 'var(--marine)', format = (v) => nf(v) } = {}) {
    const max = Math.max(1, ...items.map(i => i.v));
    return `<div class="barres-h">${items.map(i => `
      <div class="bh" data-tip="${esc(`${i.lib} : ${format(i.v)}`)}">
        <span class="bh-lib">${i.pastille ? `<i style="background:${i.pastille}"></i>` : ''}${esc(i.lib)}</span>
        <span class="bh-piste"><span style="width:${Math.max(i.v ? 2 : 0, (i.v / max) * 100)}%;background:${i.couleur || couleur}"></span></span>
        <span class="bh-val">${format(i.v)}</span>
      </div>`).join('')}</div>`;
  }
  function brancherInfobulles(zone) {
    let tip = document.querySelector('.infobulle');
    if (!tip) { tip = document.createElement('div'); tip.className = 'infobulle'; document.body.appendChild(tip); }
    zone.querySelectorAll('[data-tip]').forEach(el => {
      el.addEventListener('mousemove', (e) => { tip.textContent = el.dataset.tip; tip.style.display = 'block'; tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`; tip.style.top = `${e.clientY + 14}px`; });
      el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
  }

  async function tableauDeBord() {
    const jours = stock.lire('tdb_jours') || 30;
    const t = await api.get(`/admin/tableau?jours=${jours}`);
    const k = t.kpi;
    const lib = jours === 365 ? '12 mois' : `${jours} jours`;
    const panier = k.deposes ? k.caEur / k.deposes : 0;
    const p = t.pipeline;
    const aFaire = [
      [t.aFaire.paiementsAVerifier, 'paiement(s) mobile money à vérifier', '#/caisses', 'billet', 'or'],
      [t.aFaire.reclamations, 'réclamation(s) à traiter', '#/reclamations', 'alerte', 'rouge'],
      [t.domicile.sansLivreur, 'course(s) à domicile sans livreur', '#/courses', 'moto', 'bleu'],
      [t.guichets.impayes, `colis prêt(s) avec un reste à payer (${gnf(t.guichets.impayesGnf)})`, '#/colis?statut=pret', 'prix', 'or'],
      [t.nbBloques, 'colis qui n\'avancent plus', '#bloques', 'horloge', 'rouge'],
      [t.aFaire.caissesEnRetard, 'caisse(s) pas clôturée(s) hier', '#/caisses', 'billet', 'violet'],
    ].filter(x => x[0] > 0);
    const ageTaux = t.tauxMisAJourLe ? Math.floor((Date.now() - new Date(t.tauxMisAJourLe)) / 86400000) : null;
    if (ageTaux !== null && ageTaux > 7) aFaire.push([ageTaux, `jours sans mise à jour du taux (1 € = ${gnf(t.taux)})`, '#/reglages', 'prix', 'violet']);
    const etapes = [['reserve', 'Réservés'], ['depose', 'Déposés'], ['charge', 'Chargés'], ['en_transit', 'En route'], ['arrive', 'Arrivés'], ['acheminement', 'Vers l\'agence'], ['pret', 'Prêts au retrait'], ['en_livraison', 'En livraison']];
    const enCours = etapes.reduce((a, [s]) => a + (p[s] || 0), 0);

    main.innerHTML = `
      <div class="entete-page"><div><h1>Tableau de bord</h1><p class="petit muet" style="margin-top:4px">${esc(date(new Date(), false))} · ${enCours} colis en cours · ${(CONFIG.agences || []).length} agences</p></div>
        <div class="ligne" style="--gap:8px;flex-wrap:wrap">
          <div class="segments segments-compacts" role="group" aria-label="Période">${[[7, '7 j'], [30, '30 j'], [90, '90 j'], [365, '12 mois']].map(([v, l]) => `<button type="button" data-jours="${v}" aria-pressed="${v === jours}">${l}</button>`).join('')}</div>
          <button class="btn btn-principal btn-petit" data-nouveau-lot>${ic('plus', 'ic-sm')} Nouveau lot</button>
        </div></div>

      <section class="a-faire-bandeau">
        ${aFaire.length ? aFaire.map(([n, txt, lien, icone, ton]) => `<a class="puce-alerte ${ton}" href="${lien}">${ic(icone, 'ic-sm')}<b>${nf(n)}</b> ${esc(txt)}</a>`).join('') : `<span class="puce-alerte vert">${ic('ok', 'ic-sm')} Tout est à jour</span>`}
      </section>

      <div class="kpis kpis-couleur">
        <div class="kpi c-marine"><div class="kpi-tete"><span class="kpi-ic">${ic('billet')}</span>Encaissé · ${lib}</div><div class="val">${eurC(k.encaisseEur)}</div><div class="sous">${eur(t.encaisse.EUR)} + ${gnf(t.encaisse.GNF)}</div>${delta(k.encaisseEur, k.encaisseEurPrec)}</div>
        <div class="kpi c-or"><div class="kpi-tete"><span class="kpi-ic">${ic('prix')}</span>Chiffre d'affaires transport</div><div class="val">${eurC(k.caEur)}</div><div class="sous">colis pesés sur ${lib}</div>${delta(k.caEur, k.caEurPrec)}</div>
        <div class="kpi c-bleu"><div class="kpi-tete"><span class="kpi-ic">${ic('colis')}</span>Colis déposés</div><div class="val">${nf(k.deposes)}</div><div class="sous">${nf(k.reservations)} réservations en ligne</div>${delta(k.deposes, k.deposesPrec)}</div>
        <div class="kpi c-violet"><div class="kpi-tete"><span class="kpi-ic">${ic('balance')}</span>Kilos transportés</div><div class="val">${nf(k.kg)} kg</div><div class="sous">${k.deposes ? `${nf(k.kg / k.deposes, 1)} kg par colis` : 'aucun colis'}</div>${delta(k.kg, k.kgPrec)}</div>
        <div class="kpi c-vert"><div class="kpi-tete"><span class="kpi-ic">${ic('ok')}</span>Colis remis</div><div class="val">${nf(k.remis)}</div><div class="sous">aux destinataires</div>${delta(k.remis, k.remisPrec)}</div>
        <div class="kpi c-orange"><div class="kpi-tete"><span class="kpi-ic">${ic('liste')}</span>Panier moyen</div><div class="val">${eur(panier)}</div><div class="sous">par colis déposé</div></div>
      </div>

      <section class="panneau bloc-ca">
        <div class="panneau-tete teinte-or"><div><h2>Chiffre d'affaires</h2><p class="tres-petit muet">Facturé (factures moins avoirs, TTC) sur ${lib} · équivalent euros au taux de chaque colis</p></div><a class="btn btn-petit" href="#/factures">Factures</a></div>
        <div class="ca-grille">
          <div class="ca-chiffres">
            <div class="ca-principal"><span>Chiffre d'affaires TTC</span><b>${eurC(t.ca.eur)}</b>${delta(t.ca.eur, t.ca.eurPrec)}</div>
            <div class="ca-ligne"><span>Facturé en euros</span><b>${eur(t.ca.ttc.EUR)}</b></div>
            <div class="ca-ligne"><span>Facturé en francs guinéens</span><b>${gnf(t.ca.ttc.GNF)}</b></div>
            <div class="ca-ligne"><span>Hors taxes</span><b>${eur(t.ca.htEur)}</b></div>
            <div class="ca-ligne"><span>TVA collectée</span><b>${eur(t.ca.tvaEur)}</b></div>
            <div class="ca-ligne"><span>Avoirs (remboursements)</span><b>${t.ca.avoirsEur ? `− ${eur(t.ca.avoirsEur)}` : '0 €'}</b></div>
            <div class="ca-ligne"><span>Factures émises</span><b>${nf(t.ca.nbFactures)}</b></div>
            <div class="ca-ligne alerte"><span>Reste à encaisser (${nf(t.ca.creancesNb)} colis)</span><b>${eur(t.ca.creancesEur)}</b></div>
          </div>
          <div>
            <h3 class="sous-titre-tdb">D'où vient le chiffre d'affaires</h3>
            ${t.ca.parNature.length ? barresH(t.ca.parNature.map(x => ({ lib: ({ transport: 'Transport au kilo', articles: 'Articles à la pièce', assurance: 'Assurance', domicile: 'Ramassage et livraison', garde: 'Frais de garde', douane: 'Douane (débours)', autres: 'Autres' })[x.nature] || x.nature, v: x.eur })), { couleur: '#C8982B', format: (v) => eur(v) }) : '<p class="muet petit">Aucune facture sur la période.</p>'}
            <h3 class="sous-titre-tdb" style="margin-top:16px">Par agence qui facture</h3>
            ${t.ca.parAgence.length ? barresH(t.ca.parAgence.map(x => ({ lib: x.code === 'EN_LIGNE' ? 'Paiements en ligne' : nomLieu(x.code), v: x.eur })), { couleur: '#04244F', format: (v) => eur(v) }) : '<p class="muet petit">Aucune facture sur la période.</p>'}
          </div>
          <div class="ca-mois">
            <div class="ligne entre" style="flex-wrap:wrap;gap:8px"><h3 class="sous-titre-tdb">12 derniers mois</h3><div class="legende"><span><i style="background:#04244F"></i>Facturé</span><span><i style="background:#C8982B"></i>Encaissé</span></div></div>
            ${colonnesGroupees(t.ca.parMois, [{ cle: 'factureEur', lib: 'Facturé', couleur: '#04244F' }, { cle: 'encaisseEur', lib: 'Encaissé', couleur: '#C8982B' }], { format: (v) => (v >= 1000 ? `${nf(v / 1000, 1)} k€` : `${nf(v)} €`) })}
          </div>
        </div>
      </section>

      <div class="grille-tdb">
        <section class="panneau large">
          <div class="panneau-tete teinte-bleu"><div><h2>Colis déposés par jour</h2><p class="tres-petit muet">Par mode de transport · ${lib}</p></div>
            <div class="legende">${['express', 'air', 'mer'].map(m => `<span><i style="background:${COULEUR_MODE[m]}"></i>${LIB_MODE[m]}</span>`).join('')}</div></div>
          <div class="panneau-corps">${colonnes(t.parJour, ['express', 'air', 'mer'].map(m => ({ cle: m, lib: LIB_MODE[m], couleur: COULEUR_MODE[m] })))}</div>
        </section>
        <section class="panneau">
          <div class="panneau-tete teinte-vert"><div><h2>Encaissé par jour</h2><p class="tres-petit muet">Équivalent en euros, toutes agences</p></div></div>
          <div class="panneau-corps">${colonnes(t.parJour, [{ cle: 'encaisseEur', lib: 'Encaissé', couleur: '#04244F' }], { format: (v) => (v >= 1000 ? `${nf(v / 1000, 1)} k€` : `${nf(v)} €`), etroit: innerWidth >= 1200 })}</div>
        </section>

        <section class="panneau">
          <div class="panneau-tete teinte-violet"><div><h2>Où sont les colis maintenant</h2><p class="tres-petit muet">${enCours} colis en cours</p></div></div>
          <div class="panneau-corps">${barresH(etapes.map(([s, l]) => ({ lib: l, v: p[s] || 0, couleur: s === 'pret' || s === 'en_livraison' ? '#1F7A4D' : s === 'reserve' ? '#C8982B' : '#04244F' })))}</div>
        </section>
        <section class="panneau">
          <div class="panneau-tete teinte-or"><div><h2>Délai moyen dépôt → retrait</h2><p class="tres-petit muet">Colis arrivés en agence sur ${lib}</p></div></div>
          <div class="panneau-corps delais">${['express', 'air', 'mer'].map(m => `
            <div class="delai"><span class="pastille-mode" style="background:${COULEUR_MODE[m]}">${K.icMode(m, 'ic-sm')}</span>
              <div><div class="gras">${LIB_MODE[m]}</div><div class="tres-petit muet">${t.delais[m].nb} colis · prévu ${esc((CONFIG.modes || []).find(x => x.key === m)?.delai || '')}</div></div>
              <b class="delai-val">${t.delais[m].moyenne === null ? '<span class="muet petit">pas de donnée</span>' : `${nf(t.delais[m].moyenne, 1)} j`}</b></div>`).join('')}
          </div>
        </section>
        <section class="panneau">
          <div class="panneau-tete teinte-vert"><div><h2>Comment les clients paient</h2><p class="tres-petit muet">Équivalent euros · ${lib}</p></div></div>
          <div class="panneau-corps">${t.parMethode.length ? barresH(t.parMethode.map(x => ({ lib: LIB_METHODE[x.methode] || x.methode, v: x.eur })), { couleur: '#1F7A4D', format: (v) => eur(v) }) : '<p class="muet petit">Aucun encaissement sur la période.</p>'}</div>
        </section>

        <section class="panneau pleine">
          <div class="panneau-tete teinte-bleu"><div><h2>Agences</h2><p class="tres-petit muet">Activité sur ${lib} et situation actuelle</p></div></div>
          <div class="defile"><table class="tableau"><thead><tr><th>Agence</th><th class="n">Déposés</th><th class="n">Kilos</th><th class="n">CA transport</th><th class="n">Encaissé</th><th class="n">À retirer</th><th class="n">Garde longue</th><th class="n">Impayés</th></tr></thead><tbody>
            ${t.agences.map(a => `<tr><td><b>${esc(a.nom)}</b><div class="tres-petit muet">${esc(CONFIG.pays[a.pays]?.nom || a.pays)}</div></td>
              <td class="n chiffres">${nf(a.deposes)}</td><td class="n chiffres">${nf(a.kg)}</td><td class="n chiffres">${eur(a.caEur)}</td>
              <td class="n chiffres">${[a.encaisse.EUR ? eur(a.encaisse.EUR) : '', a.encaisse.GNF ? gnf(a.encaisse.GNF) : ''].filter(Boolean).join('<br>') || '<span class="muet">0</span>'}</td>
              <td class="n chiffres">${nf(a.aRetirer)}</td><td class="n chiffres">${a.gardeLongue ? `<span class="pastille-txt or">${nf(a.gardeLongue)}</span>` : '0'}</td>
              <td class="n chiffres">${a.impayes ? `<span class="pastille-txt rouge">${nf(a.impayes)} · ${gnf(a.impayesGnf)}</span>` : '0'}</td></tr>`).join('')}
          </tbody></table></div>
        </section>

        <section class="panneau large">
          <div class="panneau-tete teinte-or"><div><h2>Lignes et modes</h2><p class="tres-petit muet">Ce qui rapporte le plus sur ${lib}</p></div></div>
          <div class="defile"><table class="tableau"><thead><tr><th>Ligne</th><th>Mode</th><th class="n">Colis</th><th class="n">Kilos</th><th class="n">CA transport</th><th>Part du CA</th></tr></thead><tbody>
            ${t.lignes.length ? t.lignes.map(l => { const part = k.caEur ? (l.caEur / k.caEur) * 100 : 0; return `<tr><td><b>${esc(libSens(l.sens))}</b></td>
              <td><span class="mode-tag"><i style="background:${COULEUR_MODE[l.mode]}"></i>${LIB_MODE[l.mode]}</span></td>
              <td class="n chiffres">${nf(l.nb)}</td><td class="n chiffres">${nf(l.kg)}</td><td class="n chiffres">${eur(l.caEur)}</td>
              <td style="min-width:140px"><span class="part"><span style="width:${part}%;background:${COULEUR_MODE[l.mode]}"></span></span> <span class="tres-petit">${nf(part)} %</span></td></tr>`; }).join('')
              : '<tr><td colspan="6" class="vide">Aucun colis déposé sur la période.</td></tr>'}
          </tbody></table></div>
        </section>

        <section class="panneau">
          <div class="panneau-tete teinte-bleu"><div><h2>Lots en cours</h2></div><a class="btn btn-petit" href="#/lots">Tous les lots</a></div>
          <div class="panneau-corps pile" style="--gap:10px">
            ${t.lots.length ? t.lots.map(l => `<a class="lot-ligne" href="#/lots/${esc(l.code)}">
              <span class="pastille-mode" style="background:${COULEUR_MODE[l.mode]}">${K.icMode(l.mode, 'ic-sm')}</span>
              <span class="grandit"><b>${esc(l.code)}</b> <span class="tres-petit muet">${esc(libSens(l.sens))}${l.dateArriveePrevue ? ` · arrivée ${esc(date(l.dateArriveePrevue, false))}` : ''}</span>
                ${l.statut === 'preparation' ? `<span class="tres-petit muet" style="display:block">${nf(l.nb)} colis chargés</span>` : `<span class="part" style="display:block;margin-top:5px"><span style="width:${l.nb ? (l.recus / l.nb) * 100 : 0}%;background:#1F7A4D"></span></span><span class="tres-petit muet">${nf(l.recus)} / ${nf(l.nb)} réceptionnés</span>`}</span>
              ${badge(l.statut === 'preparation' ? 'reserve' : l.statut === 'parti' ? 'en_transit' : 'pret', LIB_STATUT_LOT[l.statut])}</a>`).join('') : '<p class="muet petit">Aucun lot en cours.</p>'}
          </div>
        </section>
        <section class="panneau">
          <div class="panneau-tete teinte-violet"><div><h2>Meilleurs clients</h2><p class="tres-petit muet">Expéditeurs sur ${lib}</p></div></div>
          <div class="defile"><table class="tableau"><thead><tr><th>Client</th><th class="n">Colis</th><th class="n">CA</th></tr></thead><tbody>
            ${t.clients.length ? t.clients.map((c, i) => `<tr><td><span class="rang">${i + 1}</span><b>${esc(c.nom || '')}</b><div class="tres-petit muet">${esc(c.telephone)}</div></td><td class="n chiffres">${nf(c.nb)}</td><td class="n chiffres">${eur(c.caEur)}</td></tr>`).join('') : '<tr><td colspan="3" class="vide">Aucun client sur la période.</td></tr>'}
          </tbody></table></div>
        </section>
        <section class="panneau">
          <div class="panneau-tete teinte-or"><div><h2>Ramassage et livraison</h2></div><a class="btn btn-petit" href="#/courses">Courses</a></div>
          <div class="panneau-corps mini-stats">
            <div><b>${nf(t.domicile.ouvertes)}</b><span>courses en cours</span></div>
            <div class="${t.domicile.sansLivreur ? 'alerte' : ''}"><b>${nf(t.domicile.sansLivreur)}</b><span>sans livreur</span></div>
            <div><b>${nf(t.domicile.faites)}</b><span>faites · ${lib}</span></div>
            <div><b>${eurC(t.domicile.encaisseEur)}</b><span>payées en ligne</span></div>
          </div>
        </section>

        <section class="panneau" id="bloques">
          <div class="panneau-tete teinte-rouge"><div><h2>Colis qui n'avancent plus</h2><p class="tres-petit muet">Même étape depuis trop longtemps pour leur mode</p></div><span class="badge b-annule">${nf(t.nbBloques)}</span></div>
          <div class="defile"><table class="tableau"><thead><tr><th>Colis</th><th>Étape</th><th class="n">Depuis</th></tr></thead><tbody>
            ${t.bloques.length ? t.bloques.map(b => `<tr class="cliquable" data-num="${esc(b.numeroSuivi)}"><td><b>${esc(b.numeroSuivi)}</b><div class="tres-petit muet">${esc(b.expediteur || '')}</div></td><td>${badge(b.statut)}<div class="tres-petit muet">${LIB_MODE[b.mode] || ''} · ${esc(nomLieu(b.lieu))}</div></td><td class="n"><span class="pastille-txt rouge">${nf(b.jours)} j</span></td></tr>`).join('') : '<tr><td colspan="3" class="vide">Aucun colis bloqué. Tout avance normalement.</td></tr>'}
          </tbody></table></div>
        </section>
      </div>`;
    main.insertAdjacentHTML('afterbegin', '<div data-notifs style="margin-bottom:16px;max-width:560px"></div>');
    K.notifications.carte(main.querySelector('[data-notifs]'), { texte: 'Nouvelle réclamation, paiement à vérifier : prévenu sur cet appareil.' });
    main.querySelectorAll('[data-jours]').forEach(b => b.addEventListener('click', () => { stock.ecrire('tdb_jours', Number(b.dataset.jours)); tableauDeBord(); }));
    main.querySelector('[data-nouveau-lot]').addEventListener('click', nouveauLot);
    main.querySelector('a[href="#bloques"]')?.addEventListener('click', (e) => { e.preventDefault(); main.querySelector('#bloques').scrollIntoView({ behavior: 'smooth' }); });
    main.querySelectorAll('tr[data-num]').forEach(tr => tr.addEventListener('click', () => { location.hash = `#/colis?q=${encodeURIComponent(tr.dataset.num)}`; }));
    brancherInfobulles(main);
  }

  function nouveauLot() {
    const { el, fermer } = modale(`
      <form class="pile" style="--gap:12px">
        <div class="ligne entre"><h2>Nouveau lot</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        <div class="grille-2">${CONFIG.sens.map((x, i) => `<label class="case" style="border:1px solid var(--ligne-2);border-radius:12px;padding:0 12px;background:#fff"><input type="radio" name="sens" value="${x.key}" ${i === 0 ? 'checked' : ''}> ${esc(x.label)}</label>`).join('')}</div>
        <div class="grille-3">${CONFIG.modes.map((m, i) => `<label class="case" style="border:1px solid var(--ligne-2);border-radius:12px;padding:0 12px;background:#fff"><input type="radio" name="mode" value="${m.key}" ${i === 0 ? 'checked' : ''}> ${esc(m.label)}</label>`).join('')}</div>
        <label class="champ">Référence (n° de vol, de conteneur, LTA…) <input class="saisie" name="reference"></label>
        <label class="champ">Transporteur <input class="saisie" name="transporteur"></label>
        <div class="grille-2">
          <label class="champ">Départ prévu <input class="saisie" type="date" name="dateDepartPrevue"></label>
          <label class="champ">Arrivée prévue <input class="saisie" type="date" name="dateArriveePrevue"></label>
        </div>
        <button class="btn btn-principal btn-grand">Créer le lot</button>
      </form>`);
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { const r = await api.post('/lots', f); fermer(); toast(`Lot ${r.lot.code} créé. Les agents du dépôt peuvent y charger des colis.`, 'ok'); location.hash = `#/lots/${r.lot.code}`; }
      catch (err) { toast(err.message, 'erreur'); }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  LOTS & MANIFESTES
  // ══════════════════════════════════════════════════════════
  async function lots(code) {
    const r = await api.get('/lots');
    const liste = r.lots;
    if (!code && liste.length) code = (liste.find(l => l.statut !== 'cloture') || liste[0]).code;
    main.innerHTML = `
      <div class="entete-page"><h1>Lots &amp; manifestes</h1><button class="btn btn-noir" data-nouveau-lot>${ic('plus', 'ic-sm')} Nouveau lot</button></div>
      <div class="puces" style="margin-bottom:16px">${liste.slice(0, 12).map(l => `<a class="puce" href="#/lots/${esc(l.code)}" ${l.code === code ? 'aria-current="page"' : ''}>${esc(l.code)} · ${esc(libSens(l.sens).replace(' → ', '→'))} · ${esc(LIB_STATUT_LOT[l.statut].toLowerCase())}</a>`).join('') || '<p class="muet">Aucun lot pour l\'instant.</p>'}</div>
      <div data-detail></div>`;
    main.querySelector('[data-nouveau-lot]').addEventListener('click', nouveauLot);
    if (code) await detailLot(code);
  }

  async function detailLot(code) {
    const zone = main.querySelector('[data-detail]');
    const { lot, manifeste, stats } = await api.get(`/lots/${code}`);
    const choisis = new Set();
    const actions = {
      preparation: { statut: 'parti', lib: 'Marquer le lot comme parti', msg: `Tous les colis chargés passeront « En route » et les clients recevront un SMS. Confirmer ?` },
      parti: { statut: 'arrive', lib: 'Marquer le lot comme arrivé', msg: 'Tous les colis passeront « Arrivé en Guinée ». Confirmer ?' },
      arrive: { statut: 'cloture', lib: 'Clôturer le lot', msg: 'Clôturer ce lot ?' },
    };
    const a = actions[lot.statut];
    zone.innerHTML = `
      <section class="panneau">
        <div class="panneau-tete" style="align-items:flex-end">
          <div>
            <h2 style="font-size:24px">Lot ${esc(lot.code)} · ${K.libMode(lot.mode)}</h2>
            <p class="petit muet" style="margin-top:4px">${[lot.reference, lot.transporteur].filter(Boolean).map(esc).join(' · ') || 'Sans référence'} ·
              ${stats.nb} colis · ${kg(stats.poids)}${lot.statut !== 'preparation' ? ` · reçus en Guinée : ${stats.scannesArrivee} / ${stats.nb}` : ''}
              ${lot.departLe ? ` · parti le ${esc(date(lot.departLe, false))}` : lot.dateDepartPrevue ? ` · départ prévu ${esc(date(lot.dateDepartPrevue, false))}` : ''}</p>
          </div>
          <div class="ligne" style="--gap:8px">
            <button class="btn btn-petit" data-imprimer-manifeste>${ic('imprimer', 'ic-sm')} Manifeste</button>
            ${lot.statut === 'parti' ? `<button class="btn btn-petit" data-annuler-depart>Annuler le départ</button>` : ''}
            ${a ? `<button class="btn btn-principal btn-petit" data-action-lot>${esc(a.lib)}</button>` : ''}
          </div>
        </div>
        ${lot.statut !== 'preparation' && stats.nb ? `<div style="padding:0 20px 14px"><div class="barre"><span style="width:${Math.round(stats.scannesArrivee / stats.nb * 100)}%"></span></div></div>` : ''}
        <div class="barre-masse cache" data-masse>
          <span class="gras grandit" data-nb-choisis></span>
          ${lot.statut === 'preparation' ? `<button class="btn btn-contour" data-retirer>Retirer du lot</button>` : `
          <button class="btn btn-ocre" data-masse-statut="pret">Passer à « Prêt au guichet »</button>
          ${lot.statut === 'parti' ? `<button class="btn btn-contour" data-masse-statut="arrive">Arrivé en Guinée</button>` : ''}`}
          <button class="btn btn-contour" data-etiquettes>Imprimer étiquettes</button>
        </div>
        <div class="defile"><table class="tableau">
          <thead><tr><th style="width:36px;padding-left:20px"><input type="checkbox" data-tout aria-label="Tout sélectionner"></th><th>N° de suivi</th><th>Destinataire</th><th>Téléphone</th><th>Guichet</th><th>Poids</th><th>Paiement</th><th>Statut</th></tr></thead>
          <tbody>${manifeste.length ? manifeste.map(c => `
            <tr data-num="${esc(c.numeroSuivi)}">
              <td style="padding-left:20px"><input type="checkbox" data-choix="${esc(c.numeroSuivi)}" aria-label="Sélectionner ${esc(c.numeroSuivi)}"></td>
              <td class="gras"><a href="#/colis?q=${esc(c.numeroSuivi)}">${esc(c.numeroSuivi)}</a></td>
              <td>${esc(c.destinataire.nom)}</td><td class="chiffres">${esc(c.destinataire.telephone)}</td>
              <td>${esc(nomLieu(c.guichet))}</td><td>${kg(c.poids)}</td>
              <td>${c.soldeGnf > 0 ? `<span style="color:var(--ocre-texte);font-weight:700">Reste ${gnf(c.soldeGnf)}</span>` : 'Payé'}</td>
              <td>${badge(c.statut)}</td>
            </tr>`).join('') : `<tr><td colspan="8" class="vide">Aucun colis. Les agents du dépôt chargent les colis en les scannant dans l'onglet « Chargement ».</td></tr>`}
          </tbody></table></div>
      </section>`;

    const majSelection = () => {
      zone.querySelector('[data-masse]').classList.toggle('cache', !choisis.size);
      zone.querySelector('[data-nb-choisis]').textContent = `${choisis.size} colis sélectionné(s)`;
      zone.querySelectorAll('tbody tr[data-num]').forEach(tr => tr.classList.toggle('selection', choisis.has(tr.dataset.num)));
    };
    zone.querySelectorAll('[data-choix]').forEach(cb => cb.addEventListener('change', () => { cb.checked ? choisis.add(cb.dataset.choix) : choisis.delete(cb.dataset.choix); majSelection(); }));
    zone.querySelector('[data-tout]')?.addEventListener('change', (e) => {
      zone.querySelectorAll('[data-choix]').forEach(cb => { cb.checked = e.target.checked; e.target.checked ? choisis.add(cb.dataset.choix) : choisis.delete(cb.dataset.choix); });
      majSelection();
    });
    zone.querySelector('[data-annuler-depart]')?.addEventListener('click', async () => {
      if (!confirm('Le lot a été marqué « parti » par erreur ? Ses colis redeviennent « chargés, en attente de départ ».')) return;
      try { const r = await api.post(`/lots/${lot.code}/statut`, { statut: 'preparation' }); toast(`Départ annulé · ${r.colisMisAJour} colis remis en attente.`, 'ok'); lots(lot.code); }
      catch (e) { toast(e.message, 'erreur'); }
    });
    zone.querySelector('[data-action-lot]')?.addEventListener('click', async () => {
      if (!confirm(a.msg)) return;
      try { const r = await api.post(`/lots/${lot.code}/statut`, { statut: a.statut }); toast(`Lot ${LIB_STATUT_LOT[r.lot.statut].toLowerCase()} · ${r.colisMisAJour} colis mis à jour.`, 'ok'); lots(lot.code); }
      catch (e) { toast(e.message, 'erreur'); }
    });
    zone.querySelectorAll('[data-masse-statut]').forEach(b => b.addEventListener('click', async () => {
      const statut = b.dataset.masseStatut;
      if (statut === 'pret' && !confirm(`${choisis.size} colis vont passer « Prêt au guichet » et les destinataires recevront leur code par SMS. Confirmer ?`)) return;
      try { const r = await api.post('/admin/colis/statut', { numeros: [...choisis], statut }); toast(`${r.nbOk} colis mis à jour.`, 'ok'); lots(lot.code); }
      catch (e) { toast(e.message, 'erreur'); }
    }));
    zone.querySelector('[data-retirer]')?.addEventListener('click', async () => {
      if (!confirm(`Retirer ${choisis.size} colis du lot ?`)) return;
      for (const n of choisis) { try { await api.del(`/lots/${lot.code}/colis/${n}`); } catch (e) { toast(`${n} : ${e.message}`, 'erreur'); } }
      lots(lot.code);
    });
    zone.querySelector('[data-etiquettes]').addEventListener('click', async () => {
      // une étiquette par colis sélectionné (on réutilise l'impression commune)
      const fiches = await Promise.all([...choisis].map(n => api.get(`/admin/colis/${n}`).then(r => r.colis)));
      const pages = [];
      for (const c of fiches) { await K.etiquette.imprimer(c, CONFIG, { sansImpression: true }); pages.push(document.querySelector('[data-etiquette]').innerHTML); }
      document.querySelector('[data-etiquette]').innerHTML = pages.join('');
      setTimeout(() => window.print(), 100);
    });
    zone.querySelector('[data-imprimer-manifeste]').addEventListener('click', () => imprimerManifeste(lot, manifeste, stats));
  }

  function imprimerManifeste(lot, manifeste, stats) {
    const w = window.open('', '_blank');
    if (!w) { toast('Autorisez les fenêtres pour imprimer.', 'erreur'); return; }
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Manifeste ${esc(lot.code)}</title>
      <style>body{font-family:system-ui,sans-serif;font-size:11pt;margin:15mm}h1{font-size:18pt;margin:0}table{width:100%;border-collapse:collapse;margin-top:10mm}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.pied{margin-top:12mm;display:flex;justify-content:space-between}</style></head><body>
      <h1>${esc(CONFIG.app)} · Manifeste du lot ${esc(lot.code)}</h1>
      <p>${esc(libSens(lot.sens))} · ${K.libMode(lot.mode).replace(/^./, x => x.toUpperCase())} · ${esc(lot.reference || '')} ${esc(lot.transporteur || '')} · ${stats.nb} colis · ${kg(stats.poids)} · imprimé le ${esc(date(new Date()))}</p>
      <table><thead><tr><th>#</th><th>N° de suivi</th><th>Expéditeur</th><th>Destinataire</th><th>Téléphone</th><th>Contenu</th><th>Cartons</th><th>Poids</th><th>Valeur (€)</th></tr></thead><tbody>
      ${manifeste.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.numeroSuivi)}</td><td>${esc(c.expediteur.nom)}</td><td>${esc(c.destinataire.nom)}</td><td>${esc(c.destinataire.telephone)}</td><td>${esc(c.description || c.typeColis)}</td><td>${c.nbCartons}</td><td>${kg(c.poids)}</td><td>${c.valeurDeclaree || ''}</td></tr>`).join('')}
      </tbody></table><div class="pied"><span>Signature dépôt :</span><span>Signature réception :</span></div>
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  // ══════════════════════════════════════════════════════════
  //  COLIS : recherche et fiche
  // ══════════════════════════════════════════════════════════
  async function colis() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const etat = { q: params.get('q') || '', statut: params.get('statut') || '', guichet: '', page: 1 };
    main.innerHTML = `
      <div class="entete-page"><h1>Colis</h1></div>
      <form class="ligne" style="--gap:8px;flex-wrap:wrap;margin-bottom:16px" data-filtres>
        <input class="saisie" style="flex:2;min-width:220px" name="q" placeholder="N° de suivi, téléphone ou nom" value="${esc(etat.q)}" aria-label="Rechercher">
        <select class="saisie" style="flex:1;min-width:160px" name="statut" aria-label="Statut"><option value="">Tous les statuts</option>${Object.entries(CONFIG.statuts).map(([k, v]) => `<option value="${k}" ${k === etat.statut ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <select class="saisie" style="flex:1;min-width:160px" name="guichet" aria-label="Agence de retrait"><option value="">Toutes les agences de retrait</option>${optionsAgences(null)}</select>
        <button class="btn btn-noir">${ic('loupe', 'ic-sm')} Chercher</button>
      </form>
      <section class="panneau"><div class="defile" data-resultats></div></section>`;
    const charger = async () => {
      const zone = main.querySelector('[data-resultats]');
      zone.innerHTML = '<div class="chargement"></div>';
      const qs = new URLSearchParams(Object.entries(etat).filter(([, v]) => v)).toString();
      const r = await api.get(`/admin/colis?${qs}`);
      zone.innerHTML = `<table class="tableau"><thead><tr><th>N° de suivi</th><th>Expéditeur</th><th>Destinataire</th><th>Guichet</th><th>Poids</th><th>Lot</th><th>Reste</th><th>Statut</th><th>Mis à jour</th></tr></thead><tbody>
        ${r.colis.length ? r.colis.map(c => `<tr class="cliquable" data-num="${esc(c.numeroSuivi)}"><td class="gras">${esc(c.numeroSuivi)}</td><td>${esc(c.expediteur.nom)}</td><td>${esc(c.destinataire.nom)}<div class="tres-petit muet">${esc(c.destinataire.telephone)}</div></td><td>${esc(nomLieu(c.guichet))}</td><td>${kg(c.poidsReel || c.poidsEstime)}</td><td>${esc(c.lotCode || 'Aucun')}</td><td>${c.solde.soldeGnf ? gnf(c.solde.soldeGnf) : 'Payé'}</td><td>${badge(c.statut)}</td><td class="tres-petit muet">${esc(date(c.updatedAt))}</td></tr>`).join('')
          : '<tr><td colspan="9" class="vide">Aucun colis trouvé.</td></tr>'}
      </tbody></table>
      <p class="petit muet" style="padding:12px 20px">${r.total} résultat(s)${r.total > 50 ? ' · 50 premiers affichés' : ''}</p>`;
      zone.querySelectorAll('[data-num]').forEach(tr => tr.addEventListener('click', () => ficheColis(tr.dataset.num, charger)));
      if (r.colis.length === 1 && etat.q) ficheColis(r.colis[0].numeroSuivi, charger);
    };
    main.querySelector('[data-filtres]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      Object.assign(etat, { q: f.get('q').trim(), statut: f.get('statut'), guichet: f.get('guichet') });
      charger().catch(err => toast(err.message, 'erreur'));
    });
    await charger();
  }

  async function ficheColis(numero, apres) {
    const { colis: c } = await api.get(`/admin/colis/${numero}`);
    const { el, fermer } = modale(`
      <div class="pile" style="--gap:14px">
        <div class="ligne entre"><div><h2>${esc(c.numeroSuivi)}</h2><div style="margin-top:4px">${badge(c.statut)}</div></div><button class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        ${['pret', 'en_livraison'].includes(c.statut) ? `<div class="carte-ocre ligne entre"><div><div class="tres-petit gras">Code de retrait</div><div class="titre" style="font-size:26px;letter-spacing:5px">${esc(c.codeRetrait || 'Masqué')}</div>${c.codeEssais ? `<div class="tres-petit">${c.codeEssais} essai(s) faux</div>` : ''}</div>${c.codeEssais >= 5 ? '<button class="btn btn-noir btn-petit" data-debloquer>Débloquer</button>' : ''}</div>` : ''}
        <div class="carte">
          <div class="ligne-info"><span>Expéditeur</span><span>${esc(c.expediteur.nom)} · ${esc(c.expediteur.telephone)}</span></div>
          <div class="ligne-info"><span>Destinataire</span><span>${esc(c.destinataire.nom)} · ${esc(c.destinataire.telephone)}</span></div>
          ${c.tiersAutorise?.nom ? `<div class="ligne-info"><span>Autorisé à retirer</span><span>${esc(c.tiersAutorise.nom)} · ${esc(c.tiersAutorise.telephone)}</span></div>` : ''}
          <div class="ligne-info"><span>Trajet</span><span>${esc(nomLieu(c.depot))} → ${esc(nomLieu(c.guichet))}</span></div>
          <div class="ligne-info"><span>Transport</span><span>${esc(libSens(c.sens))} · ${K.libMode(c.mode)} · ${c.lotCode ? `lot ${esc(c.lotCode)}` : 'pas encore de lot'}</span></div>
          <div class="ligne-info"><span>Poids</span><span>${c.poidsReel ? `${kg(c.poidsReel)} pesé` : 'pas encore pesé'}${c.poidsEstime ? ` · ${kg(c.poidsEstime)} annoncé` : ''} · ${c.nbCartons} carton(s)</span></div>
          <div class="ligne-info"><span>Prix transport</span><span>${eur(c.tarif?.totalEur)} · ${gnf(c.tarif?.totalGnf)} (taux ${gnf(c.tarif?.taux)})${c.tarif?.estime ? ' · estimé' : ''}</span></div>
          <div class="ligne-info"><span>Douane · garde</span><span>${gnf(c.fraisDouaneGnf)} · ${gnf(c.solde.magasinage.fraisGnf)}</span></div>
          <div class="ligne-info"><span>Payé</span><span>${gnf(c.solde.payeGnf)}${c.payeurArrivee ? ' · paie à l\'arrivée' : ''}</span></div>
          <div class="ligne-info"><span class="gras">Reste à payer</span><span class="gras">${gnf(c.solde.soldeGnf)}</span></div>
          ${['ramassage', 'livraison'].filter(k => c[k]?.demande).map(k => `<div class="ligne-info"><span>${k === 'ramassage' ? 'Ramassage' : 'Livraison'} à domicile</span><span>${esc(c[k].adresse?.quartier || '')}${c[k].prix ? ` · ${montant(c[k].prix, c[k].devise)}` : ' · prix à calculer'} · ${esc(LIB_COURSE[c[k].statut] || c[k].statut)}${c[k].livreurNom ? ` · ${esc(c[k].livreurNom)}` : ''}</span></div>`).join('')}
          ${c.remise?.le ? `<div class="ligne-info"><span>Remis</span><span>${esc(date(c.remise.le))} à ${esc(c.remise.nomRetrait || '')}${c.remise.aDomicile ? ' (à domicile)' : ''}</span></div>` : ''}
        </div>
        <div class="carte pile" style="--gap:8px">
          <div class="ligne-info"><span>Conditions</span><span>${c.cgv?.version ? `acceptées ${c.cgv.par === 'comptoir' ? 'au comptoir' : 'en ligne'} le ${esc(date(c.cgv.accepteesLe, false))} (version ${esc(c.cgv.version)})` : '<span class="rouge">non acceptées</span>'}</span></div>
          ${c.photoDepot ? `<div><div class="petit muet" style="margin-bottom:6px">Photo au dépôt</div><img data-photo-id="${esc(c.photoDepot)}" alt="Photo du colis au dépôt" style="max-width:260px;border-radius:10px;border:1px solid var(--ligne)"></div>` : '<div class="petit muet">Pas de photo au dépôt.</div>'}
          <div data-factures-colis class="pile" style="--gap:4px"></div>
        </div>
        ${c.remise?.signature ? `<img src="${esc(c.remise.signature)}" alt="Signature du retrait" style="max-width:260px;border:1px solid var(--ligne);border-radius:10px;background:#fff">` : ''}
        ${c.paiements.length ? `<div class="carte"><h3 style="margin-bottom:8px">Paiements</h3>${c.paiements.map(p => `<div class="ligne-info"><span>${esc(date(p.le))} · ${esc(CONFIG.methodesPaiement.find(m => m.key === p.methode)?.label || p.methode)} · ${esc(p.lieu === 'EN_LIGNE' ? 'en ligne' : nomLieu(p.lieu))}</span><span class="gras">${montant(p.montant, p.devise)}</span></div>`).join('')}</div>` : ''}
        ${!['remis', 'annule'].includes(c.statut) ? `
        <form class="carte pile" style="--gap:10px" data-modif>
          <h3>Corriger</h3>
          <div class="grille-2">
            <label class="champ">Destinataire <input class="saisie" name="destNom" value="${esc(c.destinataire.nom)}"></label>
            <label class="champ">Téléphone <input class="saisie" name="destTel" value="${esc(c.destinataire.telephone)}"></label>
            <label class="champ">Agence de retrait <select class="saisie" name="guichet">${optionsAgences(String(c.sens || 'FR-GN').split('-')[1], c.guichet)}</select></label>
            <label class="champ">Douane (GNF) <input class="saisie" name="douane" type="number" min="0" step="500" value="${c.fraisDouaneGnf || 0}"></label>
          </div>
          <label class="champ">Note interne <input class="saisie" name="notes" value="${esc(c.notesAdmin || '')}"></label>
          <button class="btn btn-noir">Enregistrer</button>
        </form>` : ''}
        <div class="ligne" style="--gap:8px;flex-wrap:wrap">
          <button class="btn" data-etiquette-colis>${ic('imprimer', 'ic-sm')} Imprimer l'étiquette</button>
          ${(() => { const d = [...c.historique].reverse().find(h => h.statut && !h.annule); return d?.retour ? `<button class="btn" data-annuler-etape>Annuler la dernière étape (${esc(d.label)})</button>` : ''; })()}
        </div>
        <div class="carte"><h3 style="margin-bottom:12px">Historique</h3><div class="frise">${[...c.historique].reverse().map(h => `
          <div class="etape ${h.annule ? 'annulee' : ''}"><div class="rail"><div class="point"></div><div class="trait"></div></div><div class="texte"><div class="gras">${esc(h.label)}${h.annule ? ' <span class="badge">annulée</span>' : ''}</div><div class="petit muet">${esc(date(h.le))}${h.detail ? ` · ${esc(h.detail)}` : ''}${h.agent?.prenom ? ` · ${esc(h.agent.prenom)}` : ''}</div></div></div>`).join('')}</div></div>
      </div>`);
    el.querySelector('[data-debloquer]')?.addEventListener('click', async () => {
      try { await api.post(`/admin/colis/${numero}/debloquer`); toast('Colis débloqué.', 'ok'); fermer(); ficheColis(numero, apres); } catch (e) { toast(e.message, 'erreur'); }
    });
    el.querySelector('[data-modif]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api.patch(`/admin/colis/${numero}`, { destinataire: { nom: f.get('destNom'), telephone: normTel(f.get('destTel')) }, guichet: f.get('guichet'), fraisDouaneGnf: f.get('douane'), notesAdmin: f.get('notes') });
        toast('Colis mis à jour.', 'ok'); fermer(); apres?.();
      } catch (err) { toast(err.message, 'erreur'); }
    });
    el.querySelector('[data-etiquette-colis]').addEventListener('click', () => K.etiquette.imprimer(c, CONFIG));
    el.querySelector('[data-annuler-etape]')?.addEventListener('click', async () => {
      const motif = prompt('Pourquoi annuler cette étape ? (noté dans l\'historique)');
      if (motif === null) return;
      try { const r = await api.post('/agent/annuler', { numero, motif }); toast(`Étape annulée : ${r.annulee}.`, 'ok'); fermer(); ficheColis(numero, apres); apres?.(); }
      catch (e) { toast(e.message, 'erreur'); }
    });
    el.querySelectorAll('[data-photo-id]').forEach(img => K.afficherPhoto(img, img.dataset.photoId));
    api.get(`/factures/colis/${numero}`).then(({ factures: fs }) => {
      const z = el.querySelector('[data-factures-colis]');
      z.innerHTML = fs.length ? `<div class="petit muet">Factures</div>${fs.map(ligneFacture).join('')}` : '<div class="petit muet">Aucune facture.</div>';
    }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════
  //  COURSES À DOMICILE
  // ══════════════════════════════════════════════════════════
  const LIB_COURSE = { a_planifier: 'Sans livreur', assignee: 'Livreur choisi', en_route: 'En route', faite: 'Faite', annulee: 'Annulée' };
  async function courses() {
    const filtre = stock.lire('filtre_courses') || '';
    const r = await api.get(`/admin/courses${filtre ? `?agence=${encodeURIComponent(filtre)}` : ''}`);
    const sansPos = r.courses.filter(c => !c.adresse?.position?.lat);
    const sansLivreur = r.courses.filter(c => !c.livreur);
    const optionsLivreurs = (c) => `<option value="">Aucun livreur</option>${r.livreurs.filter(l => l.lieu === c.agence).map(l => `<option value="${esc(l._id)}" ${String(l._id) === String(c.livreur) ? 'selected' : ''}>${esc(l.prenom)} ${esc(l.nom)}</option>`).join('')}`;
    const ligne = (c) => `
      <tr data-num="${esc(c.numeroSuivi)}" data-type="${c.type}">
        <td><span class="badge">${c.type === 'ramassage' ? 'Ramassage' : 'Livraison'}</span></td>
        <td><a href="#" data-fiche class="gras">${esc(c.numeroSuivi)}</a><div class="tres-petit muet">${esc(CONFIG.statuts[c.statutColis] || c.statutColis)}</div></td>
        <td>${esc(c.adresse?.nom || c.contact?.nom || '')}<div class="tres-petit muet">${esc(c.adresse?.telephone || c.contact?.telephone || '')}</div></td>
        <td>${esc([c.adresse?.quartier, c.adresse?.ville].filter(Boolean).join(', '))}<div class="tres-petit muet">${esc(c.adresse?.repere || '')}</div>
          ${c.adresse?.position?.lat ? `<a class="tres-petit" href="${esc(K.lienCarte(c.adresse.position))}" target="_blank" rel="noopener">carte</a>` : '<span class="tres-petit rouge">position manquante</span>'}</td>
        <td>${esc(nomLieu(c.agence))}<div class="tres-petit muet">${c.distanceKm ? `${esc(String(c.distanceKm).replace('.', ','))} km` : ''}</div></td>
        <td class="chiffres">${c.prix ? montant(c.prix, c.devise) : '<span class="muet">sans position</span>'}<div class="tres-petit ${c.payee ? 'vert' : 'rouge'}">${c.prix ? (c.payee ? 'payée' : 'pas encore payée') : ''}</div></td>
        <td>${c.statut === 'en_route' ? `<span class="gras">${esc(c.livreurNom || '')}</span><div class="tres-petit muet">en route</div>`
          : `<select class="saisie" style="min-height:40px;font-size:14px" data-livreur aria-label="Livreur">${optionsLivreurs(c)}</select>`}
          ${c.echecs?.length ? `<div class="tres-petit rouge">${c.echecs.length} échec(s) : ${esc(c.echecs.at(-1).motif)}</div>` : ''}</td>
        <td><button class="btn btn-petit" type="button" data-adresse>Adresse</button></td>
      </tr>`;
    main.innerHTML = `
      <div class="entete-page"><h1>Courses à domicile</h1>
        <label class="ligne" style="--gap:8px">Agence <select class="saisie" data-filtre style="width:auto"><option value="">Toutes</option>${optionsAgences(null, filtre)}</select></label></div>
      <div class="kpis">
        <div class="kpi"><div class="lib">Courses ouvertes</div><div class="val">${r.courses.length}</div></div>
        <div class="kpi ${sansLivreur.length ? 'ocre' : ''}"><div class="lib">Sans livreur</div><div class="val">${sansLivreur.length}</div></div>
        <div class="kpi ${sansPos.length ? 'ocre' : ''}"><div class="lib">Position manquante</div><div class="val">${sansPos.length}</div></div>
        <div class="kpi"><div class="lib">Livreurs actifs</div><div class="val">${r.livreurs.length}</div></div>
      </div>
      ${r.livreurs.length ? '' : '<p class="bandeau bandeau-ocre">Aucun livreur : ajoutez-en dans Équipe (rôle « Livreur »).</p>'}
      <section class="panneau"><div class="panneau-tete"><h2>À faire</h2><span class="petit muet">Les livreurs peuvent aussi prendre eux-mêmes les courses de leur agence.</span></div>
        <div class="defile"><table class="tableau">
          <thead><tr><th>Type</th><th>Colis</th><th>Client</th><th>Adresse</th><th>Agence</th><th>Prix</th><th>Livreur</th><th></th></tr></thead>
          <tbody>${r.courses.map(ligne).join('') || '<tr><td colspan="8" class="muet">Aucune course en cours.</td></tr>'}</tbody></table></div></section>
      <section class="panneau" style="margin-top:20px"><div class="panneau-tete"><h2>Faites ces 7 derniers jours</h2><span class="petit muet">Écart = distance entre le téléphone du livreur et l'adresse au moment où il valide</span></div>
        <div class="defile"><table class="tableau">
          <thead><tr><th>Quand</th><th>Type</th><th>Colis</th><th>Quartier</th><th>Livreur</th><th>Prix</th><th>Écart GPS</th></tr></thead>
          <tbody>${r.faites.map(c => `<tr>
            <td>${esc(date(c.faiteLe))}</td><td>${c.type === 'ramassage' ? 'Ramassage' : 'Livraison'}</td><td>${esc(c.numeroSuivi)}</td>
            <td>${esc(c.adresse?.quartier || '')}</td><td>${esc(c.livreurNom || '')}</td><td class="chiffres">${c.prix ? montant(c.prix, c.devise) : ''}</td>
            <td class="chiffres">${c.ecartM === undefined || c.ecartM === null ? '<span class="muet">pas de GPS</span>' : c.ecartM > 500 ? `<span class="alerte-ecart">${(c.ecartM / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km</span>` : `${c.ecartM} m`}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muet">Rien pour l\'instant.</td></tr>'}</tbody></table></div></section>`;
    main.querySelector('[data-filtre]').addEventListener('change', (e) => { stock.ecrire('filtre_courses', e.target.value); courses(); });
    main.querySelectorAll('tr[data-num]').forEach(tr => {
      const { num, type } = tr.dataset;
      const c = r.courses.find(x => x.numeroSuivi === num && x.type === type);
      tr.querySelector('[data-fiche]').addEventListener('click', (e) => { e.preventDefault(); ficheColis(num, courses); });
      tr.querySelector('[data-livreur]')?.addEventListener('change', async (e) => {
        const envoyer = (force) => api.post('/admin/courses/assigner', { numero: num, type, livreur: e.target.value || null, force });
        try { await envoyer(false); toast(e.target.value ? 'Livreur assigné.' : 'Course libérée.', 'ok'); }
        catch (err) {
          if (err.code === 'non_payee' && confirm(`${err.message} Envoyer quand même le livreur ? (Il encaissera chez le client.)`)) {
            try { await envoyer(true); toast('Livreur assigné.', 'ok'); return; } catch (e2) { toast(e2.message, 'erreur'); }
          } else if (err.code !== 'non_payee') toast(err.message, 'erreur');
          courses();
        }
      });
      tr.querySelector('[data-adresse]').addEventListener('click', () => modifierAdresse(c));
    });
  }

  function modifierAdresse(c) {
    const { el, fermer } = modale(`
      <form class="pile" style="--gap:12px" novalidate>
        <div class="ligne entre"><h2>${c.type === 'ramassage' ? 'Ramassage' : 'Livraison'} · ${esc(c.numeroSuivi)}</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        ${K.champsAdresse('a', c.adresse || {}, { maPosition: false })}
        <button class="btn btn-principal" type="submit">Enregistrer</button>
        <button class="btn btn-lien" type="button" data-annuler>Annuler la course (${c.type === 'ramassage' ? 'dépôt en agence' : 'retrait en agence'})</button>
      </form>`);
    const adr = K.brancherAdresse(el, 'a', { valeur: c.adresse || {}, agence: () => (CONFIG.agences || []).find(a => a.code === c.agence), config: CONFIG });
    const envoyer = async (corps) => {
      try { await api.post('/admin/courses/adresse', { numero: c.numeroSuivi, type: c.type, ...corps }); fermer(); toast('Course mise à jour.', 'ok'); courses(); }
      catch (err) { toast(err.message, 'erreur'); }
    };
    el.querySelector('[data-annuler]').addEventListener('click', () => { if (confirm('Annuler cette course ? Son prix est retiré du colis.')) envoyer({ demande: false }); });
    el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); envoyer({ demande: true, adresse: adr.lire() }); });
  }

  // ══════════════════════════════════════════════════════════
  //  FACTURES
  // ══════════════════════════════════════════════════════════
  const ligneFacture = (f) => `<a class="ligne-facture" href="${esc(K.lienFacture(f))}" target="_blank" rel="noopener">
    <span class="grandit"><span class="gras">${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${esc(f.numero)}</span> <span class="tres-petit muet">${esc(date(f.date, false))} · ${esc(f.client?.nom || '')}${f.etat ? ` · ${esc(K.ETATS_FACTURE[f.etat] || f.etat)}` : ''}</span></span>
    <span class="gras chiffres">${montant(f.type === 'avoir' ? -Math.abs(f.totalTTC) : f.totalTTC, f.devise)}</span></a>`;

  async function factures() {
    const auj = new Date();
    const debut = stock.lire('fact_debut') || new Date(auj.getFullYear(), auj.getMonth(), 1).toISOString().slice(0, 10);
    const fin = stock.lire('fact_fin') || auj.toISOString().slice(0, 10);
    const { factures: liste } = await api.get(`/factures?debut=${debut}&fin=${fin}`);
    const total = (dev, type) => liste.filter(f => f.devise === dev && f.type === type).reduce((s, f) => s + Math.abs(f.totalTTC), 0);
    main.innerHTML = `
      <div class="entete-page"><h1>Factures</h1>
        <form class="ligne" style="--gap:8px;flex-wrap:wrap" data-periode>
          <label class="ligne" style="--gap:6px">Du <input class="saisie" type="date" name="debut" value="${debut}" style="width:auto"></label>
          <label class="ligne" style="--gap:6px">au <input class="saisie" type="date" name="fin" value="${fin}" style="width:auto"></label>
          <button class="btn btn-petit">Afficher</button>
          <button class="btn btn-petit btn-noir" type="button" data-export>${ic('liste', 'ic-sm')} Export pour le comptable (CSV)</button>
        </form></div>
      <div class="kpis">
        <div class="kpi vert"><div class="lib">Facturé en euros</div><div class="val" style="font-size:24px">${eur(total('EUR', 'facture'))}</div><div class="sous">avoirs : ${eur(total('EUR', 'avoir'))}</div></div>
        <div class="kpi vert"><div class="lib">Facturé en GNF</div><div class="val" style="font-size:24px">${gnf(total('GNF', 'facture'))}</div><div class="sous">avoirs : ${gnf(total('GNF', 'avoir'))}</div></div>
        <div class="kpi"><div class="lib">Factures</div><div class="val">${liste.filter(f => f.type === 'facture').length}</div></div>
        <div class="kpi"><div class="lib">Avoirs</div><div class="val">${liste.filter(f => f.type === 'avoir').length}</div></div>
      </div>
      ${CONFIG.facturation?.capital ? '' : '<p class="bandeau bandeau-ocre">Le capital social n\'est pas renseigné : il doit figurer sur les factures d\'une SAS. Complétez-le dans Tarifs &amp; agences → Facturation.</p>'}
      <section class="panneau"><div class="defile"><table class="tableau">
        <thead><tr><th>Numéro</th><th>Date</th><th>Colis</th><th>Client</th><th>Agence</th><th class="n">HT</th><th class="n">TVA</th><th class="n">TTC</th><th></th></tr></thead>
        <tbody>${liste.map(f => `<tr>
          <td class="gras">${f.type === 'avoir' ? 'Avoir ' : ''}${esc(f.numero)}${f.factureOrigine ? `<div class="tres-petit muet">sur ${esc(f.factureOrigine)}</div>` : ''}</td>
          <td>${esc(date(f.date, false))}</td><td>${esc(f.numeroSuivi || '')}</td>
          <td>${esc(f.client?.nom || '')}<div class="tres-petit muet">${esc(f.client?.role || '')}</div></td><td>${esc(f.agence?.nom || '')}</td>
          <td class="chiffres n">${montant(f.totalHT, f.devise)}</td><td class="chiffres n">${montant(f.totalTVA, f.devise)}</td><td class="chiffres n gras">${montant(f.totalTTC, f.devise)}</td>
          <td><a class="btn btn-petit" href="${esc(K.lienFacture(f))}" target="_blank" rel="noopener">Ouvrir</a></td>
        </tr>`).join('') || '<tr><td colspan="9" class="muet">Aucune facture sur cette période.</td></tr>'}</tbody></table></div></section>`;
    main.querySelector('[data-periode]').addEventListener('submit', (e) => {
      e.preventDefault();
      stock.ecrire('fact_debut', e.target.debut.value); stock.ecrire('fact_fin', e.target.fin.value); factures();
    });
    main.querySelector('[data-export]').addEventListener('click', async () => {
      try {
        const r = await fetch(`${K.API_URL}/factures/export.csv?debut=${debut}&fin=${fin}`, { headers: { Authorization: `Bearer ${session.jeton()}` } });
        if (!r.ok) throw new Error('Export impossible.');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await r.blob()); a.download = `factures-TMS-${debut}-au-${fin}.csv`; a.click();
      } catch (e) { toast(e.message, 'erreur'); }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  RÉCLAMATIONS
  // ══════════════════════════════════════════════════════════
  const LIB_REC = { ouverte: 'Nouvelle', en_cours: 'En cours', acceptee: 'Acceptée', refusee: 'Refusée', close: 'Close' };
  let MOTIFS_REC = {};
  async function majPastilleRec() {
    try {
      const { reclamations: tout } = await api.get('/reclamations');
      const l = tout.filter(x => ['ouverte', 'en_cours'].includes(x.statut));
      document.querySelectorAll('[data-nb-rec], [data-nb-rec-mobile]').forEach(b => { b.textContent = l.length; b.classList.toggle('cache', !l.length); });
    } catch {}
  }

  async function reclamations() {
    const statut = stock.lire('filtre_rec') ?? 'actives';
    const r = await api.get(`/reclamations${statut && statut !== 'actives' ? `?statut=${statut}` : ''}`);
    MOTIFS_REC = Object.fromEntries((r.motifs || []).map(m => [m.key, m.label]));
    const liste = statut === 'actives' ? r.reclamations.filter(x => ['ouverte', 'en_cours'].includes(x.statut)) : r.reclamations;
    main.innerHTML = `
      <div class="entete-page"><h1>Réclamations</h1>
        <select class="saisie" data-filtre style="width:auto">
          <option value="actives" ${statut === 'actives' ? 'selected' : ''}>À traiter</option>
          <option value="" ${statut === '' ? 'selected' : ''}>Toutes</option>
          ${Object.entries(LIB_REC).map(([k, v]) => `<option value="${k}" ${statut === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
      <section class="panneau"><div class="defile"><table class="tableau">
        <thead><tr><th>Numéro</th><th>Reçue le</th><th>Colis</th><th>Client</th><th>Problème</th><th class="n">Demandé</th><th>Statut</th></tr></thead>
        <tbody>${liste.map(x => `<tr data-num="${esc(x.numero)}" style="cursor:pointer">
          <td class="gras">${esc(x.numero)}</td><td>${esc(date(x.createdAt))}</td><td>${esc(x.numeroSuivi)}</td>
          <td>${esc(x.demandeur?.nom || '')}<div class="tres-petit muet">${esc(x.demandeur?.role || '')} · ${esc(x.demandeur?.telephone || '')}</div></td>
          <td>${esc(MOTIFS_REC[x.motif] || x.motif)}${x.horsDelai ? '<div class="tres-petit rouge">hors délai</div>' : ''}${x.photos?.length ? `<div class="tres-petit muet">${x.photos.length} photo(s)</div>` : ''}</td>
          <td class="chiffres n">${x.montantDemande ? montant(x.montantDemande, x.deviseDemande || 'EUR') : ''}</td>
          <td><span class="badge b-${esc(x.statut)}">${esc(LIB_REC[x.statut])}</span></td>
        </tr>`).join('') || '<tr><td colspan="7" class="muet">Aucune réclamation.</td></tr>'}</tbody></table></div></section>`;
    main.querySelector('[data-filtre]').addEventListener('change', (e) => { stock.ecrire('filtre_rec', e.target.value); reclamations(); });
    main.querySelectorAll('tr[data-num]').forEach(tr => tr.addEventListener('click', () => { location.hash = `#/reclamations/${tr.dataset.num}`; }));
    majPastilleRec();
  }

  async function reclamation(numero) {
    const { reclamation: r, colis: c, factures: fs, plafond } = await api.get(`/reclamations/${numero}`);
    if (!Object.keys(MOTIFS_REC).length) MOTIFS_REC = Object.fromEntries(((await api.get('/reclamations?statut=x')).motifs || []).map(m => [m.key, m.label]));
    const ouverte = ['ouverte', 'en_cours'].includes(r.statut);
    const d = r.decision || {};
    const deviseColis = c?.tarif?.devise || 'EUR';
    main.innerHTML = `
      <div class="entete-page"><div class="ligne" style="--gap:12px"><a class="btn btn-rond" href="#/reclamations" aria-label="Retour">${ic('retour')}</a>
        <div><h1>Réclamation ${esc(r.numero)}</h1><div class="petit muet">Reçue le ${esc(date(r.createdAt))} · <span class="badge b-${esc(r.statut)}">${esc(LIB_REC[r.statut])}</span></div></div></div>
        ${c ? `<button class="btn btn-petit" data-fiche>Fiche du colis ${esc(c.numeroSuivi)}</button>` : ''}</div>
      <div class="deux-col">
        <div class="pile" style="--gap:16px">
          <section class="panneau"><div class="panneau-tete"><h2>${esc(MOTIFS_REC[r.motif] || r.motif)}</h2>${r.horsDelai ? '<span class="badge b-refusee">Hors délai</span>' : ''}</div>
            <div class="panneau-corps pile" style="--gap:10px">
              <p style="white-space:pre-wrap">${esc(r.description || '')}</p>
              <div class="ligne-info"><span>Client</span><span>${esc(r.demandeur?.nom || '')} (${esc(r.demandeur?.role || '')}) · ${esc(r.demandeur?.telephone || '')}</span></div>
              <div class="ligne-info"><span>Montant demandé</span><span>${r.montantDemande ? montant(r.montantDemande, r.deviseDemande || 'EUR') : 'Aucun'}</span></div>
              ${plafond ? `<div class="ligne-info"><span>Plafond selon les CGV</span><span class="gras">${eur(plafond.montantEur)} <span class="tres-petit muet">(${esc(plafond.base || '')})</span></span></div>` : ''}
              ${r.photos?.length ? `<div><div class="petit muet" style="margin-bottom:6px">Photos du client</div><div class="vignettes">${r.photos.map(id => `<a href="#" data-zoom><img data-photo-id="${esc(id)}" alt="Photo du client"></a>`).join('')}</div></div>` : ''}
              ${c?.photoDepot ? `<div><div class="petit muet" style="margin-bottom:6px">Photo prise au dépôt</div><div class="vignettes"><a href="#" data-zoom><img data-photo-id="${esc(c.photoDepot)}" alt="Photo au dépôt"></a></div></div>` : '<p class="petit muet">Pas de photo au dépôt pour ce colis.</p>'}
            </div></section>
          ${c ? `<section class="panneau"><div class="panneau-tete"><h2>Colis</h2>${badge(c.statut)}</div><div class="panneau-corps">
            <div class="ligne-info"><span>Trajet</span><span>${esc(nomLieu(c.depot))} → ${esc(nomLieu(c.guichet))}</span></div>
            <div class="ligne-info"><span>Poids · cartons</span><span>${kg(c.poidsReel || c.poidsEstime)} · ${c.nbCartons}</span></div>
            <div class="ligne-info"><span>Contenu</span><span>${esc(c.description || 'Non précisé')}</span></div>
            <div class="ligne-info"><span>Assurance</span><span>${c.assurance ? `oui, valeur ${esc(c.valeurDeclaree)}` : 'non'}</span></div>
            <div class="ligne-info"><span>Remis</span><span>${c.remise?.le ? `${esc(date(c.remise.le))} à ${esc(c.remise.nomRetrait || '')}` : 'non'}</span></div>
            <div class="pile" style="--gap:2px;margin-top:8px">${fs.map(ligneFacture).join('') || '<span class="petit muet">Aucune facture.</span>'}</div>
          </div></section>` : ''}
        </div>
        <div class="pile" style="--gap:16px">
          <section class="panneau"><div class="panneau-tete"><h2>Échanges</h2><span class="tres-petit muet">Les notes internes ne sont pas visibles du client</span></div>
            <div class="panneau-corps pile" style="--gap:8px">
              ${r.suivi.map(s => `<div class="message-rec ${s.interne ? 'interne' : s.auteur}"><div class="tres-petit muet">${s.auteur === 'tms' ? `TMS${s.nom ? ` · ${esc(s.nom)}` : ''}` : 'Client'}${s.interne ? ' · note interne' : ''} · ${esc(date(s.le))}</div><div style="white-space:pre-wrap">${esc(s.texte)}</div></div>`).join('')}
              ${ouverte || r.statut !== 'close' ? `
              <form class="pile" style="--gap:8px" data-message>
                <textarea class="saisie" name="texte" rows="3" placeholder="Répondre au client, ou note interne"></textarea>
                <div class="ligne entre"><label class="case" style="min-height:36px"><input type="checkbox" name="interne"> Note interne</label><button class="btn btn-noir btn-petit">Envoyer</button></div>
              </form>` : ''}
            </div></section>
          ${ouverte ? `
          <form class="panneau" data-decision><div class="panneau-tete"><h2>Décision</h2></div>
            <div class="panneau-corps pile" style="--gap:10px">
              <div class="segments" role="group" aria-label="Décision">
                <button type="button" data-dec="avoir" aria-pressed="true">Rembourser (avoir)</button>
                <button type="button" data-dec="indemnisation" aria-pressed="false">Indemniser</button>
                <button type="button" data-dec="refus" aria-pressed="false">Refuser</button>
              </div>
              <p class="tres-petit muet" data-aide-dec></p>
              <div class="formulaire-grille" data-montant-dec>
                <label class="champ">Montant <input class="saisie" name="montant" type="number" inputmode="decimal" min="0" step="0.01"></label>
                <label class="champ">Devise <select class="saisie" name="devise"><option value="EUR" ${deviseColis === 'EUR' ? 'selected' : ''}>€</option><option value="GNF" ${deviseColis === 'GNF' ? 'selected' : ''}>GNF</option></select></label>
                <label class="champ">Versé par <select class="saisie" name="methode"><option value="">Pas encore versé</option>${CONFIG.methodesPaiement.map(m => `<option value="${m.key}">${esc(m.label)}</option>`).join('')}</select></label>
                <label class="champ">Référence <input class="saisie" name="reference" placeholder="N° de virement, Orange Money…"></label>
              </div>
              <label class="champ">Explication pour le client <textarea class="saisie" name="motif" rows="2" required></textarea></label>
              <button class="btn btn-principal">Enregistrer la décision</button>
            </div></form>` : d.type ? `
          <section class="panneau"><div class="panneau-tete"><h2>Décision</h2></div><div class="panneau-corps pile" style="--gap:6px">
            <div class="gras">${d.type === 'refus' ? 'Refusée' : `${d.type === 'avoir' ? 'Remboursement par avoir' : 'Indemnisation'} : ${montant(d.montant, d.devise)}`}</div>
            ${d.avoir ? `<div class="petit">Avoir ${esc(d.avoir)}</div>` : ''}
            ${d.versement?.methode ? `<div class="petit muet">Versé par ${esc(CONFIG.methodesPaiement.find(m => m.key === d.versement.methode)?.label || d.versement.methode)}${d.versement.reference ? ` · ${esc(d.versement.reference)}` : ''}</div>` : ''}
            <div class="petit">${esc(d.motif || '')}</div>
            ${r.statut !== 'close' ? '<button class="btn btn-petit" data-clore>Clore la réclamation</button>' : ''}
          </div></section>` : ''}
        </div>
      </div>`;
    main.querySelectorAll('[data-photo-id]').forEach(img => K.afficherPhoto(img, img.dataset.photoId));
    main.querySelectorAll('[data-zoom]').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault(); const src = a.querySelector('img').src; if (src) modale(`<div class="pile"><div class="ligne entre"><h2>Photo</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div><img src="${src}" alt="Photo" style="max-width:100%;border-radius:10px"></div>`);
    }));
    main.querySelector('[data-fiche]')?.addEventListener('click', () => ficheColis(c.numeroSuivi));
    main.querySelector('[data-message]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = e.target.texte.value.trim(); if (!t) return;
      try { await api.post(`/reclamations/${numero}/message`, { texte: t, interne: e.target.interne.checked }); reclamation(numero); } catch (err) { toast(err.message, 'erreur'); }
    });
    main.querySelector('[data-clore]')?.addEventListener('click', async () => {
      try { await api.post(`/reclamations/${numero}/clore`); toast('Réclamation close.', 'ok'); reclamation(numero); } catch (err) { toast(err.message, 'erreur'); }
    });
    const form = main.querySelector('[data-decision]');
    if (form) {
      let dec = 'avoir';
      const AIDES = {
        avoir: 'Rembourse tout ou partie du prix payé : un avoir est émis sur la facture du colis, dans sa devise.',
        indemnisation: 'Dédommage la marchandise perdue ou abîmée (dans la limite du plafond des CGV, sauf geste commercial).',
        refus: 'Le client reçoit votre explication.',
      };
      const maj = () => {
        form.querySelectorAll('[data-dec]').forEach(b => b.setAttribute('aria-pressed', b.dataset.dec === dec));
        form.querySelector('[data-montant-dec]').classList.toggle('cache', dec === 'refus');
        form.querySelector('[data-aide-dec]').textContent = AIDES[dec];
        form.devise.disabled = dec === 'avoir';
      };
      form.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => { dec = b.dataset.dec; maj(); }));
      maj();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const corps = { decision: dec, motif: form.motif.value.trim(), montant: form.montant.value, devise: form.devise.value, methode: form.methode.value || undefined, reference: form.reference.value.trim() || undefined };
        if (corps.motif.length < 3) { toast('Expliquez la décision au client.', 'erreur'); return; }
        if (dec !== 'refus' && !(parseFloat(corps.montant) > 0)) { toast('Indiquez le montant.', 'erreur'); return; }
        if (!confirm(dec === 'refus' ? 'Refuser cette réclamation ?' : `Confirmer : ${dec === 'avoir' ? 'avoir' : 'indemnisation'} de ${corps.montant} ?`)) return;
        try { await api.post(`/reclamations/${numero}/decision`, corps); toast('Décision enregistrée. Le client est prévenu.', 'ok'); reclamation(numero); majPastilleRec(); }
        catch (err) { toast(err.message, 'erreur'); }
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  //  CAISSES
  // ══════════════════════════════════════════════════════════
  async function caisses() {
    const jour = new Date().toISOString().slice(0, 10);
    main.innerHTML = `
      <div class="entete-page"><h1>Caisses</h1><label class="ligne" style="--gap:8px">Jour <input class="saisie" type="date" data-jour value="${jour}" style="width:auto"></label></div>
      <div data-declarations></div>
      <div data-caisses></div>`;
    // Paiements Orange Money / MTN MoMo déclarés par les clients : à vérifier sur le compte marchand
    const chargerDeclarations = async () => {
      const zone = main.querySelector('[data-declarations]');
      const { declarations } = await api.get('/paiements/declarations');
      zone.innerHTML = declarations.length ? `
        <section class="panneau" style="margin-bottom:20px"><div class="panneau-tete"><div><h2>Paiements mobile money à vérifier</h2><p class="petit muet" style="margin-top:4px">Vérifiez sur le compte marchand que l'argent est bien arrivé avec cette référence, puis validez.</p></div><span class="badge b-arrive">${declarations.length}</span></div>
          <div class="defile"><table class="tableau">
            <thead><tr><th>Reçu le</th><th>Colis</th><th>Pour</th><th>Moyen</th><th>Référence</th><th>Payé depuis</th><th class="chiffres">Montant</th><th></th></tr></thead>
            <tbody>${declarations.map(d => `<tr data-id="${esc(d.id)}">
              <td>${esc(date(d.le))}</td><td><a href="#/colis?q=${esc(d.numeroSuivi)}" class="gras">${esc(d.numeroSuivi)}</a><div class="tres-petit muet">${esc(d.expediteur || '')}</div></td>
              <td>${d.objet === 'domicile' ? 'Livraison / ramassage' : 'Solde du colis'}</td><td>${esc(d.methodeLabel)}</td>
              <td class="gras">${esc(d.reference)}</td><td>${esc(d.telephone || 'Non indiqué')}</td><td class="chiffres gras">${gnf(d.montantGnf)}</td>
              <td><div class="ligne" style="--gap:6px"><button class="btn btn-petit btn-principal" data-valider>Reçu</button><button class="btn btn-petit" data-refuser>Pas reçu</button></div></td>
            </tr>`).join('')}</tbody></table></div></section>` : '';
      zone.querySelectorAll('tr[data-id]').forEach(tr => {
        const traiter = async (decision) => {
          let motif = '';
          if (decision === 'refuser') { motif = prompt('Motif (envoyé au client par SMS) :', 'Paiement introuvable avec cette référence.'); if (motif === null) return; }
          try { await api.post(`/paiements/declarations/${tr.dataset.id}`, { decision, motif }); toast(decision === 'valider' ? 'Paiement enregistré, le client est prévenu.' : 'Client prévenu.', 'ok'); chargerDeclarations(); }
          catch (err) { toast(err.message, 'erreur'); }
        };
        tr.querySelector('[data-valider]').addEventListener('click', () => traiter('valider'));
        tr.querySelector('[data-refuser]').addEventListener('click', () => traiter('refuser'));
      });
    };
    chargerDeclarations().catch(err => toast(err.message, 'erreur'));
    const charger = async (d) => {
      const r = await api.get(`/caisse/jour?date=${d}`);
      const methodes = Object.fromEntries(CONFIG.methodesPaiement.map(m => [m.key, m.label]));
      const totaux = (t) => Object.entries(t).map(([dev, parM]) => Object.entries(parM).map(([m, v]) => `${esc(methodes[m] || m)} ${montant(v, dev)}`).join(' · ')).join(' · ') || 'Rien';
      const somme = (t, dev) => Object.values(t[dev] || {}).reduce((a, b) => a + b, 0);
      main.querySelector('[data-caisses]').innerHTML = `
        <div class="kpis">
          <div class="kpi vert"><div class="lib">Encaissé en GNF</div><div class="val" style="font-size:24px">${gnf(somme(r.encaisseJour, 'GNF'))}</div></div>
          <div class="kpi vert"><div class="lib">Encaissé en euros</div><div class="val" style="font-size:24px">${eur(somme(r.encaisseJour, 'EUR'))}</div></div>
        </div>
        <div class="deux-col" style="grid-template-columns:1fr 1fr">
          <section class="panneau"><div class="panneau-tete"><h2>Caisses ouvertes</h2></div><div class="panneau-corps pile" style="--gap:10px">
            ${r.caissesOuvertes.length ? r.caissesOuvertes.map(c => `
              <div class="pile" style="--gap:4px;padding-bottom:10px;border-bottom:1px solid var(--creme-2)">
                <div class="ligne entre"><span class="gras">${esc(nomLieu(c.lieu))} · ${esc(c.agent?.prenom || '')} ${esc(c.agent?.nom?.[0] || '')}.</span>${c.enRetard ? '<span class="badge b-erreur">Non clôturée</span>' : ''}</div>
                <div class="petit muet">${totaux(c.totaux)}</div>
                <div class="tres-petit muet">${c.nb} encaissement(s) depuis ${esc(date(c.plusAncien))}</div>
              </div>`).join('') : '<p class="muet petit">Toutes les caisses sont clôturées.</p>'}
          </div></section>
          <section class="panneau"><div class="panneau-tete"><h2>Clôtures du jour</h2></div><div class="panneau-corps pile" style="--gap:10px">
            ${r.clotures.length ? r.clotures.map(c => {
              const ecarts = Object.entries(c.ecart || {}).filter(([, v]) => v);
              return `<div class="pile" style="--gap:4px;padding-bottom:10px;border-bottom:1px solid var(--creme-2)">
                <div class="ligne entre"><span class="gras">${esc(nomLieu(c.lieu))} · ${esc(c.agent?.prenom || '')}</span><span class="tres-petit muet">${esc(heure(c.createdAt))}</span></div>
                <div class="petit muet">${totaux(c.totaux)}</div>
                ${ecarts.length ? `<div class="petit" style="color:var(--rouge);font-weight:700">Écart espèces : ${ecarts.map(([d, v]) => montant(v, d)).join(', ')}</div>` : '<div class="petit" style="color:var(--vert)">Aucun écart</div>'}
                ${c.commentaire ? `<div class="tres-petit muet">« ${esc(c.commentaire)} »</div>` : ''}
              </div>`;
            }).join('') : '<p class="muet petit">Aucune clôture ce jour-là.</p>'}
          </div></section>
        </div>`;
    };
    main.querySelector('[data-jour]').addEventListener('change', (e) => charger(e.target.value).catch(err => toast(err.message, 'erreur')));
    await charger(jour);
  }

  // ══════════════════════════════════════════════════════════
  //  TARIFS, TAUX, GUICHETS
  // ══════════════════════════════════════════════════════════
  async function reglages() {
    const { config: c } = await api.get('/config/admin');
    const agenceHtml = (a) => `
      <div class="carte formulaire-grille" data-agence style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label class="champ">Pays <select class="saisie" name="pays">${Object.values(CONFIG.pays).map(p => `<option value="${p.code}" ${p.code === a.pays ? 'selected' : ''}>${esc(p.nom)}</option>`).join('')}</select></label>
        <label class="champ">Code <input class="saisie" name="code" value="${esc(a.code || '')}" placeholder="LABE" style="text-transform:uppercase"></label>
        <label class="champ">Nom <input class="saisie" name="nom" value="${esc(a.nom || '')}" placeholder="Agence Labé"></label>
        <label class="champ">Ville <input class="saisie" name="ville" value="${esc(a.ville || '')}"></label>
        <label class="champ">Commune / quartier <input class="saisie" name="commune" value="${esc(a.commune || '')}"></label>
        <label class="champ">Adresse <input class="saisie" name="adresse" value="${esc(a.adresse || '')}"></label>
        <label class="champ">Téléphone / WhatsApp <input class="saisie" name="telephone" value="${esc(a.telephone || '')}"></label>
        <label class="champ">Horaires <input class="saisie" name="horaires" value="${esc(a.horaires || '')}" placeholder="Lun–sam 9 h – 18 h"></label>
        <div class="champ" style="grid-column:1/-1">Position GPS de l'agence
          <span class="petit" data-etat-pos>${a.position?.lat ? `<span class="vert">${ic('ok', 'ic-sm')} ${a.position.lat.toFixed(5)}, ${a.position.lng.toFixed(5)}</span>` : '<span class="rouge">Non renseignée : pas de ramassage ni de livraison depuis cette agence</span>'}</span>
          <span class="ligne" style="--gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-petit" data-placer>${ic('lieu', 'ic-sm')} Placer sur la carte</button>
            <button type="button" class="btn btn-petit" data-ici>${ic('gps', 'ic-sm')} Je suis à l'agence</button>
            <input class="saisie" name="lienPosition" placeholder="ou coller un lien Google Maps" autocomplete="off" style="flex:1;min-width:200px;min-height:40px">
          </span>
          <input type="hidden" name="positionLat" value="${a.position?.lat ?? ''}"><input type="hidden" name="positionLng" value="${a.position?.lng ?? ''}"></div>
        <label class="case"><input type="checkbox" name="plateforme" ${a.plateforme ? 'checked' : ''}> Plateforme d'arrivée des lots</label>
        <label class="case"><input type="checkbox" name="actif" ${a.actif !== false ? 'checked' : ''}> Ouverte</label>
      </div>`;
    const blocTarif = (x) => {
      const t = c.tarifs?.[x.key] || { devise: 'EUR', air: {}, mer: {} };
      return `
      <section class="panneau"><div class="panneau-tete"><h2>${esc(x.label)}</h2>
        <label class="ligne" style="--gap:8px">Devise <select class="saisie" name="${x.key}_devise" style="width:auto"><option value="EUR" ${t.devise === 'EUR' ? 'selected' : ''}>€</option><option value="GNF" ${t.devise === 'GNF' ? 'selected' : ''}>GNF</option></select></label></div>
        <div class="panneau-corps formulaire-grille">
          <label class="champ">Express (2-3 j) : prix par kg <input class="saisie" name="${x.key}_express_prixKg" type="number" step="0.01" min="0" value="${t.express?.prixKg ?? ''}"></label>
          <label class="champ">Express : poids minimum (kg) <input class="saisie" name="${x.key}_express_poidsMin" type="number" step="0.1" min="0" value="${t.express?.poidsMin ?? ''}"></label>
          <label class="champ">Avion : prix par kg <input class="saisie" name="${x.key}_air_prixKg" type="number" step="0.01" min="0" value="${t.air?.prixKg ?? ''}"></label>
          <label class="champ">Avion : poids minimum (kg) <input class="saisie" name="${x.key}_air_poidsMin" type="number" step="0.1" min="0" value="${t.air?.poidsMin ?? ''}"></label>
          <label class="champ">Bateau : prix par kg <input class="saisie" name="${x.key}_mer_prixKg" type="number" step="0.01" min="0" value="${t.mer?.prixKg ?? ''}"></label>
          <label class="champ">Bateau : poids minimum (kg) <input class="saisie" name="${x.key}_mer_poidsMin" type="number" step="0.1" min="0" value="${t.mer?.poidsMin ?? ''}"></label>
        </div></section>`;
    };
    const symbole = (sensKey) => ((c.tarifs?.[sensKey]?.devise || 'EUR') === 'EUR' ? '€' : 'GNF');
    const articleHtml = (a) => `
      <div class="carte formulaire-grille" data-article data-cle="${esc(a.cle || '')}" style="grid-template-columns:repeat(auto-fill,minmax(105px,1fr))">
        <label class="champ" style="grid-column:span 2">Article <input class="saisie" name="art_label" value="${esc(a.label || '')}" placeholder="ex. Paire de chaussures"></label>
        <label class="champ">Compte (kg) <input class="saisie" name="art_poids" type="number" min="0" step="0.1" value="${a.poids ?? ''}"></label>
        ${CONFIG.sens.map(x => ['air', 'mer'].map(m => `<label class="champ" title="${esc(x.label)}">${esc(x.depart)} → ${esc(x.arrivee)} ${m === 'air' ? 'avion' : 'bateau'} (${symbole(x.key)}) <input class="saisie" name="art_${x.key}_${m}" type="number" min="0" step="${symbole(x.key) === '€' ? '0.5' : '1000'}" value="${a.prix?.[x.key]?.[m] ?? ''}" placeholder="non proposé"></label>`).join('')).join('')}
        <div class="ligne entre" style="grid-column:1/-1">
          <label class="case"><input type="checkbox" name="art_actif" ${a.actif !== false ? 'checked' : ''}> Proposé aux clients</label>
          <button type="button" class="btn btn-petit" data-suppr-article>${ic('fermer', 'ic-sm')} Retirer</button>
        </div>
      </div>`;
    main.innerHTML = `
      <div class="entete-page"><h1>Tarifs &amp; agences</h1></div>
      <form class="pile" style="--gap:20px;max-width:1040px" data-reglages>
        <section class="panneau"><div class="panneau-tete"><h2>Taux de change</h2><span class="petit muet">Figé sur chaque colis au moment de la pesée</span></div>
          <div class="panneau-corps formulaire-grille">
            <label class="champ">1 € = … GNF <input class="saisie saisie-forte" name="tauxEurGnf" type="number" min="1" step="1" value="${c.tauxEurGnf}"></label>
            <p class="petit muet" style="align-self:end">Dernière mise à jour : ${esc(date(c.tauxMisAJourLe))}</p>
          </div></section>
        ${CONFIG.sens.map(blocTarif).join('')}
        <section class="panneau"><div class="panneau-tete"><div><h2>Articles à la pièce</h2><p class="petit muet" style="margin-top:4px">Prix fixe par article (chaussures, téléphone…) au lieu du prix au kilo. « Compte » : kilos retirés de la pesée pour chaque article, le surplus est payé au kilo. Laissez un prix vide pour ne pas proposer l'article dans ce sens ou ce mode. En express, le prix avion s'applique.</p></div><button type="button" class="btn btn-petit" data-ajout-article>${ic('plus', 'ic-sm')} Ajouter un article</button></div>
          <div class="panneau-corps pile" data-liste-articles>${(c.articles || []).map(articleHtml).join('')}</div></section>
        <section class="panneau"><div class="panneau-tete"><h2>Suppléments et assurance</h2></div>
          <div class="panneau-corps formulaire-grille">
            ${CONFIG.typesColis.map(t => `<label class="champ">Supplément ${esc(t.label.toLowerCase())} (%) <input class="saisie" name="sur_${t.key}" type="number" step="1" min="0" value="${Math.round((c.surcharges?.[t.key] || 0) * 100)}"></label>`).join('')}
            <label class="champ">Assurance (% de la valeur) <input class="saisie" name="tauxAssurance" type="number" step="0.1" min="0" value="${(c.tauxAssurance * 100).toFixed(1)}"></label>
          </div></section>
        <section class="panneau"><div class="panneau-tete"><h2>Garde en agence de retrait</h2></div>
          <div class="panneau-corps formulaire-grille">
            <label class="champ">Jours gratuits <input class="saisie" name="joursGratuits" type="number" min="0" value="${c.magasinage.joursGratuits}"></label>
            <label class="champ">Ensuite, par jour en Guinée (GNF) <input class="saisie" name="fraisJourGnf" type="number" min="0" step="500" value="${c.magasinage.fraisJourGnf}"></label>
            <label class="champ">Ensuite, par jour en France (€) <input class="saisie" name="fraisJourEur" type="number" min="0" step="0.5" value="${c.magasinage.fraisJourEur ?? 0}"></label>
          </div></section>
        <section class="panneau"><div class="panneau-tete"><div><h2>Facturation</h2><p class="petit muet" style="margin-top:4px">Ces informations s'impriment sur chaque facture. Le régime de TVA est à faire valider par votre expert-comptable.</p></div></div>
          <div class="panneau-corps formulaire-grille">
            <label class="champ">Capital social (obligatoire pour une SAS) <input class="saisie" name="fac_capital" value="${esc(c.facturation?.capital || '')}" placeholder="ex. 1 000 €"></label>
            <label class="champ">E-mail de contact <input class="saisie" name="fac_email" type="email" value="${esc(c.facturation?.email || '')}"></label>
            <label class="champ">Téléphone <input class="saisie" name="fac_telephone" value="${esc(c.facturation?.telephone || '')}"></label>
            <label class="champ">Site web <input class="saisie" name="fac_site" value="${esc(c.facturation?.site || '')}"></label>
            <label class="champ">Médiateur de la consommation <input class="saisie" name="fac_mediateur" value="${esc(c.facturation?.mediateur || '')}" placeholder="Nom et site du médiateur"></label>
            <label class="champ" style="grid-column:1/-1">Conditions de paiement <input class="saisie" name="fac_conditions" value="${esc(c.facturation?.conditionsPaiement || '')}"></label>
            ${Object.values(CONFIG.pays).map(pp => `
              <label class="champ">TVA ${esc(pp.nom)} (encaissé en ${esc(pp.nom)}), en % <input class="saisie" name="tva_${pp.code}_taux" type="number" min="0" max="99" step="0.1" value="${Math.round((c.facturation?.tva?.[pp.code]?.taux || 0) * 1000) / 10}"></label>
              <label class="champ">Mention si TVA à 0 (${esc(pp.nom)}) <input class="saisie" name="tva_${pp.code}_mention" value="${esc(c.facturation?.tva?.[pp.code]?.mention || '')}" placeholder="ex. TVA non applicable, art. … du CGI"></label>`).join('')}
          </div></section>
        <section class="panneau"><div class="panneau-tete"><div><h2>Paiement en ligne (espace client)</h2><p class="petit muet" style="margin-top:4px">Moyens proposés selon le pays d'où le client paie. Carte : par Stripe. Orange Money / MTN MoMo : le client envoie l'argent sur votre compte marchand et donne la référence, vous validez dans Caisses.</p></div></div>
          <div class="panneau-corps pile" style="--gap:14px">
            <div class="ligne" style="--gap:18px;flex-wrap:wrap">
              <span class="gras">Depuis la France :</span>
              <label class="case"><input type="checkbox" name="pay_FR_carte" ${c.paiements?.FR?.carte ? 'checked' : ''}> Carte bancaire</label>
            </div>
            <div class="ligne" style="--gap:18px;flex-wrap:wrap">
              <span class="gras">Depuis la Guinée :</span>
              <label class="case"><input type="checkbox" name="pay_GN_orange_money" ${c.paiements?.GN?.orange_money ? 'checked' : ''}> Orange Money</label>
              <label class="case"><input type="checkbox" name="pay_GN_mtn_momo" ${c.paiements?.GN?.mtn_momo ? 'checked' : ''}> MTN MoMo</label>
              <label class="case"><input type="checkbox" name="pay_GN_carte" ${c.paiements?.GN?.carte ? 'checked' : ''}> Carte bancaire</label>
            </div>
            <div class="formulaire-grille">
              <label class="champ">Numéro marchand Orange Money <input class="saisie" name="pay_om_numero" value="${esc(c.paiements?.comptes?.orange_money?.numero || '')}" placeholder="6XX XX XX XX"></label>
              <label class="champ">Nom affiché (Orange Money) <input class="saisie" name="pay_om_titulaire" value="${esc(c.paiements?.comptes?.orange_money?.titulaire || '')}"></label>
              <label class="champ">Numéro marchand MTN MoMo <input class="saisie" name="pay_mtn_numero" value="${esc(c.paiements?.comptes?.mtn_momo?.numero || '')}" placeholder="66X XX XX XX"></label>
              <label class="champ">Nom affiché (MTN MoMo) <input class="saisie" name="pay_mtn_titulaire" value="${esc(c.paiements?.comptes?.mtn_momo?.titulaire || '')}"></label>
            </div>
            <p class="tres-petit muet">Un moyen n'apparaît chez le client que s'il est coché ET configuré (numéro marchand renseigné, clés Stripe pour la carte).</p>
          </div></section>
        <section class="panneau"><div class="panneau-tete"><div><h2>Réclamations</h2><p class="petit muet" style="margin-top:4px">Repris dans les conditions générales montrées aux clients.</p></div></div>
          <div class="panneau-corps formulaire-grille">
            <label class="champ">Indemnisation maximale sans assurance (€ par kg) <input class="saisie" name="lit_kg" type="number" min="0" step="1" value="${c.litiges?.indemnisationKgEur ?? ''}"></label>
            <label class="champ">Délai pour un colis abîmé ou incomplet (jours après la remise) <input class="saisie" name="lit_abime" type="number" min="0" value="${c.litiges?.delaiAbimeJours ?? ''}"></label>
            <label class="champ">Délai pour un colis perdu ou en retard (jours) <input class="saisie" name="lit_perdu" type="number" min="0" value="${c.litiges?.delaiPerduJours ?? ''}"></label>
          </div></section>
        <section class="panneau"><div class="panneau-tete"><div><h2>Ramassage et livraison à domicile</h2><p class="petit muet" style="margin-top:4px">Prix = base + prix par km × distance entre l'agence et le client (vol d'oiseau + ${Math.round(((c.domicile?.majoration || 1.3) - 1) * 100)} % pour suivre les routes). L'agence doit avoir sa position GPS.</p></div></div>
          <div class="panneau-corps pile" style="--gap:14px">
            ${Object.values(CONFIG.pays).map(p => { const d = c.domicile?.[p.code] || {}; const u = p.devise === 'EUR' ? '€' : 'GNF'; return `
            <div class="formulaire-grille" data-domicile="${p.code}">
              <label class="case" style="align-self:end"><input type="checkbox" name="actif" ${d.actif !== false ? 'checked' : ''}> ${esc(p.nom)}</label>
              <label class="champ">Base (${u}) <input class="saisie" name="base" type="number" min="0" step="${u === '€' ? '0.5' : '500'}" value="${d.base ?? ''}"></label>
              <label class="champ">Par km (${u}) <input class="saisie" name="parKm" type="number" min="0" step="${u === '€' ? '0.1' : '100'}" value="${d.parKm ?? ''}"></label>
              <label class="champ">Plafond (${u}, 0 = aucun) <input class="saisie" name="plafond" type="number" min="0" value="${d.plafond ?? 0}"></label>
              <label class="champ">Distance max (km) <input class="saisie" name="rayonMaxKm" type="number" min="0" value="${d.rayonMaxKm ?? ''}"></label>
              <p class="tres-petit muet" data-exemples style="grid-column:1/-1"></p>
            </div>`; }).join('')}
          </div></section>
        <section class="panneau"><div class="panneau-tete"><div><h2>Agences</h2><p class="petit muet" style="margin-top:4px">Chaque agence reçoit les colis à envoyer, remet les colis arrivés et encaisse. Dans chaque pays, cochez la plateforme où arrivent les lots.</p></div><button type="button" class="btn btn-petit" data-ajout>${ic('plus', 'ic-sm')} Ajouter une agence</button></div>
          <div class="panneau-corps pile" data-liste-agences>${(c.agences || []).map(agenceHtml).join('')}</div></section>
        <div><button class="btn btn-principal btn-grand">Enregistrer les réglages</button></div>
      </form>`;
    const form = main.querySelector('[data-reglages]');
    // Exemples de prix, recalculés pendant la saisie
    const majExemples = () => form.querySelectorAll('[data-domicile]').forEach(b => {
      const n = (k) => parseFloat(b.querySelector(`[name=${k}]`).value) || 0;
      const devise = CONFIG.pays[b.dataset.domicile].devise;
      const prix = (km) => { let x = n('base') + n('parKm') * km; if (n('plafond') > 0) x = Math.min(x, n('plafond')); return montant(devise === 'GNF' ? Math.ceil(x / 1000) * 1000 : Math.ceil(x * 2) / 2, devise); };
      b.querySelector('[data-exemples]').textContent = `Exemples : 2 km → ${prix(2)} · 5 km → ${prix(5)} · 10 km → ${prix(10)} · 20 km → ${prix(20)}`;
    });
    form.addEventListener('input', majExemples);
    // Position d'une agence : carte ou GPS du téléphone
    const poserPosition = (bloc, p) => {
      bloc.querySelector('[name=positionLat]').value = p.lat;
      bloc.querySelector('[name=positionLng]').value = p.lng;
      bloc.querySelector('[name=lienPosition]').value = '';
      bloc.querySelector('[data-etat-pos]').innerHTML = `<span class="vert">${ic('ok', 'ic-sm')} ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span> <span class="muet">(pensez à enregistrer)</span>`;
    };
    form.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-placer], [data-ici]');
      if (!b) return;
      const bloc = b.closest('[data-agence]');
      const lat = parseFloat(bloc.querySelector('[name=positionLat]').value), lng = parseFloat(bloc.querySelector('[name=positionLng]').value);
      const pays = bloc.querySelector('[name=pays]').value;
      try {
        if (b.matches('[data-placer]')) {
          const p = await K.choisirSurCarte({ position: lat ? { lat, lng } : null, pays, titre: `Où est ${bloc.querySelector('[name=nom]').value || 'l\'agence'} ?` });
          if (p) poserPosition(bloc, p);
        } else {
          b.disabled = true;
          const p = await K.gpsActuel();
          poserPosition(bloc, p);
          if (p.precision > 60) toast(`Position à ± ${p.precision} m : vérifiez-la avec « Placer sur la carte ».`);
        }
      } catch (err) { toast(err.message, 'erreur'); } finally { b.disabled = false; }
    });
    majExemples();
    form.querySelector('[data-ajout-article]').addEventListener('click', () => {
      form.querySelector('[data-liste-articles]').insertAdjacentHTML('beforeend', articleHtml({ actif: true }));
      form.querySelector('[data-liste-articles] [data-article]:last-child [name=art_label]').focus();
    });
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-suppr-article]');
      if (b && confirm('Retirer cet article du catalogue ? (Les colis déjà enregistrés gardent leur prix.)')) b.closest('[data-article]').remove();
    });
    form.querySelector('[data-ajout]').addEventListener('click', () => {
      form.querySelector('[data-liste-agences]').insertAdjacentHTML('beforeend', agenceHtml({ pays: 'GN' }));
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (n) => form.querySelector(`[name="${n}"]`).value;
      const agences = [...form.querySelectorAll('[data-agence]')].map(bloc => {
        const o = {};
        bloc.querySelectorAll('input, select').forEach(i => { o[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
        if (o.positionLat && o.positionLng) o.position = { lat: parseFloat(o.positionLat), lng: parseFloat(o.positionLng) };
        delete o.positionLat; delete o.positionLng;
        if (!o.lienPosition) delete o.lienPosition;
        return o;
      }).filter(a => a.code && a.nom);
      const tarifs = Object.fromEntries(CONFIG.sens.map(x => [x.key, {
        devise: v(`${x.key}_devise`),
        express: { prixKg: v(`${x.key}_express_prixKg`), poidsMin: v(`${x.key}_express_poidsMin`) },
        air: { prixKg: v(`${x.key}_air_prixKg`), poidsMin: v(`${x.key}_air_poidsMin`) },
        mer: { prixKg: v(`${x.key}_mer_prixKg`), poidsMin: v(`${x.key}_mer_poidsMin`) },
      }]));
      const articles = [...form.querySelectorAll('[data-article]')].map(bloc => {
        const val = (n) => bloc.querySelector(`[name="${n}"]`).value.trim();
        return {
          cle: bloc.dataset.cle || undefined, label: val('art_label'), poids: val('art_poids') || 0,
          actif: bloc.querySelector('[name=art_actif]').checked,
          prix: Object.fromEntries(CONFIG.sens.map(x => [x.key, Object.fromEntries(['air', 'mer'].map(m => [m, val(`art_${x.key}_${m}`)]).filter(([, p]) => p !== ''))])),
        };
      }).filter(a => a.label);
      const corps = {
        tauxEurGnf: v('tauxEurGnf'), tarifs, articles,
        surcharges: Object.fromEntries(CONFIG.typesColis.map(t => [t.key, (parseFloat(v(`sur_${t.key}`)) || 0) / 100])),
        tauxAssurance: (parseFloat(v('tauxAssurance')) || 0) / 100,
        magasinage: { joursGratuits: v('joursGratuits'), fraisJourGnf: v('fraisJourGnf'), fraisJourEur: v('fraisJourEur') },
        facturation: {
          capital: v('fac_capital'), email: v('fac_email'), telephone: v('fac_telephone'), site: v('fac_site'), mediateur: v('fac_mediateur'), conditionsPaiement: v('fac_conditions'),
          tva: Object.fromEntries(Object.keys(CONFIG.pays).map(k => [k, { taux: (parseFloat(v(`tva_${k}_taux`)) || 0) / 100, mention: v(`tva_${k}_mention`) }])),
        },
        paiements: {
          FR: { carte: form.querySelector('[name=pay_FR_carte]').checked },
          GN: { orange_money: form.querySelector('[name=pay_GN_orange_money]').checked, mtn_momo: form.querySelector('[name=pay_GN_mtn_momo]').checked, carte: form.querySelector('[name=pay_GN_carte]').checked },
          comptes: { orange_money: { numero: v('pay_om_numero'), titulaire: v('pay_om_titulaire') }, mtn_momo: { numero: v('pay_mtn_numero'), titulaire: v('pay_mtn_titulaire') } },
        },
        litiges: { indemnisationKgEur: v('lit_kg'), delaiAbimeJours: v('lit_abime'), delaiPerduJours: v('lit_perdu') },
        domicile: Object.fromEntries([...form.querySelectorAll('[data-domicile]')].map(b => [b.dataset.domicile, {
          actif: b.querySelector('[name=actif]').checked,
          ...Object.fromEntries(['base', 'parKm', 'plafond', 'rayonMaxKm'].map(k => [k, b.querySelector(`[name=${k}]`).value])),
        }])),
        agences,
      };
      try {
        await api.patch('/config/admin', corps);
        CONFIG = await K.config({ forcer: true });
        majEncartTaux();
        toast('Réglages enregistrés. Les nouveaux prix s\'appliquent aux prochaines pesées.', 'ok');
        reglages();
      } catch (err) { toast(err.message, 'erreur'); }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  ÉQUIPE
  // ══════════════════════════════════════════════════════════
  async function equipe() {
    const { equipe: liste } = await api.get('/utilisateurs/equipe');
    const lieux = CONFIG.agences;
    main.innerHTML = `
      <div class="entete-page"><h1>Équipe</h1></div>
      <div class="deux-col">
        <section class="panneau"><div class="defile"><table class="tableau">
          <thead><tr><th>Nom</th><th>Téléphone</th><th>Rôle</th><th>Agence</th><th>Accès</th><th></th></tr></thead>
          <tbody>${liste.map(u => `
            <tr data-id="${esc(u._id)}">
              <td class="gras">${esc(u.prenom)} ${esc(u.nom)}</td><td class="chiffres">${esc(u.telephone)}</td>
              <td>${u.role === 'admin' ? 'Administrateur' : u.role === 'livreur' ? 'Livreur' : 'Agent'}</td>
              <td><select class="saisie" style="min-height:40px;font-size:14px" data-lieu aria-label="Lieu de ${esc(u.prenom)}">${lieux.map(l => `<option value="${esc(l.code)}" ${l.code === u.lieu ? 'selected' : ''}>${esc(l.nom)}</option>`).join('')}${!u.lieu ? '<option value="" selected>Toutes les agences</option>' : ''}</select></td>
              <td><label class="case" style="min-height:40px"><input type="checkbox" data-actif ${u.actif ? 'checked' : ''}> Actif</label></td>
              <td><button class="btn btn-petit" type="button" data-reinit>Mot de passe</button></td>
            </tr>`).join('')}</tbody></table></div></section>
        <form class="panneau" data-ajout-agent><div class="panneau-tete"><h2>Ajouter un membre</h2></div><div class="panneau-corps pile" style="--gap:10px">
          <label class="champ">Téléphone <input class="saisie" name="telephone" type="tel" required></label>
          <div class="grille-2"><label class="champ">Prénom <input class="saisie" name="prenom" required></label><label class="champ">Nom <input class="saisie" name="nom" required></label></div>
          <label class="champ">Rôle <select class="saisie" name="role"><option value="agent">Agent (dépôt ou guichet)</option><option value="livreur">Livreur (ramassages et livraisons)</option><option value="admin">Administrateur</option></select></label>
          <label class="champ">Agence <select class="saisie" name="lieu">${lieux.map(l => `<option value="${esc(l.code)}">${esc(l.nom)}</option>`).join('')}</select></label>
          <label class="champ">Mot de passe (8 caractères minimum) <input class="saisie" name="motDePasse" type="text" autocomplete="off" minlength="8" required></label>
          <button class="btn btn-principal">Ajouter</button>
          <p class="tres-petit muet">Donnez ce mot de passe à la personne : elle se connecte à l'app agent avec son numéro, puis peut le changer. Un livreur n'y voit que ses courses et sa caisse.</p>
        </div></form>
      </div>
      <form class="panneau" style="margin-top:20px;max-width:720px" data-mdp-client>
        <div class="panneau-tete"><div><h2>Mot de passe d'un client</h2><p class="petit muet" style="margin-top:4px">Pour un client venu en agence avec sa pièce d'identité : son numéro est alors marqué comme vérifié et il voit les codes de retrait des colis qu'on lui envoie.</p></div></div>
        <div class="panneau-corps formulaire-grille">
          <label class="champ">Téléphone <input class="saisie" name="telephone" type="tel" required></label>
          <label class="champ">Prénom (si nouveau) <input class="saisie" name="prenom"></label>
          <label class="champ">Nom (si nouveau) <input class="saisie" name="nom"></label>
          <label class="champ">Nouveau mot de passe <input class="saisie" name="motDePasse" type="text" autocomplete="off" minlength="8" required></label>
          <div style="align-self:end"><button class="btn btn-noir">Enregistrer</button></div>
        </div>
      </form>`;
    main.querySelector('[data-mdp-client]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.telephone = normTel(f.telephone);
      try { const r = await api.post('/utilisateurs/client-mot-de-passe', f); toast(r.message, 'ok'); e.target.reset(); } catch (err) { toast(err.message, 'erreur'); }
    });
    main.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = tr.dataset.id;
      tr.querySelector('[data-lieu]').addEventListener('change', async (e) => { try { await api.patch(`/utilisateurs/equipe/${id}`, { lieu: e.target.value }); toast('Lieu modifié.', 'ok'); } catch (err) { toast(err.message, 'erreur'); } });
      tr.querySelector('[data-reinit]').addEventListener('click', async () => {
        const mdp = prompt('Nouveau mot de passe (8 caractères minimum) :');
        if (!mdp) return;
        try { await api.patch(`/utilisateurs/equipe/${id}`, { motDePasse: mdp }); toast('Mot de passe changé. Ses sessions ouvertes sont fermées.', 'ok'); } catch (err) { toast(err.message, 'erreur'); }
      });
      tr.querySelector('[data-actif]').addEventListener('change', async (e) => { try { await api.patch(`/utilisateurs/equipe/${id}`, { actif: e.target.checked }); toast(e.target.checked ? 'Accès activé.' : 'Accès coupé.', 'ok'); } catch (err) { toast(err.message, 'erreur'); e.target.checked = !e.target.checked; } });
    });
    main.querySelector('[data-ajout-agent]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.telephone = normTel(f.telephone);
      try { await api.post('/utilisateurs/equipe', f); toast(`${f.prenom} ajouté(e).`, 'ok'); equipe(); } catch (err) { toast(err.message, 'erreur'); }
    });
  }

  // ── Démarrage ──
  document.querySelector('[data-sortir]').addEventListener('click', () => { session.fermer(); router(); });
  document.querySelector('[data-mdp]')?.addEventListener('click', () => K.changerMotDePasse());
  setInterval(() => { if (session.connecte() && session.utilisateur()?.role === 'admin') majPastilleRec(); }, 120000);
  async function demarrer() {
    try { CONFIG = await K.config({ forcer: true }); } catch (e) { main.innerHTML = `<p class="bandeau bandeau-rouge">Serveur injoignable.</p>`; return; }
    document.querySelectorAll('[data-nom-app]').forEach(el => { el.textContent = CONFIG.app; });
    document.title = `${CONFIG.app} · Back-office`;
    majEncartTaux();
    window.addEventListener('hashchange', router);
    router();
  }
  demarrer();
})();
