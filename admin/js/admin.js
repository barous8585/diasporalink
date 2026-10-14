// ─────────────────────────────────────────────────────────────
//  Back-office : tableau de bord, lots, colis, caisses, réglages, équipe
// ─────────────────────────────────────────────────────────────
(function () {
  const { api, session, stock, esc, gnf, eur, montant, kg, date, heure, ic, toast, modale, normTel } = K;
  const main = document.getElementById('contenu');
  let CONFIG = null;
  const LIB_STATUT_LOT = { preparation: 'En préparation', parti: 'Parti', arrive: 'Arrivé', cloture: 'Clôturé' };
  const badge = (statut, lib) => `<span class="badge b-${esc(statut)}">${esc(lib || CONFIG?.statuts?.[statut] || statut)}</span>`;
  const nomLieu = (code) => (CONFIG?.agences || []).find(l => l.code === code)?.nom || code || '—';
  const libSens = (sens) => CONFIG?.sens?.find(x => x.key === (sens || 'FR-GN'))?.label || '';
  const optionsAgences = (pays, choisi) => {
    const parVille = {};
    (CONFIG?.agences || []).filter(a => !pays || a.pays === pays).forEach(a => { const k = `${CONFIG.pays[a.pays]?.nom} · ${a.ville || '—'}`; (parVille[k] = parVille[k] || []).push(a); });
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
    [/^\/reglages$/, reglages, 'reglages'],
    [/^\/equipe$/, equipe, 'equipe'],
  ];

  async function router() {
    if (!session.connecte()) return connexion();
    const u = session.utilisateur();
    if (u.role !== 'admin') {
      document.querySelector('[data-menu]').classList.add('cache');
      main.innerHTML = `<div class="pile" style="max-width:420px"><h1>Accès réservé</h1><p class="muet">Ce compte n'est pas administrateur.</p><button class="btn" data-sortir2>Se déconnecter</button></div>`;
      main.querySelector('[data-sortir2]').onclick = () => { session.fermer(); router(); };
      return;
    }
    document.querySelector('[data-menu]').classList.remove('cache');
    const chemin = location.hash.replace(/^#/, '').split('?')[0] || '/';
    for (const [re, vue, nav] of routes) {
      const m = chemin.match(re);
      if (!m) continue;
      document.querySelectorAll('[data-nav]').forEach(a => a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
      main.innerHTML = '<div class="chargement"></div>';
      try { await vue(...m.slice(1)); }
      catch (e) { main.innerHTML = `<p class="bandeau bandeau-rouge">${esc(e.message)}</p>`; }
      return;
    }
    location.hash = '#/';
  }

  function connexion() {
    document.querySelector('[data-menu]').classList.add('cache');
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
  async function tableauDeBord() {
    const [s, lotsR] = await Promise.all([api.get('/admin/stats'), api.get('/lots')]);
    const c = s.compteurs;
    const enCours = lotsR.lots.filter(l => l.statut !== 'cloture').slice(0, 6);
    main.innerHTML = `
      <div class="entete-page"><h1>Tableau de bord</h1>
        <div class="ligne" style="--gap:8px"><a class="btn" href="#/lots">${ic('lot', 'ic-sm')} Lots</a><a class="btn btn-principal" href="#/colis">${ic('loupe', 'ic-sm')} Chercher un colis</a></div></div>
      <div class="kpis">
        <a class="kpi" href="#/colis?statut=reserve"><div class="lib">Réservés en ligne</div><div class="val">${c.reserves}</div><div class="sous">à déposer</div></a>
        <a class="kpi" href="#/lots"><div class="lib">Au dépôt</div><div class="val">${c.auDepot}</div><div class="sous">déposés ou chargés</div></a>
        <a class="kpi" href="#/lots"><div class="lib">En route</div><div class="val">${c.enRoute}</div><div class="sous">${s.lotsEnCours.partis} lot(s) parti(s)</div></a>
        <a class="kpi" href="#/colis?statut=pret"><div class="lib">En agence de retrait</div><div class="val">${c.auxGuichets}</div><div class="sous ${c.anciensGuichet ? 'alerte' : ''}">${c.anciensGuichet} depuis plus de ${CONFIG.magasinage.joursGratuits} j</div></a>
        <div class="kpi vert"><div class="lib">Encaissé aujourd'hui</div><div class="val" style="font-size:22px">${gnf(s.encaisseJour.GNF)}</div><div class="sous">+ ${eur(s.encaisseJour.EUR)}</div></div>
        <a class="kpi ocre" href="#/colis?statut=pret"><div class="lib">Impayés au guichet</div><div class="val">${c.impayes}</div><div class="sous">colis avec un reste à payer</div></a>
      </div>
      <div class="deux-col">
        <section class="panneau">
          <div class="panneau-tete"><h2>Lots en cours</h2><button class="btn btn-noir btn-petit" data-nouveau-lot>${ic('plus', 'ic-sm')} Nouveau lot</button></div>
          <div class="defile"><table class="tableau"><thead><tr><th>Lot</th><th>Transport</th><th>Colis</th><th>Poids</th><th>Statut</th><th>Arrivée prévue</th></tr></thead><tbody>
            ${enCours.length ? enCours.map(l => `<tr class="cliquable" data-lot="${esc(l.code)}"><td class="gras">${esc(l.code)}</td><td>${esc(libSens(l.sens))} · ${l.mode === 'mer' ? 'bateau' : 'avion'}${l.reference ? ` · ${esc(l.reference)}` : ''}</td><td>${l.nbColis}</td><td>${kg(l.poidsTotal)}</td><td>${badge(l.statut === 'preparation' ? 'reserve' : l.statut === 'parti' ? 'en_transit' : 'pret', LIB_STATUT_LOT[l.statut])}</td><td>${l.dateArriveePrevue ? esc(date(l.dateArriveePrevue, false)) : '—'}</td></tr>`).join('')
              : '<tr><td colspan="6" class="vide">Aucun lot en cours. Créez un lot pour commencer le chargement.</td></tr>'}
          </tbody></table></div>
        </section>
        <section class="panneau">
          <div class="panneau-tete"><h2>À traiter</h2></div>
          <div class="panneau-corps pile" style="--gap:8px">
            ${s.alertes.tauxAgeJours !== null && s.alertes.tauxAgeJours > 7 ? `<div class="alerte-ligne ocre">${ic('prix', 'ic-sm')}<div>Le taux EUR/GNF n'a pas été mis à jour depuis ${s.alertes.tauxAgeJours} jours. <a href="#/reglages">Mettre à jour</a></div></div>` : ''}
            ${s.alertes.anciens.length ? `<div class="alerte-ligne ocre">${ic('horloge', 'ic-sm')}<div><b>${s.alertes.anciens.length} colis</b> au guichet depuis plus de ${CONFIG.magasinage.joursGratuits} jours. <button class="btn btn-lien" style="min-height:0;padding:0" data-relancer>Relancer par SMS</button></div></div>` : ''}
            ${s.alertes.ecartsPesee.map(e => `<div class="alerte-ligne rouge">${ic('balance', 'ic-sm')}<div><b>Écart de pesée</b> · <a href="#/colis?q=${esc(e.numeroSuivi)}">${esc(e.numeroSuivi)}</a> : annoncé ${kg(e.poidsEstime)}, pesé ${kg(e.poidsReel)} (${e.ecart > 0 ? '+' : ''}${kg(e.ecart)})</div></div>`).join('')}
            ${s.alertes.caissesEnRetard ? `<div class="alerte-ligne ocre">${ic('billet', 'ic-sm')}<div><b>${s.alertes.caissesEnRetard} caisse(s)</b> non clôturée(s) depuis hier. <a href="#/caisses">Voir</a></div></div>` : ''}
            ${!s.alertes.anciens.length && !s.alertes.ecartsPesee.length && !s.alertes.caissesEnRetard && !(s.alertes.tauxAgeJours > 7) ? '<p class="muet petit">Rien à signaler.</p>' : ''}
          </div>
        </section>
      </div>`;
    main.querySelectorAll('[data-lot]').forEach(tr => tr.addEventListener('click', () => { location.hash = `#/lots/${tr.dataset.lot}`; }));
    main.querySelector('[data-nouveau-lot]').addEventListener('click', nouveauLot);
    main.querySelector('[data-relancer]')?.addEventListener('click', async () => {
      if (!confirm('Envoyer un SMS de rappel à tous ces destinataires ?')) return;
      try { const r = await api.post('/admin/relances'); toast(`${r.envoyes} rappel(s) envoyé(s).`, 'ok'); } catch (e) { toast(e.message, 'erreur'); }
    });
  }

  function nouveauLot() {
    const { el, fermer } = modale(`
      <form class="pile" style="--gap:12px">
        <div class="ligne entre"><h2>Nouveau lot</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        <div class="grille-2">${CONFIG.sens.map((x, i) => `<label class="case" style="border:1px solid var(--ligne-2);border-radius:12px;padding:0 12px;background:#fff"><input type="radio" name="sens" value="${x.key}" ${i === 0 ? 'checked' : ''}> ${esc(x.label)}</label>`).join('')}</div>
        <div class="grille-2">${CONFIG.modes.map((m, i) => `<label class="case" style="border:1px solid var(--ligne-2);border-radius:12px;padding:0 12px;background:#fff"><input type="radio" name="mode" value="${m.key}" ${i === 0 ? 'checked' : ''}> ${esc(m.label)}</label>`).join('')}</div>
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
            <h2 style="font-size:24px">Lot ${esc(lot.code)} · ${lot.mode === 'mer' ? 'bateau' : 'avion'}</h2>
            <p class="petit muet" style="margin-top:4px">${[lot.reference, lot.transporteur].filter(Boolean).map(esc).join(' · ') || 'Sans référence'} ·
              ${stats.nb} colis · ${kg(stats.poids)}${lot.statut !== 'preparation' ? ` · reçus en Guinée : ${stats.scannesArrivee} / ${stats.nb}` : ''}
              ${lot.departLe ? ` · parti le ${esc(date(lot.departLe, false))}` : lot.dateDepartPrevue ? ` · départ prévu ${esc(date(lot.dateDepartPrevue, false))}` : ''}</p>
          </div>
          <div class="ligne" style="--gap:8px">
            <button class="btn btn-petit" data-imprimer-manifeste>${ic('imprimer', 'ic-sm')} Manifeste</button>
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
      <h1>${esc(CONFIG.app)} — Manifeste du lot ${esc(lot.code)}</h1>
      <p>${esc(libSens(lot.sens))} · ${lot.mode === 'mer' ? 'Bateau' : 'Avion'} · ${esc(lot.reference || '')} ${esc(lot.transporteur || '')} · ${stats.nb} colis · ${kg(stats.poids)} · imprimé le ${esc(date(new Date()))}</p>
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
        ${r.colis.length ? r.colis.map(c => `<tr class="cliquable" data-num="${esc(c.numeroSuivi)}"><td class="gras">${esc(c.numeroSuivi)}</td><td>${esc(c.expediteur.nom)}</td><td>${esc(c.destinataire.nom)}<div class="tres-petit muet">${esc(c.destinataire.telephone)}</div></td><td>${esc(nomLieu(c.guichet))}</td><td>${kg(c.poidsReel || c.poidsEstime)}</td><td>${esc(c.lotCode || '—')}</td><td>${c.solde.soldeGnf ? gnf(c.solde.soldeGnf) : '—'}</td><td>${badge(c.statut)}</td><td class="tres-petit muet">${esc(date(c.updatedAt))}</td></tr>`).join('')
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
        ${['pret', 'en_livraison'].includes(c.statut) ? `<div class="carte-ocre ligne entre"><div><div class="tres-petit gras">Code de retrait</div><div class="titre" style="font-size:26px;letter-spacing:5px">${esc(c.codeRetrait || '—')}</div>${c.codeEssais ? `<div class="tres-petit">${c.codeEssais} essai(s) faux</div>` : ''}</div>${c.codeEssais >= 5 ? '<button class="btn btn-noir btn-petit" data-debloquer>Débloquer</button>' : ''}</div>` : ''}
        <div class="carte">
          <div class="ligne-info"><span>Expéditeur</span><span>${esc(c.expediteur.nom)} · ${esc(c.expediteur.telephone)}</span></div>
          <div class="ligne-info"><span>Destinataire</span><span>${esc(c.destinataire.nom)} · ${esc(c.destinataire.telephone)}</span></div>
          ${c.tiersAutorise?.nom ? `<div class="ligne-info"><span>Autorisé à retirer</span><span>${esc(c.tiersAutorise.nom)} · ${esc(c.tiersAutorise.telephone)}</span></div>` : ''}
          <div class="ligne-info"><span>Trajet</span><span>${esc(nomLieu(c.depot))} → ${esc(nomLieu(c.guichet))}</span></div>
          <div class="ligne-info"><span>Transport</span><span>${esc(libSens(c.sens))} · ${c.mode === 'mer' ? 'bateau' : 'avion'} · lot ${esc(c.lotCode || '—')}</span></div>
          <div class="ligne-info"><span>Poids</span><span>${c.poidsReel ? kg(c.poidsReel) : '—'} pesé${c.poidsEstime ? ` · ${kg(c.poidsEstime)} annoncé` : ''} · ${c.nbCartons} carton(s)</span></div>
          <div class="ligne-info"><span>Prix transport</span><span>${eur(c.tarif?.totalEur)} · ${gnf(c.tarif?.totalGnf)} (taux ${gnf(c.tarif?.taux)})${c.tarif?.estime ? ' · estimé' : ''}</span></div>
          <div class="ligne-info"><span>Douane · garde</span><span>${gnf(c.fraisDouaneGnf)} · ${gnf(c.solde.magasinage.fraisGnf)}</span></div>
          <div class="ligne-info"><span>Payé</span><span>${gnf(c.solde.payeGnf)}${c.payeurArrivee ? ' · paie à l\'arrivée' : ''}</span></div>
          <div class="ligne-info"><span class="gras">Reste à payer</span><span class="gras">${gnf(c.solde.soldeGnf)}</span></div>
          ${['ramassage', 'livraison'].filter(k => c[k]?.demande).map(k => `<div class="ligne-info"><span>${k === 'ramassage' ? 'Ramassage' : 'Livraison'} à domicile</span><span>${esc(c[k].adresse?.quartier || '')}${c[k].prix ? ` · ${montant(c[k].prix, c[k].devise)}` : ' · prix à calculer'} · ${esc(LIB_COURSE[c[k].statut] || c[k].statut)}${c[k].livreurNom ? ` · ${esc(c[k].livreurNom)}` : ''}</span></div>`).join('')}
          ${c.remise?.le ? `<div class="ligne-info"><span>Remis</span><span>${esc(date(c.remise.le))} à ${esc(c.remise.nomRetrait || '')}${c.remise.aDomicile ? ' (à domicile)' : ''}</span></div>` : ''}
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
        <button class="btn" data-etiquette-colis>${ic('imprimer', 'ic-sm')} Imprimer l'étiquette</button>
        <div class="carte"><h3 style="margin-bottom:12px">Historique</h3><div class="frise">${[...c.historique].reverse().map(h => `
          <div class="etape"><div class="rail"><div class="point"></div><div class="trait"></div></div><div class="texte"><div class="gras">${esc(h.label)}</div><div class="petit muet">${esc(date(h.le))}${h.detail ? ` · ${esc(h.detail)}` : ''}${h.agent?.prenom ? ` · ${esc(h.agent.prenom)}` : ''}</div></div></div>`).join('')}</div></div>
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
    const optionsLivreurs = (c) => `<option value="">— Aucun —</option>${r.livreurs.filter(l => l.lieu === c.agence).map(l => `<option value="${esc(l._id)}" ${String(l._id) === String(c.livreur) ? 'selected' : ''}>${esc(l.prenom)} ${esc(l.nom)}</option>`).join('')}`;
    const ligne = (c) => `
      <tr data-num="${esc(c.numeroSuivi)}" data-type="${c.type}">
        <td><span class="badge">${c.type === 'ramassage' ? 'Ramassage' : 'Livraison'}</span></td>
        <td><a href="#" data-fiche class="gras">${esc(c.numeroSuivi)}</a><div class="tres-petit muet">${esc(CONFIG.statuts[c.statutColis] || c.statutColis)}</div></td>
        <td>${esc(c.adresse?.nom || c.contact?.nom || '')}<div class="tres-petit muet">${esc(c.adresse?.telephone || c.contact?.telephone || '')}</div></td>
        <td>${esc([c.adresse?.quartier, c.adresse?.ville].filter(Boolean).join(', '))}<div class="tres-petit muet">${esc(c.adresse?.repere || '')}</div>
          ${c.adresse?.position?.lat ? `<a class="tres-petit" href="${esc(K.lienCarte(c.adresse.position))}" target="_blank" rel="noopener">carte</a>` : '<span class="tres-petit rouge">position manquante</span>'}</td>
        <td>${esc(nomLieu(c.agence))}<div class="tres-petit muet">${c.distanceKm ? `${esc(String(c.distanceKm).replace('.', ','))} km` : ''}</div></td>
        <td class="chiffres">${c.prix ? montant(c.prix, c.devise) : '—'}</td>
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
            <td>${esc(c.adresse?.quartier || '')}</td><td>${esc(c.livreurNom || '')}</td><td class="chiffres">${c.prix ? montant(c.prix, c.devise) : '—'}</td>
            <td class="chiffres">${c.ecartM === undefined || c.ecartM === null ? '<span class="muet">pas de GPS</span>' : c.ecartM > 500 ? `<span class="alerte-ecart">${(c.ecartM / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km</span>` : `${c.ecartM} m`}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muet">Rien pour l\'instant.</td></tr>'}</tbody></table></div></section>`;
    main.querySelector('[data-filtre]').addEventListener('change', (e) => { stock.ecrire('filtre_courses', e.target.value); courses(); });
    main.querySelectorAll('tr[data-num]').forEach(tr => {
      const { num, type } = tr.dataset;
      const c = r.courses.find(x => x.numeroSuivi === num && x.type === type);
      tr.querySelector('[data-fiche]').addEventListener('click', (e) => { e.preventDefault(); ficheColis(num, courses); });
      tr.querySelector('[data-livreur]')?.addEventListener('change', async (e) => {
        try { await api.post('/admin/courses/assigner', { numero: num, type, livreur: e.target.value || null }); toast(e.target.value ? 'Livreur assigné.' : 'Course libérée.', 'ok'); }
        catch (err) { toast(err.message, 'erreur'); courses(); }
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
  //  CAISSES
  // ══════════════════════════════════════════════════════════
  async function caisses() {
    const jour = new Date().toISOString().slice(0, 10);
    main.innerHTML = `
      <div class="entete-page"><h1>Caisses</h1><label class="ligne" style="--gap:8px">Jour <input class="saisie" type="date" data-jour value="${jour}" style="width:auto"></label></div>
      <div data-caisses></div>`;
    const charger = async (d) => {
      const r = await api.get(`/caisse/jour?date=${d}`);
      const methodes = Object.fromEntries(CONFIG.methodesPaiement.map(m => [m.key, m.label]));
      const totaux = (t) => Object.entries(t).map(([dev, parM]) => Object.entries(parM).map(([m, v]) => `${esc(methodes[m] || m)} ${montant(v, dev)}`).join(' · ')).join(' — ') || '—';
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
        <label class="champ">Position GPS <span class="tres-petit muet">${a.position?.lat ? `${a.position.lat.toFixed(5)}, ${a.position.lng.toFixed(5)} · <a href="${esc(K.lienCarte(a.position))}" target="_blank" rel="noopener">voir</a>` : 'non renseignée : pas de courses à domicile'}</span>
          <input class="saisie" name="lienPosition" placeholder="Lien Google Maps ou « 9.51, -13.71 »" autocomplete="off">
          <input type="hidden" name="positionLat" value="${a.position?.lat ?? ''}"><input type="hidden" name="positionLng" value="${a.position?.lng ?? ''}"></label>
        <label class="case"><input type="checkbox" name="plateforme" ${a.plateforme ? 'checked' : ''}> Plateforme d'arrivée des lots</label>
        <label class="case"><input type="checkbox" name="actif" ${a.actif !== false ? 'checked' : ''}> Ouverte</label>
      </div>`;
    const blocTarif = (x) => {
      const t = c.tarifs?.[x.key] || { devise: 'EUR', air: {}, mer: {} };
      return `
      <section class="panneau"><div class="panneau-tete"><h2>${esc(x.label)}</h2>
        <label class="ligne" style="--gap:8px">Devise <select class="saisie" name="${x.key}_devise" style="width:auto"><option value="EUR" ${t.devise === 'EUR' ? 'selected' : ''}>€</option><option value="GNF" ${t.devise === 'GNF' ? 'selected' : ''}>GNF</option></select></label></div>
        <div class="panneau-corps formulaire-grille">
          <label class="champ">Avion : prix par kg <input class="saisie" name="${x.key}_air_prixKg" type="number" step="0.01" min="0" value="${t.air?.prixKg ?? ''}"></label>
          <label class="champ">Avion : poids minimum (kg) <input class="saisie" name="${x.key}_air_poidsMin" type="number" step="0.1" min="0" value="${t.air?.poidsMin ?? ''}"></label>
          <label class="champ">Bateau : prix par kg <input class="saisie" name="${x.key}_mer_prixKg" type="number" step="0.01" min="0" value="${t.mer?.prixKg ?? ''}"></label>
          <label class="champ">Bateau : poids minimum (kg) <input class="saisie" name="${x.key}_mer_poidsMin" type="number" step="0.1" min="0" value="${t.mer?.poidsMin ?? ''}"></label>
        </div></section>`;
    };
    main.innerHTML = `
      <div class="entete-page"><h1>Tarifs &amp; agences</h1></div>
      <form class="pile" style="--gap:20px;max-width:1040px" data-reglages>
        <section class="panneau"><div class="panneau-tete"><h2>Taux de change</h2><span class="petit muet">Figé sur chaque colis au moment de la pesée</span></div>
          <div class="panneau-corps formulaire-grille">
            <label class="champ">1 € = … GNF <input class="saisie saisie-forte" name="tauxEurGnf" type="number" min="1" step="1" value="${c.tauxEurGnf}"></label>
            <p class="petit muet" style="align-self:end">Dernière mise à jour : ${esc(date(c.tauxMisAJourLe))}</p>
          </div></section>
        ${CONFIG.sens.map(blocTarif).join('')}
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
    majExemples();
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
        air: { prixKg: v(`${x.key}_air_prixKg`), poidsMin: v(`${x.key}_air_poidsMin`) },
        mer: { prixKg: v(`${x.key}_mer_prixKg`), poidsMin: v(`${x.key}_mer_poidsMin`) },
      }]));
      const corps = {
        tauxEurGnf: v('tauxEurGnf'), tarifs,
        surcharges: Object.fromEntries(CONFIG.typesColis.map(t => [t.key, (parseFloat(v(`sur_${t.key}`)) || 0) / 100])),
        tauxAssurance: (parseFloat(v('tauxAssurance')) || 0) / 100,
        magasinage: { joursGratuits: v('joursGratuits'), fraisJourGnf: v('fraisJourGnf'), fraisJourEur: v('fraisJourEur') },
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
              <td><select class="saisie" style="min-height:40px;font-size:14px" data-lieu aria-label="Lieu de ${esc(u.prenom)}">${lieux.map(l => `<option value="${esc(l.code)}" ${l.code === u.lieu ? 'selected' : ''}>${esc(l.nom)}</option>`).join('')}${!u.lieu ? '<option value="" selected>—</option>' : ''}</select></td>
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
  async function demarrer() {
    try { CONFIG = await K.config({ forcer: true }); } catch (e) { main.innerHTML = `<p class="bandeau bandeau-rouge">Serveur injoignable.</p>`; return; }
    document.querySelectorAll('[data-nom-app]').forEach(el => { el.textContent = CONFIG.app; });
    document.title = `${CONFIG.app} — Back-office`;
    majEncartTaux();
    window.addEventListener('hashchange', router);
    router();
  }
  demarrer();
})();
