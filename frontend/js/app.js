// ─────────────────────────────────────────────────────────────
//  App client : suivi, envoi, mes colis
// ─────────────────────────────────────────────────────────────
(function () {
  const { api, session, stock, esc, gnf, eur, montant, kg, date, heure, ic, toast, modale, normTel } = K;
  const main = document.getElementById('contenu');
  let CONFIG = null;

  // ── Utilitaires d'affichage ──
  document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = ic(el.dataset.ic); });

  const ETAPES = [
    { lib: 'Dépôt', statuts: ['depose', 'charge'] },
    { lib: 'En route', statuts: ['en_transit'] },
    { lib: 'Arrivé', statuts: ['arrive', 'acheminement'] },
    { lib: 'Agence', statuts: ['pret', 'en_livraison', 'remis'] },
  ];
  const indexEtape = (s) => ETAPES.findIndex(e => e.statuts.includes(s));
  const icMode = (mode) => K.icMode(mode);
  const agence = (code) => CONFIG?.agences?.find(a => a.code === code) || null;
  const nomGuichet = (code) => agence(code)?.nom || code;
  const agencesDe = (pays) => (CONFIG?.agences || []).filter(a => a.pays === pays);
  const nomPays = (code) => CONFIG?.pays?.[code]?.nom || code;
  const paysArrivee = (c) => String(c.sens || 'FR-GN').split('-')[1];
  // Montant dans la devise du pays où l'on paie, avec l'autre devise entre parenthèses
  const deviseDe = (pays) => CONFIG?.pays?.[pays]?.devise || 'GNF';
  const double = (gnfMt, eurMt, devise) => devise === 'EUR' ? `${eur(eurMt)} (${gnf(gnfMt)})` : `${gnf(gnfMt)} (${eur(eurMt)})`;
  const prixColis = (t) => t ? double(t.totalGnf, t.totalEur, t.devise || 'EUR') : '';
  const lienWhatsApp = (tel, texte = '') => `https://wa.me/${String(tel || '').replace(/[^\d]/g, '')}${texte ? `?text=${encodeURIComponent(texte)}` : ''}`;

  function bandeauReseau(majLe) {
    const el = document.getElementById('reseau');
    if (majLe) {
      el.innerHTML = `${ic('horsligne', 'ic-sm')}<span>Connexion faible. Infos du ${esc(date(majLe))}.</span>`;
      el.classList.remove('cache');
    } else el.classList.add('cache');
  }

  function majBoutonCompte() {
    const u = session.utilisateur();
    const b = document.querySelector('[data-bouton-compte]');
    b.innerHTML = u ? `<span class="gras">${esc((u.prenom?.[0] || '') + (u.nom?.[0] || ''))}</span>` : ic('personne');
  }

  // ── Routeur ──
  const routes = [
    [/^\/?$/, accueil, 'accueil'],
    [/^\/suivi\/([\w-]+)$/, suivi, null],
    [/^\/envoyer$/, envoyer, 'envoyer'],
    [/^\/mes-colis$/, mesColis, 'mes-colis'],
    [/^\/guichets$/, guichets, 'guichets'],
    [/^\/compte$/, compte, null],
    [/^\/connexion$/, connexion, null],
    [/^\/cgv$/, () => pageLegale('Conditions générales', KolisLegal.cgv(CONFIG)), null],
    [/^\/interdits$/, () => pageLegale('Objets interdits', KolisLegal.listeInterdits()), null],
    [/^\/confidentialite$/, () => pageLegale('Confidentialité', KolisLegal.confidentialite(CONFIG)), null],
    [/^\/reclamation\/([\w-]+)$/, reclamation, null],
  ];

  // Suivi et « Mes colis » se mettent à jour seuls (toutes les 60 s, page visible, rien en cours de saisie)
  setInterval(() => {
    if (document.hidden || document.querySelector('.modale-fond')) return;
    if (!/^#\/(suivi\/|mes-colis$)/.test(location.hash) && !(session.connecte() && /^#?\/?$/.test(location.hash))) return;
    const actif = document.activeElement;
    if (actif && ['INPUT', 'TEXTAREA', 'SELECT'].includes(actif.tagName)) return;
    const y = window.scrollY;
    router({ silencieux: true }).then(() => window.scrollTo(0, y));
  }, 60000);

  async function router({ silencieux = false } = {}) {
    const chemin = location.hash.replace(/^#/, '') || '/';
    bandeauReseau(null);
    for (const [re, vue, nav] of routes) {
      const m = chemin.match(re);
      if (m) {
        document.querySelectorAll('[data-nav]').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === nav) || a.removeAttribute('aria-current'));
        document.querySelectorAll('[data-nav]').forEach(a => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); });
        main.classList.toggle('entree', !silencieux); // entrée en douceur, sauf rafraîchissement silencieux
        if (!silencieux) main.innerHTML = '<div class="chargement" aria-label="Chargement"></div>';
        try { await vue(...m.slice(1)); } catch (e) { if (!silencieux) main.innerHTML = `<p class="bandeau bandeau-rouge">${esc(e.message)}</p>`; }
        if (!silencieux) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
        majBoutonCompte();
        return;
      }
    }
    location.hash = '#/';
  }

  const exigerConnexion = () => {
    if (session.connecte()) return true;
    stock.ecrire('retour', location.hash);
    location.hash = '#/connexion';
    return false;
  };

  // ════════════════════════════════════════════════════════
  //  ACCUEIL
  // ════════════════════════════════════════════════════════
  async function accueil() {
    const u = session.utilisateur();
    let mes = stock.lire('mes_colis');
    main.innerHTML = `
      <div class="pile">
        <div>
          ${u ? `<p class="muet">Bonjour ${esc(u.prenom)}</p>` : ''}
          <h1 style="margin-top:4px">Où est mon colis ?</h1>
        </div>
        <form class="recherche" role="search" data-recherche>
          <label>${ic('loupe', 'ic-sm')}<input name="numero" placeholder="N° de suivi (ex. TMS-26-00012)" aria-label="Numéro de suivi" autocomplete="off" autocapitalize="characters" required></label>
          <button class="btn btn-noir btn-carre" type="submit" aria-label="Rechercher">${ic('suivant')}</button>
        </form>
        <div data-vedette></div>
        <div class="grille-2 tuiles-accueil">
          <a class="tuile ocre" href="#/envoyer">${ic('colis', 'ic-lg')}Envoyer un colis</a>
          <a class="tuile" href="#/envoyer">${ic('prix', 'ic-lg')}Calculer le prix</a>
          <a class="tuile" href="#/guichets">${ic('lieu', 'ic-lg')}Nos agences</a>
          <a class="tuile" href="#/mes-colis">${ic('liste', 'ic-lg')}Mes colis</a>
        </div>
        <div data-autres class="pile" style="--gap:10px"></div>
      </div>`;
    main.querySelector('[data-recherche]').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = new FormData(e.target).get('numero').trim().toUpperCase();
      if (n) location.hash = `#/suivi/${encodeURIComponent(n)}`;
    });

    if (!u) return;
    try {
      const r = await api.get('/colis');
      mes = { colis: r.colis, le: Date.now() };
      stock.ecrire('mes_colis', mes);
    } catch (e) {
      if (!e.reseau) return;
      if (mes) bandeauReseau(mes.le);
    }
    if (!mes?.colis?.length) return;
    const actifs = mes.colis.filter(c => !['remis', 'annule'].includes(c.statut));
    const vedette = actifs.find(c => c.statut === 'pret') || actifs[0];
    if (vedette) main.querySelector('[data-vedette]').innerHTML = carteVedette(vedette);
    const autres = actifs.filter(c => c !== vedette).slice(0, 4);
    if (autres.length) {
      const zone = main.querySelector('[data-autres]');
      zone.innerHTML = `<div class="ligne entre"><h2>Mes autres colis</h2><a class="petit" href="#/mes-colis">Tout voir</a></div>${autres.map(c => carteColis(c, u)).join('')}`;
      brancherCartes(zone, autres);
    }
  }

  function carteVedette(c) {
    const i = indexEtape(c.statut);
    return `
      <div class="carte-vert pile vedette" style="--gap:14px">
        <div class="ligne entre" style="align-items:flex-start">
          <div>
            <div class="petit" style="opacity:.85">${esc(c.numeroSuivi)} · vers ${esc(nomPays(paysArrivee(c)))} · ${K.libMode(c.mode)}</div>
            <div class="etat titre">${esc(c.statutLabel)}</div>
            <div style="font-size:15px">${esc(nomGuichet(c.guichet))}${agence(c.guichet)?.ville ? ` · ${esc(agence(c.guichet).ville)}` : ''}</div>
          </div>
        </div>
        <div class="progression" aria-hidden="true">${ETAPES.map((_, k) => `<span class="${k <= i ? 'fait' : ''}"></span>`).join('')}</div>
        <div class="progression-lib" aria-hidden="true">${ETAPES.map(e => `<span>${e.lib}</span>`).join('')}</div>
        <div class="encart-code">
          ${c.codeRetrait ? `<div><div class="tres-petit muet">Code de retrait</div><div class="valeur">${esc(c.codeRetrait)}</div></div>`
                          : `<div class="petit">${c.statut === 'reserve' ? `Prix estimé : <b>${prixColis(c.tarif)}</b>` : c.solde?.soldeGnf > 0 ? `Reste à payer : <b>${double(c.solde.soldeGnf, c.solde.soldeEur, deviseDe(paysArrivee(c)))}</b>` : 'Tout est payé'}</div>`}
          <a class="btn btn-noir" href="#/suivi/${encodeURIComponent(c.numeroSuivi)}">Détails ${ic('suivant', 'ic-sm')}</a>
        </div>
      </div>`;
  }

  function ligneColis(c) {
    const classe = c.statut === 'pret' ? 'pret' : c.mode;
    return `
      <a class="ligne-colis" href="#/suivi/${encodeURIComponent(c.numeroSuivi)}">
        <span class="pastille ${classe}">${c.statut === 'pret' ? ic('ok') : icMode(c.mode)}</span>
        <span class="grandit">
          <span class="gras" style="display:block">${esc(c.statutLabel)}</span>
          <span class="petit muet">${esc(c.numeroSuivi)} · pour ${esc(c.destinataire?.nom || '')} · ${esc(nomPays(paysArrivee(c)))}</span>
        </span>
        ${ic('suivant', 'ic-sm')}
      </a>`;
  }

  // ════════════════════════════════════════════════════════
  //  SUIVI D'UN COLIS
  // ════════════════════════════════════════════════════════
  async function suivi(numero) {
    numero = decodeURIComponent(numero).toUpperCase();
    const caches = stock.lire('suivis', {});
    let c = null, complet = false, horsLigne = null;
    try {
      if (session.connecte()) {
        try { c = (await api.get(`/colis/${numero}`)).colis; complet = true; }
        catch (e) { if (e.reseau) throw e; }
      }
      if (!c) c = (await api.get(`/colis/suivi/${numero}`)).colis;
      caches[numero] = { c, complet, le: Date.now() };
      // on garde les 20 derniers
      const cles = Object.keys(caches).sort((a, b) => caches[b].le - caches[a].le).slice(0, 20);
      stock.ecrire('suivis', Object.fromEntries(cles.map(k => [k, caches[k]])));
    } catch (e) {
      if (e.reseau && caches[numero]) { ({ c, complet } = caches[numero]); horsLigne = caches[numero].le; }
      else if (e.status === 404) {
        main.innerHTML = `<div class="pile"><a href="#/" class="btn btn-rond" aria-label="Retour">${ic('retour')}</a>
          <h1>Numéro introuvable</h1><p class="muet">Vérifiez le numéro <b>${esc(numero)}</b> sur votre reçu ou votre SMS.</p>
          <a class="btn btn-principal btn-plein" href="#/">Nouvelle recherche</a></div>`;
        return;
      } else throw e;
    }
    bandeauReseau(horsLigne);

    const g = complet ? c.guichetInfo : c.guichet;
    const solde = complet ? c.solde : { soldeGnf: c.soldeGnf, soldeEur: c.soldeEur, magasinage: c.magasinage };
    const pret = c.statut === 'pret' || c.statut === 'en_livraison';
    // Courses : vue publique { statut, quartier, aPosition, prix… } ou objet complet (compte)
    const course = (k) => { const x = c[k]; if (!x || x.demande === false || x.statut === 'annulee') return null;
      return complet ? { ...x, quartier: x.adresse?.quartier || x.adresse?.commune, aPosition: !!x.adresse?.position?.lat, livreur: x.livreurNom } : x; };
    const ram = course('ramassage'), liv = course('livraison');
    // Les erreurs de scan corrigées par l'agence ne concernent pas le client
    const historique = [...(c.historique || [])].filter(h => !h.annule && h.label !== 'Étape annulée').reverse();
    const poids = complet ? (c.poidsReel || c.poidsEstime) : c.poids;
    const peutAutoriser = complet && !['reserve', 'remis', 'annule'].includes(c.statut);
    const estime = c.statut === 'reserve';
    const mag = solde.magasinage;
    // On paie dans la devise du pays d'arrivée (sauf l'estimation, montrée dans la devise du sens)
    const devisePaiement = estime ? (CONFIG?.tarifs?.[c.sens || 'FR-GN']?.devise || 'EUR') : deviseDe(paysArrivee(c));
    const principal = (g2, e2) => devisePaiement === 'EUR' ? eur(e2) : gnf(g2);
    const secondaire = (g2, e2) => devisePaiement === 'EUR' ? gnf(g2) : eur(e2);
    const fraisJour = paysArrivee(c) === 'FR' ? eur(CONFIG?.magasinage?.fraisJourEur) : gnf(CONFIG?.magasinage?.fraisJourGnf);
    const depart = complet ? agence(c.depot) : null;
    const joursRestants = mag?.gratuitJusquau ? Math.ceil((new Date(mag.gratuitJusquau) - Date.now()) / 86400000) : null;

    // ── Données utiles à l'affichage ──
    const [pd, pa] = String(c.sens || 'FR-GN').split('-');
    const agDepart = agence(c.depot) || (typeof c.depot === 'object' ? c.depot : null);
    // Où aller : l'agence de dépôt tant que le colis n'est pas déposé, sinon celle de retrait
    const cible = c.statut === 'reserve' && !ram ? (agDepart || depart) : g;
    const lienItineraire = (a) => {
      if (!a) return null;
      if (a.position?.lat) return `https://www.google.com/maps/dir/?api=1&destination=${a.position.lat},${a.position.lng}`;
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.adresse || a.nom} ${a.commune || ''} ${a.ville || ''} ${nomPays(a.pays || pa)}`)}`;
    };
    const iEtape = indexEtape(c.statut);
    const fini = ['remis', 'annule'].includes(c.statut);
    const contenu = [poids ? kg(poids) : '', c.articles?.length ? c.articles.map(a => `${a.quantite} ${a.label.toLowerCase()}`).join(', ') : '', c.nbCartons > 1 ? `${c.nbCartons} cartons` : ''].filter(Boolean).join(' · ');
    const modeInfo = (CONFIG.modes || []).find(m => m.key === c.mode);
    const enVerif = c.paiementEnVerification || (c.declarations || []).some(d => d.statut === 'a_verifier');
    const domicileAPayer = complet ? c.domicileAPayerGnf > 0 : [ram, liv].some(x => x?.prixGnf > 0 && !x.payee);
    const ligneInfo = (lib, val) => val ? `<div class="fiche-ligne"><span>${lib}</span><span>${val}</span></div>` : '';

    main.innerHTML = `
      <div class="pile page-suivi" style="--gap:14px">
        <div class="ligne">
          <a href="#/mes-colis" class="btn btn-rond" aria-label="Retour">${ic('retour')}</a>
          <div class="grandit"><div class="tres-petit muet">Colis</div><div class="titre" style="font-size:19px;font-weight:700">${esc(c.numeroSuivi)}</div></div>
          <button class="btn btn-rond" data-partager aria-label="Partager le suivi">${ic('partager')}</button>
        </div>

        <section class="carte-vert pile suivi-hero" style="--gap:12px">
          <span class="badge" style="align-self:flex-start;background:var(--ocre);color:var(--encre)">${pret ? ic('ok', 'ic-sm') : icMode(c.mode).replace('class="ic ', 'class="ic ic-sm ')} ${esc(c.statutLabel)}</span>
          <h1 style="font-size:25px;line-height:1.2">${esc(titreStatut(c, g))}</h1>
          <div class="suivi-trajet">
            <div><span class="tres-petit">Départ</span><b>${esc(agDepart?.ville || agDepart?.nom || nomPays(pd))}</b></div>
            <span class="trait">${icMode(c.mode).replace('class="ic ', 'class="ic ic-sm ')}</span>
            <div style="text-align:right"><span class="tres-petit">Arrivée</span><b>${esc(g?.ville || g?.nom || nomPays(pa))}</b></div>
          </div>
          ${fini ? '' : `<div class="progression" aria-hidden="true">${ETAPES.map((_, k) => `<span class="${k <= iEtape ? 'fait' : ''}"></span>`).join('')}</div>
          <div class="progression-lib" aria-hidden="true">${ETAPES.map(e => `<span>${e.lib}</span>`).join('')}</div>`}
          <p class="petit" style="opacity:.9">${esc(modeInfo?.label || K.libMode(c.mode))}${modeInfo?.delai ? ` (${esc(modeInfo.delai)})` : ''}${contenu ? ` · ${esc(contenu)}` : ''}</p>
        </section>

        <nav class="actions-rapides" aria-label="Actions">
          ${cible ? `<a href="${esc(lienItineraire(cible))}" target="_blank" rel="noopener">${ic('lieu')}<span>Itinéraire</span></a>` : ''}
          ${cible?.telephone ? `<a href="tel:${esc(cible.telephone)}">${ic('tel')}<span>Appeler</span></a>
          <a href="${esc(lienWhatsApp(cible.telephone, `Bonjour, je vous contacte pour le colis ${c.numeroSuivi}.`))}" target="_blank" rel="noopener">${ic('bulle')}<span>WhatsApp</span></a>` : ''}
          <button type="button" data-partager2>${ic('partager')}<span>Partager</span></button>
        </nav>
        ${cible ? `<p class="tres-petit muet" style="margin-top:-6px">${c.statut === 'reserve' && !ram ? 'Déposer à' : 'Retrait à'} <b>${esc(cible.nom || '')}</b>${cible.adresse ? ` · ${esc(cible.adresse)}` : ''}${cible.horaires ? ` · ${esc(cible.horaires)}` : ''}</p>` : ''}

        ${pret && c.codeRetrait ? `
          <section class="carte pile bloc-code">
            <div class="ligne entre"><h3>Code de retrait</h3><span class="tres-petit muet">${liv ? 'à donner au livreur' : 'avec une pièce d\'identité'}</span></div>
            <div class="code-4">${c.codeRetrait.split('').map(d => `<div>${esc(d)}</div>`).join('')}</div>
          </section>` : pret ? `
          <section class="carte pile">
            <h3>Code de retrait</h3>
            <p class="petit muet">Il est visible dans le compte de l'expéditeur, qui peut vous le transmettre.</p>
            ${session.connecte() ? '' : `<a class="btn btn-plein" href="#/connexion" data-memo-retour>Se connecter</a>`}
          </section>` : ''}

        ${enVerif ? `<p class="bandeau bandeau-ocre">${ic('horloge', 'ic-sm')}<span>Paiement mobile money en cours de vérification. Vous recevrez un SMS.</span></p>` : ''}
        ${!fini && (solde.soldeGnf > 0 || domicileAPayer) ? `
        <section class="carte-ocre pile" style="--gap:6px">
          <div class="ligne entre" style="align-items:flex-end">
            <div>
              <div class="tres-petit gras">${estime ? 'Prix estimé' : 'Reste à payer'}</div>
              <div class="titre" style="font-size:24px;font-weight:800">${principal(solde.soldeGnf, solde.soldeEur)}</div>
              <div class="tres-petit">soit ${secondaire(solde.soldeGnf, solde.soldeEur)}${estime ? ' · fixé à la pesée' : ''}</div>
            </div>
            ${!estime && solde.soldeGnf > 0 && !enVerif ? '<button class="btn btn-noir" data-payer>Payer</button>' : domicileAPayer && !enVerif ? '<button class="btn btn-noir" data-payer-domicile>Payer la livraison</button>' : ''}
          </div>
        </section>` : !fini && !estime ? `<p class="bandeau bandeau-vert">${ic('ok', 'ic-sm')}<span>Tout est payé.</span></p>` : ''}
        ${pret && joursRestants !== null ? `<p class="petit ${joursRestants > 0 ? 'muet' : ''}" style="${joursRestants > 0 ? '' : 'color:var(--rouge);font-weight:600'}">${joursRestants > 0 ? `Retrait gratuit encore ${joursRestants} jour(s), ensuite ${fraisJour} par jour.` : `Frais de garde : ${principal(mag.fraisGnf, mag.fraisGnf / (c.tarif?.taux || CONFIG.tauxEurGnf))} (${mag.joursFactures} jour(s)).`}</p>` : ''}

        ${carteCourses(c, ram, liv)}

        ${complet && c.tiersAutorise?.nom ? `<p class="bandeau bandeau-vert">${ic('ajoutPers', 'ic-sm')}<span><b>${esc(c.tiersAutorise.nom)}</b> peut retirer ce colis.</span></p>` : ''}
        ${peutAutoriser ? `<button class="btn btn-plein" data-tiers>${ic('ajoutPers', 'ic-sm')} Envoyer quelqu'un à ma place</button>` : ''}

        <section class="carte pile" style="--gap:2px">
          <h3 style="margin-bottom:6px">Détails</h3>
          ${ligneInfo('De', complet ? esc(c.expediteur?.nom || '') : '')}
          ${ligneInfo('Pour', esc(complet ? c.destinataire?.nom || '' : c.destinataire || ''))}
          ${ligneInfo('Trajet', `${esc(agDepart?.nom || nomPays(pd))} → ${esc(g?.nom || nomPays(pa))}`)}
          ${ligneInfo('Transport', `${esc(modeInfo?.label || '')}${modeInfo?.delai ? ` · ${esc(modeInfo.delai)}` : ''}`)}
          ${ligneInfo('Contenu', esc(contenu))}
          ${ligneInfo('Lot', c.lotCode ? esc(c.lotCode) : '')}
          ${ligneInfo('Réservé le', c.createdAt ? esc(date(c.createdAt, false)) : '')}
        </section>

        <div data-notifs-suivi></div>

        ${complet && !['reserve', 'annule'].includes(c.statut) ? `
        <div class="carte pile" style="--gap:6px" data-factures><h3>Factures</h3><p class="petit muet">Chargement…</p></div>
        <div data-reclamations></div>` : ''}

        <section class="carte">
          <div class="ligne entre" style="margin-bottom:12px"><h3>Historique</h3>${historique.length > 3 ? `<button type="button" class="btn-lien petit" data-tout-historique>Tout voir (${historique.length})</button>` : ''}</div>
          <div class="frise" data-frise>
            ${historique.map((h, k) => `
              <div class="etape ${k >= 3 ? 'cache' : ''}"><div class="rail"><div class="point"></div><div class="trait"></div></div>
                <div class="texte"><div class="gras">${esc(h.label)}</div><div class="petit muet">${esc(date(h.le))}${h.detail ? ` · ${esc(h.detail)}` : ''}</div></div>
              </div>`).join('')}
          </div>
        </section>
        ${complet && c.statut === 'reserve' ? `<button class="btn btn-lien" data-annuler>Annuler cette réservation</button>` : ''}
      </div>`;

    main.querySelector('[data-tout-historique]')?.addEventListener('click', (e) => {
      main.querySelectorAll('[data-frise] .etape.cache').forEach(x => x.classList.remove('cache'));
      e.currentTarget.remove();
    });
    main.querySelector('[data-partager2]')?.addEventListener('click', () => main.querySelector('[data-partager]').click());
    main.querySelector('[data-memo-retour]')?.addEventListener('click', () => stock.ecrire('retour', location.hash));
    main.querySelector('[data-partager]').addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#/suivi/${c.numeroSuivi}`;
      const texte = `Suivi du colis ${c.numeroSuivi}`;
      if (navigator.share) { try { await navigator.share({ title: texte, text: texte, url }); } catch {} }
      else { window.open(lienWhatsApp('', `${texte} : ${url}`), '_blank', 'noopener'); }
    });
    main.querySelector('[data-tiers]')?.addEventListener('click', () => autoriserTiers(c));
    main.querySelector('[data-livraison]')?.addEventListener('click', (e) => demanderLivraison(c, liv, e.currentTarget.dataset.livraison));
    if (complet && !['reserve', 'annule'].includes(c.statut) && !horsLigne) chargerFacturesEtReclamations(c);
    if (complet && !['remis', 'annule'].includes(c.statut)) K.notifications.carte(main.querySelector('[data-notifs-suivi]'), { texte: 'Être prévenu dès que ce colis arrive et recevoir le code ici.' });
    main.querySelector('[data-payer]')?.addEventListener('click', () => ouvrirPaiement(c.numeroSuivi, { objet: 'solde', c }));
    main.querySelectorAll('[data-payer-domicile]').forEach(b => b.addEventListener('click', () => ouvrirPaiement(c.numeroSuivi, { objet: 'domicile', c })));
    main.querySelector('[data-annuler]')?.addEventListener('click', async () => {
      if (!confirm('Annuler cette réservation ?')) return;
      try { await api.del(`/colis/${c.numeroSuivi}`); toast('Réservation annulée.', 'ok'); router(); }
      catch (e) { toast(e.message, 'erreur'); }
    });
  }

  // ── Factures et réclamations d'un colis (compte connecté) ──
  async function chargerFacturesEtReclamations(c) {
    const zf = main.querySelector('[data-factures]');
    const zr = main.querySelector('[data-reclamations]');
    try {
      const [{ factures }, { reclamations }] = await Promise.all([api.get(`/factures/colis/${c.numeroSuivi}`), api.get('/reclamations')]);
      zf.innerHTML = `<h3>Factures</h3>${factures.length ? factures.map(f => `
        <a class="ligne-facture" href="${esc(K.lienFacture(f))}" target="_blank" rel="noopener">
          ${ic('liste', 'ic-sm')}
          <span class="grandit"><span class="gras">${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${esc(f.numero)}</span><span class="tres-petit muet" style="display:block">${esc(date(f.date, false))} · ${esc(K.ETATS_FACTURE[f.etat] || '')}</span></span>
          <span class="gras chiffres">${montant(f.totalTTC, f.devise)}</span>
        </a>`).join('') : '<p class="petit muet">La facture est émise au dépôt ou à la remise du colis.</p>'}`;
      const miennes = reclamations.filter(r => r.numeroSuivi === c.numeroSuivi);
      const ouverte = miennes.find(r => ['ouverte', 'en_cours'].includes(r.statut));
      zr.innerHTML = `
        ${miennes.map(r => `<a class="carte ligne entre" href="#/reclamation/${esc(r.numero)}" style="text-decoration:none;color:inherit">
          <span><span class="gras">Réclamation ${esc(r.numero)}</span><span class="tres-petit muet" style="display:block">${esc(LIB_MOTIF[r.motif] || r.motif)}</span></span>
          <span class="badge b-${esc(r.statut)}">${esc(LIB_REC[r.statut])}</span></a>`).join('')}
        ${ouverte ? '' : `<button class="btn btn-plein" data-signaler>${ic('alerte', 'ic-sm')} Signaler un problème</button>`}`;
      zr.querySelector('[data-signaler]')?.addEventListener('click', () => signalerProbleme(c));
    } catch (e) { zf.innerHTML = '<h3>Factures</h3><p class="petit muet">Indisponibles pour le moment.</p>'; }
  }

  const LIB_MOTIF = { perdu: 'Colis perdu', abime: 'Colis abîmé', incomplet: 'Contenu manquant', retard: 'Retard important', autre: 'Autre problème' };
  const LIB_REC = { ouverte: 'Envoyée', en_cours: 'En cours d\'examen', acceptee: 'Acceptée', refusee: 'Refusée', close: 'Close' };

  function signalerProbleme(c) {
    const photos = [];
    const l = CONFIG.litiges || {};
    const { el, fermer } = modale(`
      <form class="pile" style="--gap:12px" novalidate>
        <div class="ligne entre"><h2>Signaler un problème</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        <p class="petit muet">Colis ${esc(c.numeroSuivi)}. Pour un colis abîmé ou incomplet : dans les ${esc(l.delaiAbimeJours ?? 3)} jours après la remise, avec des photos. Gardez l'emballage.</p>
        <div class="grille-2">${Object.entries(LIB_MOTIF).map(([k, v]) => `<button type="button" class="choix choix-noir" style="min-height:52px" data-motif="${k}"><span class="nom">${esc(v)}</span></button>`).join('')}</div>
        <label class="champ">Que s'est-il passé ? <textarea class="saisie" name="description" rows="4" required placeholder="Décrivez le problème : ce qui manque, ce qui est cassé…"></textarea></label>
        <div class="pile" style="--gap:6px">
          <span class="gras petit">Photos (4 maximum)</span>
          <div class="vignettes" data-vignettes></div>
          <label class="btn btn-plein">${ic('plus', 'ic-sm')} Ajouter une photo<input type="file" accept="image/*" capture="environment" data-photo hidden></label>
        </div>
        <div class="grille-2">
          <label class="champ">Montant demandé (facultatif) <input class="saisie" name="montant" type="number" inputmode="decimal" min="0"></label>
          <label class="champ">Devise <select class="saisie" name="devise"><option value="EUR">€</option><option value="GNF">GNF</option></select></label>
        </div>
        <button class="btn btn-principal btn-grand" type="submit">Envoyer la réclamation</button>
      </form>`);
    let motif = '';
    el.querySelectorAll('[data-motif]').forEach(b => b.addEventListener('click', () => {
      motif = b.dataset.motif;
      el.querySelectorAll('[data-motif]').forEach(x => x.setAttribute('aria-pressed', x === b));
    }));
    el.querySelector('[data-photo]').addEventListener('change', async (e) => {
      const fichier = e.target.files[0]; e.target.value = '';
      if (!fichier) return;
      if (photos.length >= 4) { toast('4 photos maximum.', 'erreur'); return; }
      try {
        const d = await K.photoReduite(fichier);
        photos.push(d);
        el.querySelector('[data-vignettes]').insertAdjacentHTML('beforeend', `<img src="${d}" alt="Photo ${photos.length}">`);
      } catch (err) { toast(err.message, 'erreur'); }
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (!motif) { toast('Choisissez le problème.', 'erreur'); return; }
      if ((f.get('description') || '').trim().length < 10) { toast('Décrivez le problème en quelques mots.', 'erreur'); return; }
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const r = await api.post('/reclamations', { numero: c.numeroSuivi, motif, description: f.get('description'), montantDemande: f.get('montant'), deviseDemande: f.get('devise'), photos }, { delai: 60000 });
        fermer(); toast(`Réclamation ${r.reclamation.numero} envoyée. Nous vous répondons sous 30 jours.`, 'ok');
        location.hash = `#/reclamation/${r.reclamation.numero}`;
      } catch (err) { toast(err.message, 'erreur'); btn.disabled = false; }
    });
  }

  async function reclamation(numero) {
    if (!exigerConnexion()) return;
    const { reclamation: r } = await api.get(`/reclamations/${numero}`);
    const d = r.decision;
    main.innerHTML = `
      <div class="pile">
        <div class="ligne"><a href="#/suivi/${esc(r.numeroSuivi)}" class="btn btn-rond" aria-label="Retour">${ic('retour')}</a>
          <div class="grandit"><div class="tres-petit muet">Réclamation · colis ${esc(r.numeroSuivi)}</div><div class="titre" style="font-size:19px;font-weight:700">${esc(r.numero)}</div></div>
          <span class="badge b-${esc(r.statut)}">${esc(LIB_REC[r.statut])}</span></div>
        <div class="carte pile" style="--gap:6px">
          <div class="gras">${esc(LIB_MOTIF[r.motif] || r.motif)}</div>
          ${r.montantDemande ? `<div class="petit muet">Montant demandé : ${montant(r.montantDemande, r.deviseDemande || 'EUR')}</div>` : ''}
          ${r.photos?.length ? `<div class="vignettes">${r.photos.map(id => `<img data-photo-id="${esc(id)}" alt="Photo jointe">`).join('')}</div>` : ''}
        </div>
        ${d?.type ? `<div class="carte-vert pile" style="--gap:6px"><div class="gras">${d.type === 'refus' ? 'Réclamation refusée' : `${d.type === 'avoir' ? 'Remboursement' : 'Indemnisation'} : ${montant(d.montant, d.devise)}`}</div><div class="petit">${esc(d.motif || '')}</div></div>` : ''}
        <h3>Échanges</h3>
        <div class="pile" style="--gap:8px">${r.suivi.map(s => `<div class="message-rec ${s.auteur}"><div class="tres-petit muet">${s.auteur === 'tms' ? 'TMS' : 'Vous'} · ${esc(date(s.le))}</div><div>${esc(s.texte)}</div></div>`).join('')}</div>
        ${['ouverte', 'en_cours'].includes(r.statut) ? `
        <form class="ligne" style="--gap:8px" data-message>
          <input class="saisie grandit" name="texte" placeholder="Ajouter une précision…" autocomplete="off">
          <button class="btn btn-noir">Envoyer</button>
        </form>` : ''}
      </div>`;
    main.querySelectorAll('[data-photo-id]').forEach(img => K.afficherPhoto(img, img.dataset.photoId));
    main.querySelector('[data-message]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = e.target.texte.value.trim(); if (!t) return;
      try { await api.post(`/reclamations/${numero}/message`, { texte: t }); router(); } catch (err) { toast(err.message, 'erreur'); }
    });
  }

  function pageLegale(titre, html) {
    main.innerHTML = `<div class="pile texte-legal"><div class="ligne"><button class="btn btn-rond" data-retour aria-label="Retour">${ic('retour')}</button><h1 class="grandit" style="font-size:24px">${esc(titre)}</h1></div>${html}${mentions()}</div>`;
    main.querySelector('[data-retour]').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));
  }

  // ── Courses à domicile sur la page de suivi ──
  const LIB_COURSE = { a_planifier: 'Livreur bientôt choisi', assignee: 'Livreur choisi', en_route: 'Livreur en route', faite: 'Fait' };
  function carteCourses(c, ram, liv) {
    const blocs = [];
    const enVerif = c.paiementEnVerification || (c.declarations || []).some(d => d.statut === 'a_verifier' && d.objet === 'domicile');
    // Paiement d'avance de la course : payée, en vérification, ou bouton pour payer
    const etatPaiement = (x) => {
      if (!x?.prixGnf || x.statut === 'faite') return '';
      if ((x.payeGnf || 0) >= x.prixGnf) return `<p class="petit" style="color:var(--vert);font-weight:600">${ic('ok', 'ic-sm')} Payée</p>`;
      if (enVerif) return `<p class="bandeau bandeau-ocre">${ic('horloge', 'ic-sm')}<span>Paiement en cours de vérification.</span></p>`;
      if (['remis', 'annule'].includes(c.statut)) return '';
      return `<div class="a-payer"><span><b>À payer : ${esc(montant(x.prix, x.devise))}</b><br><span class="tres-petit">La course est programmée dès le paiement.</span></span><button class="btn btn-principal btn-petit" data-payer-domicile>Payer</button></div>`;
    };
    if (ram) {
      blocs.push(`
        <div class="carte pile" style="--gap:6px">
          <div class="ligne entre"><h3>${ic('moto', 'ic-sm')} Ramassage à domicile</h3><span class="badge">${esc(ram.statut === 'faite' ? 'Ramassé' : LIB_COURSE[ram.statut] || '')}</span></div>
          <p class="petit">${esc(ram.quartier || '')}${ram.prix ? ` · ${esc(montant(ram.prix, ram.devise))}` : ''}${ram.livreur ? ` · ${esc(ram.livreur)}` : ''}</p>
          ${etatPaiement(ram)}
          ${ram.statut !== 'faite' ? '<p class="tres-petit muet">Le livreur vous appelle avant de passer. Le colis sera pesé à l\'agence.</p>' : ''}
        </div>`);
    }
    const ouvert = !['remis', 'annule', 'en_livraison'].includes(c.statut);
    if (liv) {
      blocs.push(`
        <div class="carte pile" style="--gap:8px">
          <div class="ligne entre"><h3>${ic('moto', 'ic-sm')} Livraison à domicile</h3>${c.statut === 'remis' ? '<span class="badge">Livré</span>' : liv.statut === 'en_route' ? '<span class="badge">En route</span>' : ''}</div>
          <p class="petit">${esc(liv.quartier || '')}${liv.prix ? ` · ${esc(montant(liv.prix, liv.devise))} (${esc(String(liv.distanceKm).replace('.', ','))} km)` : ''}${liv.livreur ? ` · ${esc(liv.livreur)}` : ''}</p>
          ${etatPaiement(liv)}
          ${!liv.aPosition && ouvert ? `
            <p class="bandeau bandeau-ocre">${ic('gps', 'ic-sm')}<span>Il manque la position exacte du destinataire pour calculer le prix et lui livrer le colis.</span></p>
            <button class="btn btn-principal btn-plein" data-livraison="position">${ic('gps', 'ic-sm')} Envoyer la position</button>` : ''}
          ${liv.aPosition && ouvert ? `<button class="btn btn-lien" data-livraison="modifier">Changer l'adresse ou venir le retirer à l'agence</button>` : ''}
        </div>`);
    } else if (ouvert) {
      const g = agence(typeof c.guichet === 'string' ? c.guichet : c.guichet?.code);
      const dispo = g && KolisTarif.calculerCourse(CONFIG.regles, g, { lat: g.position?.lat ?? 1, lng: g.position?.lng ?? 1 });
      if (dispo && (dispo.ok || dispo.raison === 'trop_loin')) {
        blocs.push(`<button class="btn btn-plein" data-livraison="demander">${ic('moto', 'ic-sm')} Me faire livrer à domicile</button>`);
      }
    }
    return blocs.join('');
  }

  // Le destinataire (ou l'expéditeur) envoie la position / demande la livraison, prouvé par son numéro
  function demanderLivraison(c, liv, action) {
    const u = session.utilisateur();
    const codeAgence = typeof c.guichet === 'string' ? c.guichet : c.guichet?.code;
    const { el, fermer } = modale(`
      <form class="pile" style="--gap:14px" novalidate>
        <div class="ligne entre"><h2>${action === 'demander' ? 'Livraison à domicile' : 'Adresse de livraison'}</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        <label class="champ">Votre numéro de téléphone <span class="tres-petit muet">(celui du destinataire sur le colis)</span>
          <input class="saisie" name="telephone" type="tel" inputmode="tel" required value="${esc(u?.telephone || '')}"></label>
        ${K.champsAdresse('d', { quartier: liv?.quartier }, { maPosition: true })}
        <button class="btn btn-principal btn-grand" type="submit">Valider</button>
        ${action === 'modifier' ? '<button class="btn btn-lien" type="button" data-annuler-liv>Je viendrai plutôt le retirer à l\'agence</button>' : ''}
      </form>`);
    const adr = K.brancherAdresse(el, 'd', { agence: () => agence(codeAgence), config: CONFIG });
    const envoyer = async (corps, payerEnsuite) => {
      try {
        await api.post(`/colis/${c.numeroSuivi}/livraison`, corps);
        fermer(); toast(corps.demande === false ? 'Livraison annulée : retrait à l\'agence.' : 'Adresse enregistrée.', 'ok'); await router();
        if (payerEnsuite) ouvrirPaiement(c.numeroSuivi, { objet: 'domicile', c });
      } catch (err) { toast(err.message, 'erreur'); }
    };
    el.querySelector('[data-annuler-liv]')?.addEventListener('click', () => {
      const tel = el.querySelector('[name=telephone]').value;
      if (!tel) { toast('Indiquez votre numéro.', 'erreur'); return; }
      envoyer({ telephone: normTel(tel), demande: false });
    });
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const a = adr.lire();
      const tel = el.querySelector('[name=telephone]').value;
      if (!tel) { toast('Indiquez votre numéro de téléphone (celui du destinataire sur le colis).', 'erreur'); return; }
      if (!a.position && !confirm('Sans votre position, le prix de la livraison ne peut pas être calculé et le livreur devra vous appeler. Enregistrer quand même ?')) return;
      const course = adr.course();
      if (course && !course.ok) { toast(course.message, 'erreur'); return; }
      if (course && !confirm(`Livraison : ${montant(course.prix, course.devise)} (${course.distanceKm.toLocaleString('fr-FR')} km), à payer en ligne maintenant. Une livraison payée n'est pas remboursée si vous l'annulez. Continuer ?`)) return;
      envoyer({ telephone: normTel(tel), demande: true, adresse: a }, true);
    });
  }

  function titreStatut(c, g) {
    const nom = g?.nom || 'votre agence';
    const pays = nomPays(paysArrivee(c));
    const en = paysArrivee(c) === 'FR' ? 'en France' : 'en Guinée';
    switch (c.statut) {
      case 'reserve': return c.ramassage && c.ramassage.statut !== 'annulee' && c.ramassage.demande !== false
        ? (c.ramassage.statut === 'faite' ? 'Ramassé, en route vers l\'agence' : 'Réservé : un livreur vient le chercher')
        : 'Réservé : à déposer en agence';
      case 'depose': return 'Reçu en agence, bientôt en route';
      case 'charge': return `Chargé, départ ${c.mode === 'mer' ? 'en bateau' : c.mode === 'express' ? 'en express' : 'en avion'} prochainement`;
      case 'en_transit': return `En route vers ${pays === 'France' ? 'la France' : 'la Guinée'} ${c.mode === 'mer' ? 'par bateau' : c.mode === 'express' ? 'en express' : 'par avion'}`;
      case 'arrive': return `Arrivé ${en}, en cours de dédouanement`;
      case 'acheminement': return `En route vers ${nom}${g?.ville ? ` (${g.ville})` : ''}`;
      case 'pret': return c.livraison && c.livraison.statut !== 'annulee' && c.livraison.demande !== false ? `Arrivé à ${nom}, bientôt livré chez vous` : `Votre colis vous attend à ${nom}`;
      case 'en_livraison': return 'Le livreur arrive avec votre colis';
      case 'remis': return 'Colis remis. Merci !';
      default: return c.statutLabel;
    }
  }

  function autoriserTiers(c) {
    const { el, fermer } = modale(`
      <form class="pile" style="--gap:14px">
        <div class="ligne entre"><h2>Qui vient retirer ?</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        <p class="petit muet">Cette personne recevra le code de retrait par SMS. Elle devra montrer sa pièce d'identité.</p>
        <label class="champ">Nom complet <input class="saisie" name="nom" required autocomplete="name"></label>
        <label class="champ">Téléphone <input class="saisie" name="telephone" type="tel" inputmode="tel" required placeholder="6XX XX XX XX"></label>
        <button class="btn btn-principal btn-grand" type="submit">Autoriser</button>
      </form>`);
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api.patch(`/colis/${c.numeroSuivi}/tiers`, { nom: f.get('nom'), telephone: normTel(f.get('telephone')) });
        fermer(); toast('Personne autorisée. Elle va recevoir un SMS.', 'ok'); router();
      } catch (err) { toast(err.message, 'erreur'); }
    });
  }

  // ── Paiement en ligne : solde du colis, ou courses à domicile payées d'avance ──
  // Moyens proposés selon le pays d'où l'on paie : carte (Stripe) en France,
  // Orange Money / MTN MoMo (et carte) en Guinée, réglés dans le back-office.
  const PAYS_DRAPEAU = { FR: 'France', GN: 'Guinée' };
  async function ouvrirPaiement(numero, { objet, c } = {}) {
    let r;
    try { r = await api.get(`/paiements/a-payer/${encodeURIComponent(numero)}`); }
    catch (err) { toast(err.message, 'erreur'); return; }
    const choix = objet === 'domicile' || (r.domicile.gnf > 0 && !(r.solde.gnf > 0)) ? 'domicile' : 'solde';
    const du = choix === 'domicile' ? r.domicile : r.solde;
    const [depart, arrivee] = String(r.sens || 'FR-GN').split('-');
    const u = session.utilisateur();
    const estDestinataire = u && c?.destinataire?.telephone === u.telephone;
    // Le pays de la personne qui paie passe en premier
    const paysPayeur = estDestinataire || (choix === 'solde' && r.payeurArrivee) ? arrivee : depart;
    const pays = [paysPayeur, paysPayeur === depart ? arrivee : depart];
    const enAttente = r.enAttente.filter(d => d.objet === (choix === 'domicile' ? 'domicile' : 'global'));
    if (!(du.gnf > 0)) {
      toast(enAttente.length ? 'Votre paiement est en cours de vérification.' : 'Rien à payer pour le moment.', enAttente.length ? '' : 'ok');
      return;
    }
    const groupe = (p) => {
      const liste = r.moyens[p] || [];
      if (!liste.length) return '';
      return `<div class="pile" style="--gap:8px">
        <div class="tres-petit gras muet">Je paie depuis ${p === 'FR' ? 'la France' : 'la Guinée'}</div>
        ${liste.map(m => `<button type="button" class="moyen-paiement" data-moyen="${m.key}">
          <span class="logo-moyen ${m.key}" aria-hidden="true">${m.key === 'carte' ? ic('carte') : m.key === 'orange_money' ? 'OM' : 'MoMo'}</span>
          <span class="grandit"><span class="gras" style="display:block">${esc(m.label)}</span><span class="petit muet">${m.devise === 'EUR' ? `${eur(du.eur)} · paiement sécurisé` : `${gnf(du.gnf)} · validé sous 24 h`}</span></span>
          ${ic('suivant', 'ic-sm')}
        </button>`).join('')}
      </div>`;
    };
    const blocs = [...new Set(pays)].map(groupe).filter(Boolean);
    // Montant affiché en grand dans la devise du premier moyen proposé
    const premier = [...new Set(pays)].flatMap(p => r.moyens[p] || [])[0];
    const enGnfD = premier ? premier.devise === 'GNF' : paysPayeur === 'GN';
    const { el, fermer } = modale(`
      <div class="pile" style="--gap:16px" data-etape-paiement>
        <div class="ligne entre"><h2>${choix === 'domicile' ? 'Payer la livraison' : 'Payer le colis'}</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        <div class="carte-noire pile" style="--gap:2px">
          <div class="petit" style="color:var(--gris)">${choix === 'domicile' ? 'Ramassage / livraison à domicile' : 'Reste à payer'} · ${esc(numero)}</div>
          <div class="prix-gnf">${enGnfD ? gnf(du.gnf) : eur(du.eur)}</div>
          <div class="petit">soit ${enGnfD ? eur(du.eur) : gnf(du.gnf)}</div>
        </div>
        ${enAttente.length ? `<p class="bandeau bandeau-ocre">${ic('horloge', 'ic-sm')}<span>Un paiement de ${gnf(enAttente[0].montantGnf)} (réf. ${esc(enAttente[0].reference)}) est déjà en vérification.</span></p>` : ''}
        ${blocs.length ? blocs.join('') : '<p class="bandeau bandeau-ocre">Le paiement en ligne n\'est pas encore ouvert. Payez à l\'agence.</p>'}
        ${choix === 'domicile'
          ? '<p class="tres-petit muet">Le ramassage ou la livraison est programmé dès le paiement reçu. Une course payée n\'est pas remboursée si vous l\'annulez ensuite.</p>'
          : `<p class="tres-petit muet">${ic('billet', 'ic-sm')} Vous pouvez aussi payer en espèces à l'agence.</p>`}
      </div>`);
    el.querySelectorAll('[data-moyen]').forEach(b => b.addEventListener('click', async () => {
      const m = b.dataset.moyen;
      if (m === 'carte') {
        b.disabled = true;
        try { const s2 = await api.post('/paiements/creer-session', { numero, objet: choix }); location.href = s2.url; }
        catch (err) { toast(err.message, 'erreur'); b.disabled = false; }
        return;
      }
      const moyen = Object.values(r.moyens).flat().find(x => x.key === m);
      const zone = el.querySelector('[data-etape-paiement]');
      zone.innerHTML = `
        <div class="ligne entre"><h2>${esc(moyen.label)}</h2><button type="button" class="btn btn-rond" data-fermer2 aria-label="Fermer">${ic('fermer')}</button></div>
        <ol class="etapes-paiement">
          <li>Envoyez <b>${gnf(du.gnf)}</b> par ${esc(moyen.label)} au <b class="chiffres">${esc(moyen.numero)}</b>${moyen.titulaire ? ` (${esc(moyen.titulaire)})` : ''}.
            <button type="button" class="btn btn-petit" data-copier="${esc(moyen.numero)}" style="margin-top:6px">${ic('copier', 'ic-sm')} Copier le numéro</button></li>
          <li>Notez la <b>référence de la transaction</b> dans le SMS de confirmation.</li>
          <li>Écrivez-la ci-dessous : nous vérifions et vous prévenons par SMS.</li>
        </ol>
        <form class="pile" style="--gap:10px" novalidate>
          <label class="champ">Référence de la transaction <input class="saisie saisie-forte" name="reference" required autocomplete="off" autocapitalize="characters" placeholder="Ex. PP231015.1432.C12345"></label>
          <label class="champ">Numéro qui a payé <input class="saisie" name="telephone" type="tel" inputmode="tel" value="${esc(u?.telephone || '')}" placeholder="6XX XX XX XX"></label>
          <button class="btn btn-principal btn-grand" type="submit">J'ai payé, envoyer la référence</button>
        </form>`;
      zone.querySelector('[data-fermer2]').addEventListener('click', fermer);
      zone.querySelector('[data-copier]').addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(e.currentTarget.dataset.copier); toast('Numéro copié.', 'ok'); } catch { toast(moyen.numero); }
      });
      zone.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
        try {
          await api.post('/paiements/mobile', { numero, objet: choix === 'domicile' ? 'domicile' : 'global', methode: m, reference: f.get('reference'), telephone: f.get('telephone') });
          zone.innerHTML = `
            <div class="pile centre" style="--gap:12px;padding:12px 0">
              <span class="pastille-notif" style="margin:0 auto">${ic('horloge')}</span>
              <h2>Paiement en vérification</h2>
              <p class="petit">Nous vérifions la réception de <b>${gnf(du.gnf)}</b> sur notre compte ${esc(moyen.label)}. Vous recevez un SMS dès que c'est validé (en général dans la journée).</p>
              <button class="btn btn-principal btn-plein" type="button" data-ok>Compris</button>
            </div>`;
          zone.querySelector('[data-ok]').addEventListener('click', () => { fermer(); router(); });
        } catch (err) { toast(err.message, 'erreur'); btn.disabled = false; }
      });
    }));
  }

  // ════════════════════════════════════════════════════════
  //  ENVOYER : estimation + réservation
  // ════════════════════════════════════════════════════════
  async function envoyer() {
    const defaut = { sens: 'FR-GN', mode: 'air', poids: 5, type: 'vetements', assurance: false, valeur: '', depart: 'agence', arrivee: 'agence', articles: {} };
    const etat = { ...defaut, ...(stock.lire('brouillon_envoi') || {}) };
    if (!etat.articles || typeof etat.articles !== 'object') etat.articles = {};
    // Articles à la pièce proposés pour ce sens et ce mode (ceux qui ont un prix)
    const articlesDispo = () => (CONFIG.articles || []).filter(a => Number.isFinite(parseFloat(a.prix?.[etat.sens]?.[etat.mode])));
    const articlesChoisis = () => articlesDispo().filter(a => etat.articles[a.cle] > 0).map(a => ({ cle: a.cle, quantite: etat.articles[a.cle] }));
    const poidsArticles = () => articlesDispo().reduce((s, a) => s + (etat.articles[a.cle] || 0) * (parseFloat(a.poids) || 0), 0);
    const nombreFr = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
    if (!CONFIG.sens.some(s => s.key === etat.sens)) etat.sens = 'FR-GN';
    const types = CONFIG.typesColis;
    const sensInfo = () => CONFIG.sens.find(s => s.key === etat.sens);
    const brouillonAdr = stock.lire('brouillon_adresses') || {};
    const optionsAgences = (pays) => {
      const parVille = {};
      agencesDe(pays).forEach(a => { (parVille[a.ville || '—'] = parVille[a.ville || '—'] || []).push(a); });
      return Object.entries(parVille).map(([ville, liste]) => `<optgroup label="${esc(ville)}">${liste.map(a => `<option value="${esc(a.code)}">${esc(a.nom)}${a.commune ? ` (${esc(a.commune)})` : ''}</option>`).join('')}</optgroup>`).join('');
    };

    main.innerHTML = `
      <div class="pile envoyer-grille">
        <div class="ligne"><a href="#/" class="btn btn-rond" aria-label="Retour">${ic('retour')}</a><h1 style="font-size:24px">Envoyer un colis</h1></div>

        <section class="pile" style="--gap:8px" aria-labelledby="q0">
          <h3 id="q0">1. Dans quel sens ?</h3>
          <div class="grille-2">${CONFIG.sens.map(s => `
            <button type="button" class="choix choix-noir" style="min-height:72px" data-sens="${s.key}" aria-pressed="${etat.sens === s.key}">
              <span class="nom" style="font-size:16px">${esc(nomPays(s.depart))}</span>
              <span class="sous">vers ${esc(nomPays(s.arrivee))}</span>
            </button>`).join('')}
          </div>
        </section>

        <section class="pile" style="--gap:8px" aria-labelledby="q1">
          <h3 id="q1">2. Comment l'envoyer ?</h3>
          <div class="grille-3">${CONFIG.modes.map(m => `
            <button type="button" class="choix" style="min-height:112px;justify-content:space-between" data-mode="${m.key}" aria-pressed="${etat.mode === m.key}">
              ${icMode(m.key).replace('class="ic ', 'class="ic ic-lg ')}
              <span class="nom" style="font-size:17px">${esc(m.label)}</span>
              <span class="sous">${esc(m.delai)}</span>
            </button>`).join('')}
          </div>
        </section>

        <section class="pile" style="--gap:8px" aria-labelledby="q2">
          <h3 id="q2">3. Ce que vous envoyez</h3>
          <div class="carte pile">
            <div class="ligne entre" style="align-items:flex-start">
              <div><div class="gras">Au kilo</div><div class="tres-petit muet">Vêtements, vivres, affaires…</div></div>
              <span class="tres-petit muet" style="text-align:right" data-note-poids></span>
            </div>
            <div class="pas-a-pas">
              <button type="button" class="btn" data-moins aria-label="Un kilo de moins">−</button>
              <label class="saisie-poids"><input type="text" inputmode="decimal" autocomplete="off" data-poids aria-label="Poids en kilos" placeholder="0"><span>kg</span></label>
              <button type="button" class="btn" data-plus aria-label="Un kilo de plus">+</button>
            </div>
            <div class="ligne" style="--gap:6px;flex-wrap:wrap">${[2, 5, 10, 20, 30].map(k => `<button type="button" class="choix choix-noir" style="min-height:44px;flex:1;align-items:center;padding:0 4px;white-space:nowrap;font-weight:600" data-preset="${k}">${k} kg</button>`).join('')}</div>
          </div>
          <div class="carte pile" style="--gap:2px" data-bloc-articles>
            <div class="gras">À la pièce</div>
            <div class="tres-petit muet" style="margin-bottom:6px">Prix fixe par article, quel que soit le reste du colis. Ne comptez pas ces articles dans le poids au kilo.</div>
            <div class="pile" style="--gap:0" data-articles></div>
          </div>
        </section>

        <section class="pile" style="--gap:8px" aria-labelledby="q3">
          <h3 id="q3">4. Type d'affaires au kilo</h3>
          <div class="grille-3">${types.map(t => `
            <button type="button" class="choix choix-ocre" style="align-items:center;text-align:center;min-height:68px" data-type="${t.key}" aria-pressed="${etat.type === t.key}">
              <span class="nom" style="font-size:15px">${esc(t.label)}</span>${t.surcharge ? `<span class="sous">+${Math.round(t.surcharge * 100)} %</span>` : ''}
            </button>`).join('')}
          </div>
          <label class="case"><input type="checkbox" data-assurance ${etat.assurance ? 'checked' : ''}> Assurer le colis (${(CONFIG.tauxAssurance * 100).toLocaleString('fr-FR')} % de la valeur)</label>
          <label class="champ ${etat.assurance ? '' : 'cache'}" data-champ-valeur><span data-lib-valeur>Valeur du contenu</span>
            <input class="saisie" type="number" inputmode="decimal" min="0" data-valeur value="${esc(etat.valeur)}">
          </label>
        </section>

        <div class="carte-noire pile colonne-prix" style="--gap:4px" aria-live="polite">
          <div class="petit" style="color: var(--gris)">Prix estimé</div>
          <div class="prix-gnf" data-prix-principal></div>
          <div data-prix-autre></div>
          <div class="petit" data-prix-detail style="color: var(--gris)"></div>
          <div class="petit" data-prix-domicile style="color: var(--gris)"></div>
          <div style="height:1px;background: var(--ligne-2);margin:10px 0 6px"></div>
          <div class="ligne tres-petit" style="color: var(--gris);align-items:flex-start">${ic('balance', 'ic-sm')}<span>Le prix final est fixé à la pesée en agence. Taux : 1 € = ${gnf(CONFIG.tauxEurGnf)}, bloqué sur votre reçu.</span></div>
        </div>

        <form class="pile" style="--gap:12px" data-form novalidate>
          <h3>5. Départ du colis</h3>
          <div class="grille-2">
            <button type="button" class="choix choix-noir" style="min-height:72px" data-depart="agence">${ic('maison', 'ic-sm')}<span class="nom">Je dépose en agence</span><span class="sous">Gratuit</span></button>
            <button type="button" class="choix choix-noir" style="min-height:72px" data-depart="domicile">${ic('moto', 'ic-sm')}<span class="nom">On vient chercher</span><span class="sous" data-sous-ram>Ramassage chez moi</span></button>
          </div>
          <label class="champ"><span data-lib-depot>Je dépose le colis à</span> <select class="saisie" name="depot" required data-select-depot></select></label>
          <div class="pile cache" style="--gap:10px" data-zone-ram>
            ${K.champsAdresse('ram', brouillonAdr.ram || {}, { maPosition: true })}
            <div class="grille-2">
              <label class="champ">Quel jour ? <input class="saisie" type="date" name="ram_jour" min="${new Date().toISOString().slice(0, 10)}"></label>
              <label class="champ">Moment <select class="saisie" name="ram_moment">${(CONFIG.moments || []).map(m => `<option value="${m.key}">${esc(m.label)}</option>`).join('')}</select></label>
            </div>
            <p class="tres-petit muet">Le livreur vous appelle avant de passer. Le colis est pesé à l'agence et vous payez là-bas (ou le destinataire à l'arrivée).</p>
          </div>

          <h3>6. Arrivée</h3>
          <div class="grille-2">
            <button type="button" class="choix choix-noir" style="min-height:72px" data-arrivee="agence">${ic('maison', 'ic-sm')}<span class="nom">Retrait en agence</span><span class="sous">Gratuit</span></button>
            <button type="button" class="choix choix-noir" style="min-height:72px" data-arrivee="domicile">${ic('moto', 'ic-sm')}<span class="nom">Livraison à domicile</span><span class="sous" data-sous-liv>Prix selon la distance</span></button>
          </div>
          <label class="champ"><span data-lib-retrait>Retrait à</span> <select class="saisie" name="guichet" required data-select-retrait></select></label>
          <div class="pile cache" style="--gap:10px" data-zone-liv>
            ${K.champsAdresse('liv', brouillonAdr.liv || {}, { maPosition: false, positionFacultative: true, aide: 'Demandez au destinataire de vous envoyer sa localisation sur WhatsApp, puis collez le lien ici. Sinon, il pourra l\'envoyer lui-même depuis la page de suivi.' })}
          </div>

          <h3>7. Pour qui ?</h3>
          <label class="champ">Nom du destinataire <input class="saisie" name="nom" required autocomplete="off"></label>
          <label class="champ"><span data-lib-tel>Son téléphone</span> <input class="saisie" name="telephone" type="tel" inputmode="tel" required></label>
          <label class="champ">Contenu (facultatif) <input class="saisie" name="description" placeholder="Ex. vêtements, pagnes, épices"></label>
          <label class="case"><input type="checkbox" name="payeurArrivee"> Le destinataire paiera à l'arrivée</label>
          <label class="case" style="align-items:flex-start"><input type="checkbox" name="cgv" style="margin-top:2px"> <span>J'accepte les <a href="#/cgv" target="_blank">conditions générales</a> et je confirme que mon colis ne contient aucun <a href="#/interdits" target="_blank">objet interdit</a>.</span></label>
          <button class="btn btn-principal btn-grand btn-plein" type="submit">Réserver mon envoi</button>
          <p class="tres-petit muet centre">Vous recevrez un numéro de suivi à présenter en agence.</p>
        </form>
      </div>`;

    const $ = (s) => main.querySelector(s);
    let sensAffiche = null;
    // Courses à domicile : disponibles si l'agence a une position et le service est ouvert dans le pays
    const dispoDomicile = (code) => {
      const a = agence(code);
      if (!a) return null;
      const r = KolisTarif.calculerCourse(CONFIG.regles, a, { lat: a.position?.lat ?? 1, lng: a.position?.lng ?? 1 });
      return r.ok || r.raison === 'trop_loin' ? null : r.message;
    };
    const adrRam = K.brancherAdresse(main, 'ram', { valeur: brouillonAdr.ram, agence: () => agence($('[name=depot]').value), config: CONFIG, surChange: () => majPrixDomicile() });
    const adrLiv = K.brancherAdresse(main, 'liv', { valeur: brouillonAdr.liv, agence: () => agence($('[name=guichet]').value), config: CONFIG, surChange: () => majPrixDomicile() });
    function majPrixDomicile() {
      const zone = $('[data-prix-domicile]');
      if (!zone) return;
      const lignes = [];
      const ligne = (lib, c, defaut) => lignes.push(`+ ${lib} : ${c?.ok ? `<b>${esc(K.montant(c.prix, c.devise))}</b> (${esc(c.distanceKm.toLocaleString('fr-FR'))} km)` : esc(defaut)}`);
      if (etat.depart === 'domicile') ligne('ramassage', adrRam.course(), 'selon la distance, dès que la position est connue');
      if (etat.arrivee === 'domicile') ligne('livraison', adrLiv.course(), 'selon la distance, dès que la position est connue');
      if (lignes.length) lignes.push('<span class="tres-petit">À payer en ligne juste après la réservation · non remboursable si vous annulez</span>');
      zone.innerHTML = lignes.join('<br>');
    }
    const majDomicile = () => {
      const indispoRam = dispoDomicile($('[name=depot]').value);
      const indispoLiv = dispoDomicile($('[name=guichet]').value);
      if (indispoRam && etat.depart === 'domicile') etat.depart = 'agence';
      if (indispoLiv && etat.arrivee === 'domicile') etat.arrivee = 'agence';
      const bRam = $('[data-depart="domicile"]'), bLiv = $('[data-arrivee="domicile"]');
      bRam.disabled = !!indispoRam; bLiv.disabled = !!indispoLiv;
      $('[data-sous-ram]').textContent = indispoRam ? 'Pas encore ici' : 'Prix selon la distance';
      $('[data-sous-liv]').textContent = indispoLiv ? 'Pas encore ici' : 'Prix selon la distance';
      main.querySelectorAll('[data-depart]').forEach(b => b.setAttribute('aria-pressed', b.dataset.depart === etat.depart));
      main.querySelectorAll('[data-arrivee]').forEach(b => b.setAttribute('aria-pressed', b.dataset.arrivee === etat.arrivee));
      $('[data-zone-ram]').classList.toggle('cache', etat.depart !== 'domicile');
      $('[data-zone-liv]').classList.toggle('cache', etat.arrivee !== 'domicile');
      $('[data-lib-depot]').textContent = etat.depart === 'domicile' ? 'Agence la plus proche de chez vous' : 'Je dépose le colis à';
      $('[data-lib-retrait]').textContent = etat.arrivee === 'domicile' ? 'Agence qui livre (la plus proche du destinataire)' : 'Retrait à';
      adrRam.recalculer(); adrLiv.recalculer();
    };
    const majAgences = () => {
      if (sensAffiche === etat.sens) return;
      sensAffiche = etat.sens;
      const si = sensInfo();
      $('[data-select-depot]').innerHTML = optionsAgences(si.depart);
      $('[data-select-retrait]').innerHTML = optionsAgences(si.arrivee);
      $('[data-lib-tel]').textContent = `Son téléphone en ${nomPays(si.arrivee)}`;
      $('[name=telephone]').placeholder = si.arrivee === 'GN' ? '6XX XX XX XX' : '06 XX XX XX XX';
    };
    const maj = () => {
      stock.ecrire('brouillon_envoi', etat);
      main.querySelectorAll('[data-sens]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sens === etat.sens));
      main.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === etat.mode));
      main.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed', b.dataset.type === etat.type));
      main.querySelectorAll('[data-preset]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.preset) === etat.poids));
      $('[data-champ-valeur]').classList.toggle('cache', !etat.assurance);
      majAgences();
      majDomicile();
      const grille = CONFIG.tarifs[etat.sens];
      const devise = grille.devise;
      const m = grille[etat.mode];
      $('[data-lib-valeur]').textContent = `Valeur du contenu (${devise === 'EUR' ? '€' : 'GNF'})`;
      const champPoids = $('[data-poids]');
      if (document.activeElement !== champPoids) champPoids.value = etat.poids ? nombreFr(etat.poids) : '';
      // Articles à la pièce
      const dispo = articlesDispo();
      $('[data-bloc-articles]').classList.toggle('cache', !dispo.length);
      // La liste n'est reconstruite que si les articles ou leurs prix changent : sinon un clic
      // sur « + » juste après la saisie du poids serait perdu (la liste changerait sous le doigt)
      const signature = JSON.stringify(dispo.map(a => [a.cle, a.label, a.prix[etat.sens][etat.mode]]));
      if ($('[data-articles]').dataset.signature !== signature) {
        $('[data-articles]').dataset.signature = signature;
        $('[data-articles]').innerHTML = dispo.map(a => {
        const q = etat.articles[a.cle] || 0;
        return `<div class="ligne-article${q ? ' choisi' : ''}">
          <div><div class="nom">${esc(a.label)}</div><div class="tres-petit muet">${esc(montant(parseFloat(a.prix[etat.sens][etat.mode]), devise))} la pièce</div></div>
          <div class="compteur">
            <button type="button" class="btn btn-rond" data-art-moins="${esc(a.cle)}" aria-label="Retirer : ${esc(a.label)}" ${q ? '' : 'disabled'}>−</button>
            <span class="gras" aria-live="polite">${q}</span>
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
      const choisis = articlesChoisis();
      const pArt = poidsArticles();
      const t = KolisTarif.calculerTarif(CONFIG.regles, { sens: etat.sens, mode: etat.mode, poidsKg: etat.poids + pArt, typeColis: etat.type, valeurDeclaree: etat.valeur, assurance: etat.assurance, articles: choisis });
      $('[data-note-poids]').innerHTML = !etat.poids
        ? (choisis.length ? 'rien au kilo' : 'Indiquez un poids<br>ou un article')
        : !choisis.length && etat.poids < m.poidsMin ? `${montant(m.prixKg, devise)} le kilo<br>minimum facturé : ${m.poidsMin} kg` : `${montant(m.prixKg, devise)} le kilo`;
      $('[data-prix-principal]').textContent = devise === 'EUR' ? eur(t.totalEur) : gnf(t.totalGnf);
      $('[data-prix-autre]').textContent = `soit ${devise === 'EUR' ? gnf(t.totalGnf) : eur(t.totalEur)}`;
      const detail = [];
      if (t.transport) detail.push(`${nombreFr(t.poidsFacture)} kg au kilo : ${montant(t.transport + t.surcharge, devise)}`);
      t.articles.forEach(l => detail.push(`${l.quantite} × ${l.label.toLowerCase()} : ${montant(l.montant, devise)}`));
      if (t.assurance) detail.push(`assurance : ${montant(t.assurance, devise)}`);
      $('[data-prix-detail]').innerHTML = detail.length > 1 || t.articles.length ? detail.map(esc).join('<br>') : '';
    };
    main.querySelectorAll('[data-sens]').forEach(b => b.addEventListener('click', () => { etat.sens = b.dataset.sens; maj(); }));
    main.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { etat.mode = b.dataset.mode; maj(); }));
    main.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { etat.type = b.dataset.type; maj(); }));
    main.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { etat.poids = Number(b.dataset.preset); maj(); }));
    $('[data-moins]').addEventListener('click', () => { etat.poids = Math.max(0, Math.ceil(etat.poids) - 1); maj(); });
    $('[data-plus]').addEventListener('click', () => { etat.poids = Math.min(500, Math.floor(etat.poids) + 1); maj(); });
    // Poids tapé au clavier (virgule ou point)
    $('[data-poids]').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''));
      etat.poids = Number.isFinite(v) ? Math.min(Math.max(v, 0), 500) : 0;
      maj();
    });
    $('[data-poids]').addEventListener('blur', () => maj());
    $('[data-poids]').addEventListener('focus', (e) => e.target.select());
    $('[data-articles]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-art-plus],[data-art-moins]');
      if (!b) return;
      const cle = b.dataset.artPlus || b.dataset.artMoins;
      const q = (etat.articles[cle] || 0) + (b.dataset.artPlus ? 1 : -1);
      etat.articles = { ...etat.articles, [cle]: Math.min(Math.max(q, 0), 99) };
      if (!etat.articles[cle]) delete etat.articles[cle];
      maj();
    });
    $('[data-assurance]').addEventListener('change', (e) => { etat.assurance = e.target.checked; maj(); });
    $('[data-valeur]').addEventListener('input', (e) => { etat.valeur = e.target.value; maj(); });
    main.querySelectorAll('[data-depart]').forEach(b => b.addEventListener('click', () => { etat.depart = b.dataset.depart; maj(); }));
    main.querySelectorAll('[data-arrivee]').forEach(b => b.addEventListener('click', () => { etat.arrivee = b.dataset.arrivee; maj(); }));
    $('[name=depot]').addEventListener('change', maj);
    $('[name=guichet]').addEventListener('change', maj);
    maj();

    $('[data-form]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (!f.get('nom') || !f.get('telephone')) { toast('Indiquez le nom et le téléphone du destinataire.', 'erreur'); return; }
      const choisis = articlesChoisis();
      const poidsTotal = Math.round((etat.poids + poidsArticles()) * 10) / 10;
      if (!(poidsTotal >= 0.1)) { toast('Indiquez le poids de ce qui est payé au kilo, ou ajoutez un article à la pièce.', 'erreur'); $('[data-poids]').focus(); return; }
      if (f.get('cgv') !== 'on') { toast('Acceptez les conditions générales et confirmez qu\'il n\'y a aucun objet interdit.', 'erreur'); return; }
      const ram = etat.depart === 'domicile' ? adrRam.lire() : null;
      const liv = etat.arrivee === 'domicile' ? adrLiv.lire() : null;
      // Adresse incomplète : on réserve quand même, on prévient seulement
      const manque = [[ram, 'ramassage'], [liv, 'livraison']].filter(([a]) => a && (!a.position || !a.quartier)).map(([, lib]) => lib);
      for (const [c, lib] of [[ram && adrRam.course(), 'ramassage'], [liv && liv.position && adrLiv.course(), 'livraison']]) {
        if (c && !c.ok) { toast(`${lib[0].toUpperCase() + lib.slice(1)} : ${c.message}`, 'erreur'); return; }
      }
      stock.ecrire('brouillon_dest', Object.fromEntries(f));
      stock.ecrire('brouillon_adresses', { ram: ram || brouillonAdr.ram, liv: liv || brouillonAdr.liv });
      if (!exigerConnexion()) return;
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const r = await api.post('/colis', {
          mode: etat.mode, typeColis: etat.type, poidsEstime: poidsTotal, articles: choisis,
          assurance: etat.assurance, valeurDeclaree: parseFloat(etat.valeur) || 0,
          depot: f.get('depot'), guichet: f.get('guichet'),
          description: f.get('description'), payeurArrivee: f.get('payeurArrivee') === 'on', cgvAcceptees: true,
          destinataire: { nom: f.get('nom'), telephone: normTel(f.get('telephone')) },
          ramassage: ram ? { demande: true, adresse: ram, jour: f.get('ram_jour') || undefined, moment: f.get('ram_moment') } : undefined,
          livraison: liv ? { demande: true, adresse: liv } : undefined,
        });
        stock.suppr('brouillon_dest'); stock.suppr('brouillon_adresses');
        if (manque.length) toast(`Réservé. Adresse de ${manque.join(' et ')} à compléter : le prix sera calculé dès que la position sera envoyée.`, '', { duree: 5000 });
        confirmation(r.colis);
      } catch (err) { toast(err.message, 'erreur'); btn.disabled = false; }
    });
    // Formulaire restauré après la connexion
    const brouillon = stock.lire('brouillon_dest');
    if (brouillon) Object.entries(brouillon).forEach(([k, v]) => { const i = $(`[name="${k}"]`); if (i) i.type === 'checkbox' ? (i.checked = v === 'on') : (i.value = v); });
  }

  function confirmation(c) {
    const d = agence(c.depot) || {};
    const r = agence(c.guichet) || {};
    main.innerHTML = `
      <div class="pile">
        <div class="carte-vert pile" style="--gap:10px">
          <span class="badge" style="align-self:flex-start;background:var(--ocre);color:var(--encre)">${ic('ok', 'ic-sm')} Réservé</span>
          <h1>Votre numéro de suivi</h1>
          <div class="titre" style="font-size:34px;font-weight:800;letter-spacing:1px">${esc(c.numeroSuivi)}</div>
          <p>Prix estimé : <b>${prixColis(c.tarif)}</b></p>
        </div>
        ${c.domicileAPayerGnf > 0 ? `
        <div class="carte-ocre pile" style="--gap:8px">
          <h3>${c.ramassage?.demande && c.livraison?.demande && c.livraison?.prix ? 'Payez le ramassage et la livraison' : c.ramassage?.demande ? 'Payez le ramassage' : 'Payez la livraison'}</h3>
          <div class="titre" style="font-size:26px;font-weight:800">${[c.ramassage, c.livraison].filter(x => x?.demande && x.prix).map(x => esc(montant(x.prix, x.devise))).join(' + ')}</div>
          <p class="petit">La course est programmée dès le paiement reçu. Elle n'est pas remboursée si vous l'annulez ensuite.</p>
          <button class="btn btn-noir btn-grand btn-plein" data-payer-domicile>Payer maintenant</button>
        </div>` : ''}
        <div class="carte pile">
          <h3>Et maintenant ?</h3>
          ${c.ramassage?.demande ? `
          <p>1. Un livreur vous appelle puis passe chercher le colis${c.ramassage.prix ? ` (${esc(montant(c.ramassage.prix, c.ramassage.devise))})` : ''}.</p>
          <p>2. Il est pesé à <b>${esc(d.nom || 'l\'agence')}</b> : vous recevez le prix final et votre reçu.</p>` : `
          <p>1. Apportez le colis à <b>${esc(d.nom || 'l\'agence')}</b>${d.adresse ? `, ${esc(d.adresse)}` : ''}.</p>
          ${d.horaires ? `<p class="petit muet">${esc(d.horaires)}</p>` : ''}
          <p>2. Il sera pesé, vous payez et recevez votre reçu.</p>`}
          ${c.livraison?.demande ? `
          <p>3. À l'arrivée, un livreur l'apporte à ${esc(c.destinataire.nom)}${c.livraison.prix ? ` (${esc(montant(c.livraison.prix, c.livraison.devise))})` : ''}, qui donne son code de retrait.</p>
          ${c.livraison.adresse?.position ? '' : `<p class="bandeau bandeau-ocre">${ic('gps', 'ic-sm')}<span>Il manque sa position : envoyez-lui le lien de suivi, il pourra l'ajouter lui-même.</span></p>`}` : `
          <p>3. ${esc(c.destinataire.nom)} reçoit un SMS avec le code de retrait dès que le colis est à <b>${esc(r.nom || 'son agence')}</b>${r.ville ? ` (${esc(r.ville)})` : ''}.</p>`}
        </div>
        <div data-notifs></div>
        <a class="btn btn-principal btn-grand btn-plein" href="#/suivi/${encodeURIComponent(c.numeroSuivi)}">Voir le suivi</a>
        <a class="btn btn-plein" href="${esc(`https://wa.me/?text=${encodeURIComponent(`Je t'envoie un colis. Numéro de suivi : ${c.numeroSuivi}`)}`)}" target="_blank" rel="noopener">${ic('bulle', 'ic-sm')} Prévenir ${esc(c.destinataire.nom.split(' ')[0])} sur WhatsApp</a>
      </div>`;
    K.notifications.carte(main.querySelector('[data-notifs]'), { texte: 'Soyez prévenu à chaque étape de ce colis : départ, arrivée, code de retrait.' });
    const payerDom = main.querySelector('[data-payer-domicile]');
    if (payerDom) {
      payerDom.addEventListener('click', () => ouvrirPaiement(c.numeroSuivi, { objet: 'domicile', c }));
      ouvrirPaiement(c.numeroSuivi, { objet: 'domicile', c });
    }
  }

  // ════════════════════════════════════════════════════════
  //  MES COLIS
  // ════════════════════════════════════════════════════════
  // Ce que le client doit faire maintenant pour ce colis (ou où il en est), en une ligne
  function prochaineAction(c, u) {
    const g = c.guichetInfo || agence(c.guichet) || {};
    const dep = agence(c.depot) || {};
    const deviseArr = deviseDe(paysArrivee(c));
    const recu = u && c.destinataire?.telephone === u.telephone && c.expediteur?.telephone !== u.telephone;
    const enVerif = (c.declarations || []).some(d => d.statut === 'a_verifier');
    const livDem = c.livraison?.demande && c.livraison.statut !== 'annulee';
    if (c.statut === 'remis') return { ton: 'fini', texte: `Remis${c.remise?.le ? ` le ${date(c.remise.le, false)}` : ''}` };
    if (c.statut === 'annule') return { ton: 'fini', texte: 'Réservation annulée' };
    if (enVerif) return { ton: 'info', texte: 'Paiement en vérification' };
    if (c.domicileAPayerGnf > 0) return { ton: 'action', texte: `${c.ramassage?.demande && c.ramassage.statut !== 'annulee' && !(c.ramassage.payeGnf >= c.ramassage.prixGnf) ? 'Ramassage' : 'Livraison'} à payer`, bouton: 'Payer', objet: 'domicile' };
    if (c.statut === 'pret' || c.statut === 'en_livraison') {
      if (c.codeRetrait) return { ton: 'pret', texte: `${livDem ? 'Livraison en cours' : `À retirer à ${g.nom || 'l\'agence'}`} · code ${c.codeRetrait}` };
      return { ton: 'pret', texte: livDem ? 'Bientôt livré à domicile' : `À retirer à ${g.nom || 'l\'agence'}` };
    }
    if (c.solde?.soldeGnf > 0 && !c.tarif?.estime) return { ton: 'action', texte: `Reste ${deviseArr === 'EUR' ? eur(c.solde.soldeEur) : gnf(c.solde.soldeGnf)}`, bouton: 'Payer', objet: 'solde' };
    if (livDem && !c.livraison.adresse?.position?.lat) return { ton: 'action', texte: recu ? 'Envoyez votre position pour la livraison' : 'Position du destinataire manquante' };
    if (c.statut === 'reserve') {
      if (recu) return { ton: 'info', texte: 'Pas encore déposé par l\'expéditeur' };
      if (c.ramassage?.demande && c.ramassage.statut !== 'annulee') return { ton: 'info', texte: c.ramassage.statut === 'faite' ? 'Ramassé, en route vers l\'agence' : 'Un livreur vient le chercher' };
      return { ton: 'action', texte: `À déposer à ${dep.nom || 'l\'agence'}` };
    }
    return { ton: 'info', texte: titreStatut(c, g) };
  }

  // Carte d'un colis dans les listes : qui, trajet, statut, avancement, prochaine action
  function carteColis(c, u = session.utilisateur()) {
    const recu = u && c.destinataire?.telephone === u.telephone && c.expediteur?.telephone !== u.telephone;
    const i = indexEtape(c.statut);
    const a = prochaineAction(c, u);
    const dep = agence(c.depot), arr = c.guichetInfo || agence(c.guichet);
    const lieu = (x, pays) => x?.ville || x?.nom || nomPays(pays);
    const [pd, pa] = String(c.sens || 'FR-GN').split('-');
    const fini = ['remis', 'annule'].includes(c.statut);
    return `
      <article class="carte-colis ${fini ? 'finie' : ''}">
        <a class="cc-lien" href="#/suivi/${encodeURIComponent(c.numeroSuivi)}" aria-label="Colis ${esc(c.numeroSuivi)}, ${esc(c.statutLabel)}"></a>
        <div class="cc-tete">
          <span class="pastille ${c.statut === 'pret' ? 'pret' : c.mode}" aria-hidden="true">${c.statut === 'pret' ? ic('ok') : icMode(c.mode)}</span>
          <div class="grandit" style="min-width:0">
            <div class="cc-qui">${recu ? `De ${esc(c.expediteur?.nom || '')}` : `Pour ${esc(c.destinataire?.nom || '')}`}</div>
            <div class="cc-trajet"><span>${esc(lieu(dep, pd))}</span>${ic('fleche', 'ic-xs')}<span>${esc(lieu(arr, pa))}</span><span>· ${K.libMode(c.mode)}</span></div>
          </div>
        </div>
        ${fini ? '' : `<div class="cc-avancement" aria-hidden="true">${ETAPES.map((e, k) => `<span class="${k <= i ? 'fait' : ''}"><i></i>${esc(e.lib)}</span>`).join('')}</div>`}
        <div class="cc-pied">
          <span class="tres-petit muet">${esc(c.numeroSuivi)} · ${esc(date(c.createdAt, false))}${(c.poidsReel || c.poidsEstime) ? ` · ${esc(kg(c.poidsReel || c.poidsEstime))}` : ''}</span>
          <span class="badge b-${esc(c.statut)}">${esc(c.statutLabel)}</span>
        </div>
        <div class="cc-action ${a.ton}">
          <span>${esc(a.texte)}</span>
          ${a.bouton ? `<button type="button" class="btn btn-petit ${a.ton === 'action' ? 'btn-noir' : ''}" data-payer-liste="${esc(c.numeroSuivi)}" data-objet="${a.objet}">${esc(a.bouton)}</button>` : ic('suivant', 'ic-sm')}
        </div>
      </article>`;
  }
  function brancherCartes(zone, liste) {
    zone.querySelectorAll('[data-payer-liste]').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      ouvrirPaiement(b.dataset.payerListe, { objet: b.dataset.objet, c: liste.find(x => x.numeroSuivi === b.dataset.payerListe) });
    }));
  }

  async function mesColis() {
    if (!exigerConnexion()) return;
    let mes = stock.lire('mes_colis');
    try {
      const r = await api.get('/colis');
      mes = { colis: r.colis, le: Date.now() };
      stock.ecrire('mes_colis', mes);
    } catch (e) { if (!e.reseau || !mes) throw e; bandeauReseau(mes.le); }
    const u = session.utilisateur();
    const tous = mes.colis;
    const recu = (c) => c.destinataire?.telephone === u.telephone && c.expediteur?.telephone !== u.telephone;
    const etat = { vue: stock.lire('mes_colis_vue') || 'cours', qui: stock.lire('mes_colis_qui') || 'tous', q: '' };
    if (!tous.length) {
      main.innerHTML = `
        <div class="pile">
          <h1>Mes colis</h1>
          <div class="vide pile"><span class="pastille-notif" style="margin:0 auto">${ic('colis')}</span>
            <p class="gras">Aucun colis pour le moment</p>
            <p class="petit muet">Les colis qu'on vous envoie apparaissent ici tout seuls, grâce à votre numéro de téléphone.</p>
            <a class="btn btn-principal" href="#/envoyer">Envoyer un colis</a></div>
        </div>`;
      return;
    }
    const enCours = tous.filter(c => !['remis', 'annule'].includes(c.statut));
    const termines = tous.filter(c => ['remis', 'annule'].includes(c.statut));
    main.innerHTML = `
      <div class="pile">
        <div class="ligne entre"><h1>Mes colis</h1><a class="btn btn-principal btn-petit" href="#/envoyer">${ic('plus', 'ic-sm')} Envoyer</a></div>
        <div class="resume-colis">
          <div><b>${enCours.length}</b><span>en cours</span></div>
          <div><b>${enCours.filter(c => ['pret', 'en_livraison'].includes(c.statut)).length}</b><span>prêts</span></div>
          <div><b>${tous.filter(c => prochaineAction(c, u).ton === 'action').length}</b><span>à faire</span></div>
        </div>
        <div class="segments" role="group" aria-label="Période">
          <button type="button" data-vue="cours">En cours · ${enCours.length}</button>
          <button type="button" data-vue="fini">Terminés · ${termines.length}</button>
        </div>
        <div class="ligne puces" style="--gap:8px" role="group" aria-label="Filtrer">
          <button type="button" class="puce" data-qui="tous">Tous</button>
          <button type="button" class="puce" data-qui="envoi">${ic('envoi', 'ic-xs')} J'envoie</button>
          <button type="button" class="puce" data-qui="recu">${ic('recu', 'ic-xs')} Je reçois</button>
        </div>
        ${tous.length > 6 ? `<label class="recherche-liste">${ic('loupe', 'ic-sm')}<input data-q placeholder="Nom, numéro…" aria-label="Rechercher dans mes colis"></label>` : ''}
        <div class="pile" style="--gap:18px" data-liste></div>
      </div>`;
    const liste = main.querySelector('[data-liste]');
    const dessiner = () => {
      stock.ecrire('mes_colis_vue', etat.vue); stock.ecrire('mes_colis_qui', etat.qui);
      main.querySelectorAll('[data-vue]').forEach(b => b.setAttribute('aria-pressed', b.dataset.vue === etat.vue));
      main.querySelectorAll('[data-qui]').forEach(b => b.setAttribute('aria-pressed', b.dataset.qui === etat.qui));
      const q = etat.q.trim().toLowerCase();
      let l = (etat.vue === 'cours' ? enCours : termines)
        .filter(c => etat.qui === 'tous' || (etat.qui === 'recu') === recu(c))
        .filter(c => !q || [c.numeroSuivi, c.destinataire?.nom, c.expediteur?.nom].some(x => String(x || '').toLowerCase().includes(q)));
      const rang = (c) => ({ action: 0, pret: 1, info: 2, fini: 3 }[prochaineAction(c, u).ton] ?? 2);
      l = l.sort((a, b) => rang(a) - rang(b) || new Date(b.updatedAt) - new Date(a.updatedAt));
      if (!l.length) { liste.innerHTML = `<p class="vide petit">${etat.vue === 'cours' ? 'Aucun colis en cours ici.' : 'Aucun colis terminé ici.'}</p>`; return; }
      if (etat.vue === 'cours') {
        const aFaire = l.filter(c => ['action', 'pret'].includes(prochaineAction(c, u).ton));
        const reste = l.filter(c => !aFaire.includes(c));
        liste.innerHTML = [
          aFaire.length ? `<section class="pile" style="--gap:10px"><h2 class="titre-section">À faire maintenant</h2>${aFaire.map(c => carteColis(c, u)).join('')}</section>` : '',
          reste.length ? `<section class="pile" style="--gap:10px"><h2 class="titre-section">${aFaire.length ? 'En chemin' : 'Vos colis'}</h2>${reste.map(c => carteColis(c, u)).join('')}</section>` : '',
        ].join('');
      } else liste.innerHTML = `<div class="pile" style="--gap:10px">${l.map(c => carteColis(c, u)).join('')}</div>`;
      brancherCartes(liste, tous);
    };
    main.querySelectorAll('[data-vue]').forEach(b => b.addEventListener('click', () => { etat.vue = b.dataset.vue; dessiner(); }));
    main.querySelectorAll('[data-qui]').forEach(b => b.addEventListener('click', () => { etat.qui = b.dataset.qui; dessiner(); }));
    main.querySelector('[data-q]')?.addEventListener('input', (e) => { etat.q = e.target.value; dessiner(); });
    dessiner();
  }

  // Mentions légales (pied des pages Guichets et Compte)
  const mentions = () => {
    const e = CONFIG?.entreprise;
    if (!e) return '';
    return `<p class="petit centre liens-legaux" style="margin-top:8px"><a href="#/cgv">Conditions générales</a> · <a href="#/interdits">Objets interdits</a> · <a href="#/confidentialite">Confidentialité</a></p>
      <p class="tres-petit muet centre" style="line-height:1.6;margin-top:8px">${esc(e.nomCommercial)} · ${esc(e.forme)}<br>${esc(e.adresse)}<br>SIREN ${esc(e.siren)} · ${esc(e.rcs)} · TVA ${esc(e.tva)}</p>`;
  };

  // ════════════════════════════════════════════════════════
  //  GUICHETS
  // ════════════════════════════════════════════════════════
  async function guichets() {
    const lieu = (l) => `
      <div class="carte pile" style="--gap:6px">
        <h3>${esc(l.nom)}</h3>
        ${l.commune && l.commune !== l.ville ? `<p class="tres-petit muet">${esc(l.commune)}</p>` : ''}
        ${l.adresse ? `<p class="petit">${esc(l.adresse)}${l.ville && !l.adresse.toLowerCase().includes(l.ville.toLowerCase()) ? `, ${esc(l.ville)}` : ''}</p>` : ''}
        ${l.horaires ? `<p class="petit muet">${ic('horloge', 'ic-sm')} ${esc(l.horaires)}</p>` : ''}
        ${l.telephone ? `<div class="ligne" style="--gap:8px;margin-top:6px">
          <a class="btn btn-petit" href="tel:${esc(l.telephone)}">${ic('tel', 'ic-sm')} Appeler</a>
          <a class="btn btn-petit" href="${esc(lienWhatsApp(l.telephone))}" target="_blank" rel="noopener">${ic('bulle', 'ic-sm')} WhatsApp</a></div>` : ''}
      </div>`;
    // Agences regroupées par pays puis par ville ; chacune reçoit et remet les colis
    const blocPays = (pays) => {
      const parVille = {};
      agencesDe(pays).forEach(a => { (parVille[a.ville || 'Autres'] = parVille[a.ville || 'Autres'] || []).push(a); });
      return `<h2>${esc(nomPays(pays))}</h2>${Object.entries(parVille).map(([ville, liste]) => `
        <h3 class="muet" style="font-size:15px;margin-top:4px">${esc(ville)}</h3>${liste.map(lieu).join('')}`).join('')}`;
    };
    main.innerHTML = `
      <div class="pile">
        <h1>Nos agences</h1>
        <p class="muet petit">Chaque agence prend les colis à envoyer et remet les colis arrivés.</p>
        ${Object.keys(CONFIG.pays).map(blocPays).join('')}
        ${mentions()}
      </div>`;
  }

  // ════════════════════════════════════════════════════════
  //  COMPTE / CONNEXION
  // ════════════════════════════════════════════════════════
  function connexion() {
    K.vueConnexion(main, {
      titre: 'Connexion',
      surSucces: () => {
        const retour = stock.lire('retour') || '#/';
        stock.suppr('retour');
        location.hash = retour === '#/connexion' ? '#/' : retour;
        if (location.hash === retour) router();
      },
    });
  }

  function compte() {
    const u = session.utilisateur();
    if (!u) { location.hash = '#/connexion'; return; }
    main.innerHTML = `
      <div class="pile">
        <h1>Mon compte</h1>
        <div class="carte pile" style="--gap:4px"><div class="gras">${esc(u.prenom)} ${esc(u.nom)}</div><div class="muet">${esc(u.telephone)}</div></div>
        <p class="petit muet">${u.verifie
          ? 'Les colis envoyés à ce numéro apparaissent dans « Mes colis », avec leur code de retrait.'
          : 'Vos envois apparaissent dans « Mes colis ». Pour voir aussi les codes de retrait des colis qu\'on vous envoie, faites vérifier votre numéro en agence.'}</p>
        <div data-notifs></div>
        <button class="btn btn-plein" data-mdp>Changer mon mot de passe</button>
        <button class="btn btn-plein" data-sortir>${ic('sortie', 'ic-sm')} Se déconnecter</button>
        ${mentions()}
      </div>`;
    main.querySelector('[data-mdp]').addEventListener('click', () => K.changerMotDePasse());
    K.notifications.carte(main.querySelector('[data-notifs]'), { texte: 'Arrivée de vos colis, code de retrait, livreur en route : prévenu tout de suite, même sans SMS.' });
    main.querySelector('[data-sortir]').addEventListener('click', () => {
      session.fermer(); stock.suppr('mes_colis'); location.hash = '#/';
    });
  }

  // ── Démarrage ──
  async function demarrer() {
    try { CONFIG = await K.config(); } catch (e) {
      main.innerHTML = `<div class="pile"><p class="bandeau bandeau-rouge">${ic('horsligne', 'ic-sm')} Impossible de joindre le serveur.</p><button class="btn btn-principal" onclick="location.reload()">Réessayer</button></div>`;
      return;
    }
    document.querySelectorAll('[data-nom-app]').forEach(el => { el.textContent = CONFIG.app; });
    document.title = `${CONFIG.app} — Suivi de colis`;
    // Lien de suivi reçu par SMS : /?suivi=TMS-…
    const q = new URLSearchParams(location.search).get('suivi');
    if (q) { history.replaceState(null, '', location.pathname + `#/suivi/${encodeURIComponent(q)}`); }
    window.addEventListener('hashchange', router);
    router();
    // Rafraîchit la config en arrière-plan
    K.config({ forcer: true }).then(c => { CONFIG = c; }).catch(() => {});
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  demarrer();
})();
