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
  const icMode = (mode) => ic(mode === 'mer' ? 'bateau' : 'avion');
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
      main.querySelector('[data-autres]').innerHTML = `<h2>Mes autres colis</h2>${autres.map(ligneColis).join('')}`;
    }
  }

  function carteVedette(c) {
    const i = indexEtape(c.statut);
    return `
      <div class="carte-vert pile vedette" style="--gap:14px">
        <div class="ligne entre" style="align-items:flex-start">
          <div>
            <div class="petit" style="opacity:.85">${esc(c.numeroSuivi)} · vers ${esc(nomPays(paysArrivee(c)))} · ${c.mode === 'mer' ? 'bateau' : 'avion'}</div>
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
    const historique = [...(c.historique || [])].reverse();
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

    main.innerHTML = `
      <div class="pile">
        <div class="ligne">
          <a href="#/" class="btn btn-rond" aria-label="Retour">${ic('retour')}</a>
          <div class="grandit"><div class="tres-petit muet">Colis</div><div class="titre" style="font-size:19px;font-weight:700">${esc(c.numeroSuivi)}</div></div>
          <button class="btn btn-rond" data-partager aria-label="Partager le suivi">${ic('partager')}</button>
        </div>

        <div class="carte-vert pile" style="--gap:10px">
          <span class="badge" style="align-self:flex-start;background:var(--ocre);color:var(--encre)">${pret ? ic('ok', 'ic-sm') : icMode(c.mode).replace('class="ic ', 'class="ic ic-sm ')} ${esc(c.statutLabel)}</span>
          <h1 style="font-size:26px">${esc(titreStatut(c, g))}</h1>
          <p style="opacity:.9">${poids ? esc(kg(poids)) : ''}${c.nbCartons ? ` · ${c.nbCartons} carton${c.nbCartons > 1 ? 's' : ''}` : ''}${c.lotCode ? ` · lot ${esc(c.lotCode)}` : ''}</p>
        </div>

        ${pret && c.codeRetrait ? `
          <div class="carte pile">
            <h3>Code de retrait</h3>
            <div class="code-4">${c.codeRetrait.split('').map(d => `<div>${esc(d)}</div>`).join('')}</div>
            <p class="petit muet">${liv ? 'Donnez ce code au livreur quand il vous remet le colis.' : 'Montrez ce code et une pièce d\'identité à l\'agent de l\'agence.'}</p>
          </div>` : pret ? `
          <div class="carte pile">
            <h3>Code de retrait</h3>
            <p class="petit muet">Le code de retrait est visible dans le compte de la personne qui a envoyé le colis : elle peut vous le transmettre. ${session.connecte() ? '' : 'Si c\'est vous, connectez-vous pour le voir ici.'}</p>
            ${session.connecte() ? '' : `<a class="btn btn-plein" href="#/connexion" data-memo-retour>Se connecter</a>`}
          </div>` : ''}

        ${complet && c.tiersAutorise?.nom ? `<p class="bandeau bandeau-vert">${ic('ajoutPers', 'ic-sm')}<span><b>${esc(c.tiersAutorise.nom)}</b> peut retirer ce colis.</span></p>` : ''}
        ${peutAutoriser ? `<button class="btn btn-plein" data-tiers>${ic('ajoutPers', 'ic-sm')} Envoyer quelqu'un à ma place</button>` : ''}

        ${(solde.soldeGnf > 0 || pret) ? `
        <div class="grille-2">
          ${solde.soldeGnf > 0 ? `
          <div class="carte-ocre pile" style="--gap:6px">
            <div class="tres-petit gras">${estime ? 'Prix estimé' : 'Reste à payer'}</div>
            <div class="titre" style="font-size:22px;font-weight:800">${principal(solde.soldeGnf, solde.soldeEur)}</div>
            <div class="tres-petit">soit ${secondaire(solde.soldeGnf, solde.soldeEur)}${estime ? ' · fixé à la pesée' : ''}</div>
            ${c.statut !== 'reserve' ? `<button class="btn btn-noir btn-petit" data-payer style="margin-top:6px">Payer</button>` : ''}
          </div>` : `
          <div class="carte pile" style="--gap:6px"><div class="tres-petit gras muet">Paiement</div><div class="titre" style="font-size:20px;font-weight:800">Tout est payé</div></div>`}
          ${pret && joursRestants !== null ? `
          <div class="carte pile" style="--gap:6px">
            <div class="tres-petit gras muet">${joursRestants > 0 ? 'Retrait gratuit' : 'Frais de garde'}</div>
            <div class="titre" style="font-size:22px;font-weight:800">${joursRestants > 0 ? `encore ${joursRestants} j` : principal(mag.fraisGnf, mag.fraisGnf / (c.tarif?.taux || CONFIG.tauxEurGnf))}</div>
            <div class="tres-petit muet">${joursRestants > 0 ? `Ensuite ${fraisJour} par jour` : `${mag.joursFactures} jour(s) facturé(s)`}</div>
          </div>` : ''}
        </div>` : ''}

        ${carteCourses(c, ram, liv)}

        ${c.statut === 'reserve' && !ram ? `
          <div class="carte pile">
            <h3>Prochaine étape : le dépôt</h3>
            <p class="petit">Apportez le colis en agence avec ce numéro. Il sera pesé et le prix final sera fixé à ce moment-là.</p>
            ${depart ? `<p class="petit"><b>${esc(depart.nom)}</b>${depart.adresse ? ` · ${esc(depart.adresse)}` : ''}${depart.horaires ? `<br><span class="muet">${esc(depart.horaires)}</span>` : ''}</p>` : `<a class="btn btn-petit" href="#/guichets">Voir les agences</a>`}
          </div>` : ''}

        ${complet && !['reserve', 'annule'].includes(c.statut) ? `
        <div class="carte pile" style="--gap:6px" data-factures><h3>Factures</h3><p class="petit muet">Chargement…</p></div>
        <div data-reclamations></div>` : ''}

        <div class="carte">
          <h2 style="margin-bottom:14px">Historique</h2>
          <div class="frise">
            ${historique.map(h => `
              <div class="etape"><div class="rail"><div class="point"></div><div class="trait"></div></div>
                <div class="texte"><div class="gras">${esc(h.label)}</div><div class="petit muet">${esc(date(h.le))}${h.detail ? ` · ${esc(h.detail)}` : ''}</div></div>
              </div>`).join('')}
          </div>
        </div>

        ${g?.nom ? `
        <div class="grille-3">
          ${g.telephone ? `<a class="tuile" style="min-height:72px;gap:4px;align-items:center;justify-content:center;font-size:13px" href="tel:${esc(g.telephone)}">${ic('tel')}Appeler</a>
          <a class="tuile" style="min-height:72px;gap:4px;align-items:center;justify-content:center;font-size:13px" href="${esc(lienWhatsApp(g.telephone, `Bonjour, je vous contacte pour le colis ${c.numeroSuivi}.`))}" target="_blank" rel="noopener">${ic('bulle')}WhatsApp</a>` : ''}
          <a class="tuile" style="min-height:72px;gap:4px;align-items:center;justify-content:center;font-size:13px" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${g.adresse || g.nom} ${g.commune || ''} ${g.ville || ''} ${nomPays(g.pays || paysArrivee(c))}`)}" target="_blank" rel="noopener">${ic('lieu')}Itinéraire</a>
        </div>
        <p class="petit muet centre">${esc(g.nom)}${g.ville ? `, ${esc(g.ville)}` : ''}${g.horaires ? ` · ${esc(g.horaires)}` : ''}</p>` : ''}
        ${complet && c.statut === 'reserve' ? `<button class="btn btn-lien" data-annuler>Annuler cette réservation</button>` : ''}
      </div>`;

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
    main.querySelector('[data-payer]')?.addEventListener('click', () => payer(c, solde));
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
    if (ram) {
      blocs.push(`
        <div class="carte pile" style="--gap:6px">
          <div class="ligne entre"><h3>${ic('moto', 'ic-sm')} Ramassage à domicile</h3><span class="badge">${esc(ram.statut === 'faite' ? 'Ramassé' : LIB_COURSE[ram.statut] || '')}</span></div>
          <p class="petit">${esc(ram.quartier || '')}${ram.prix ? ` · ${esc(montant(ram.prix, ram.devise))}` : ''}${ram.livreur ? ` · ${esc(ram.livreur)}` : ''}</p>
          ${ram.statut !== 'faite' ? '<p class="tres-petit muet">Le livreur vous appelle avant de passer. Le colis sera pesé à l\'agence.</p>' : ''}
        </div>`);
    }
    const ouvert = !['remis', 'annule', 'en_livraison'].includes(c.statut);
    if (liv) {
      blocs.push(`
        <div class="carte pile" style="--gap:8px">
          <div class="ligne entre"><h3>${ic('moto', 'ic-sm')} Livraison à domicile</h3>${c.statut === 'remis' ? '<span class="badge">Livré</span>' : liv.statut === 'en_route' ? '<span class="badge">En route</span>' : ''}</div>
          <p class="petit">${esc(liv.quartier || '')}${liv.prix ? ` · ${esc(montant(liv.prix, liv.devise))} (${esc(String(liv.distanceKm).replace('.', ','))} km)` : ''}${liv.livreur ? ` · ${esc(liv.livreur)}` : ''}</p>
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
    const envoyer = async (corps) => {
      try {
        await api.post(`/colis/${c.numeroSuivi}/livraison`, corps);
        fermer(); toast(corps.demande === false ? 'Livraison annulée : retrait à l\'agence.' : 'Adresse enregistrée.', 'ok'); router();
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
      if (!tel || !a.quartier || !a.repere) { toast('Numéro, quartier et point de repère sont nécessaires.', 'erreur'); return; }
      if (!a.position) { toast('Envoyez votre position : « Je suis sur place » ou lien de localisation.', 'erreur'); return; }
      const course = adr.course();
      if (course && !course.ok) { toast(course.message, 'erreur'); return; }
      if (course && !confirm(`Livraison : ${montant(course.prix, course.devise)} (${course.distanceKm.toLocaleString('fr-FR')} km), à payer au livreur. Confirmer ?`)) return;
      envoyer({ telephone: normTel(tel), demande: true, adresse: a });
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
      case 'charge': return `Chargé, départ ${c.mode === 'mer' ? 'en bateau' : 'en avion'} prochainement`;
      case 'en_transit': return `En route vers ${pays === 'France' ? 'la France' : 'la Guinée'} ${c.mode === 'mer' ? 'par bateau' : 'par avion'}`;
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

  function payer(c, solde) {
    const { el } = modale(`
      <div class="pile" style="--gap:14px">
        <div class="ligne entre"><h2>Payer ${deviseDe(paysArrivee(c)) === 'EUR' ? eur(solde.soldeEur) : gnf(solde.soldeGnf)}</h2><button type="button" class="btn btn-rond" data-fermer aria-label="Fermer">${ic('fermer')}</button></div>
        <button class="btn btn-plein btn-grand" data-carte>${ic('carte')} Carte bancaire (${eur(solde.soldeEur)})</button>
        <button class="btn btn-plein btn-grand" disabled>Orange Money · bientôt</button>
        <button class="btn btn-plein btn-grand" disabled>MTN MoMo · bientôt</button>
        <p class="bandeau bandeau-ocre">${ic('billet', 'ic-sm')}<span>Vous pouvez aussi payer en espèces à l'agence, au moment du retrait.</span></p>
      </div>`);
    el.querySelector('[data-carte]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { const r = await api.post('/paiements/creer-session', { numero: c.numeroSuivi }); location.href = r.url; }
      catch (err) { toast(err.message, 'erreur'); e.target.disabled = false; }
    });
  }

  // ════════════════════════════════════════════════════════
  //  ENVOYER : estimation + réservation
  // ════════════════════════════════════════════════════════
  async function envoyer() {
    const defaut = { sens: 'FR-GN', mode: 'air', poids: 5, type: 'vetements', assurance: false, valeur: '', depart: 'agence', arrivee: 'agence' };
    const etat = { ...defaut, ...(stock.lire('brouillon_envoi') || {}) };
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
          <div class="grille-2">${CONFIG.modes.map(m => `
            <button type="button" class="choix" style="min-height:112px;justify-content:space-between" data-mode="${m.key}" aria-pressed="${etat.mode === m.key}">
              ${icMode(m.key).replace('class="ic ', 'class="ic ic-lg ')}
              <span class="nom" style="font-size:17px">${esc(m.label)}</span>
              <span class="sous">${esc(m.delai)}</span>
            </button>`).join('')}
          </div>
        </section>

        <section class="pile" style="--gap:8px" aria-labelledby="q2">
          <h3 id="q2">3. Poids estimé</h3>
          <div class="carte pile">
            <div class="pas-a-pas">
              <button type="button" class="btn" data-moins aria-label="Moins un kilo">−</button>
              <div><div class="valeur" data-poids aria-live="polite"></div><div class="tres-petit muet centre" data-note-poids></div></div>
              <button type="button" class="btn" data-plus aria-label="Plus un kilo">+</button>
            </div>
            <div class="ligne" style="--gap:6px;flex-wrap:wrap">${[2, 5, 10, 20, 30].map(k => `<button type="button" class="choix choix-noir" style="min-height:44px;flex:1;align-items:center;padding:0 4px;white-space:nowrap;font-weight:600" data-preset="${k}">${k} kg</button>`).join('')}</div>
          </div>
        </section>

        <section class="pile" style="--gap:8px" aria-labelledby="q3">
          <h3 id="q3">4. Contenu</h3>
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
          <label class="champ">Nombre de cartons <input class="saisie" name="nbCartons" type="number" inputmode="numeric" min="1" value="1"></label>
          <label class="champ">Contenu (facultatif) <input class="saisie" name="description" placeholder="Ex. vêtements, chaussures"></label>
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
      $('[data-poids]').textContent = kg(etat.poids);
      $('[data-note-poids]').textContent = etat.poids < m.poidsMin ? `minimum facturé : ${m.poidsMin} kg` : `${montant(m.prixKg, devise)} le kilo`;
      const t = KolisTarif.calculerTarif(CONFIG.regles, { sens: etat.sens, mode: etat.mode, poidsKg: etat.poids, typeColis: etat.type, valeurDeclaree: etat.valeur, assurance: etat.assurance });
      $('[data-prix-principal]').textContent = devise === 'EUR' ? eur(t.totalEur) : gnf(t.totalGnf);
      $('[data-prix-autre]').textContent = `soit ${devise === 'EUR' ? gnf(t.totalGnf) : eur(t.totalEur)}`;
    };
    main.querySelectorAll('[data-sens]').forEach(b => b.addEventListener('click', () => { etat.sens = b.dataset.sens; maj(); }));
    main.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { etat.mode = b.dataset.mode; maj(); }));
    main.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { etat.type = b.dataset.type; maj(); }));
    main.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { etat.poids = Number(b.dataset.preset); maj(); }));
    $('[data-moins]').addEventListener('click', () => { etat.poids = Math.max(1, Math.round(etat.poids) - 1); maj(); });
    $('[data-plus]').addEventListener('click', () => { etat.poids = Math.min(500, Math.round(etat.poids) + 1); maj(); });
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
      if (f.get('cgv') !== 'on') { toast('Acceptez les conditions générales et confirmez qu\'il n\'y a aucun objet interdit.', 'erreur'); return; }
      const ram = etat.depart === 'domicile' ? adrRam.lire() : null;
      const liv = etat.arrivee === 'domicile' ? adrLiv.lire() : null;
      for (const [a, lib] of [[ram, 'ramassage'], [liv, 'livraison']]) {
        if (a && !a.quartier) { toast(`Adresse de ${lib} : indiquez le quartier.`, 'erreur'); return; }
        if (a && !a.repere) { toast(`Adresse de ${lib} : indiquez un point de repère.`, 'erreur'); return; }
      }
      if (ram && !ram.position) { toast('Pour le ramassage, envoyez votre position (« Je suis sur place » ou lien de localisation).', 'erreur'); return; }
      for (const [c, lib] of [[ram && adrRam.course(), 'ramassage'], [liv && liv.position && adrLiv.course(), 'livraison']]) {
        if (c && !c.ok) { toast(`${lib[0].toUpperCase() + lib.slice(1)} : ${c.message}`, 'erreur'); return; }
      }
      stock.ecrire('brouillon_dest', Object.fromEntries(f));
      stock.ecrire('brouillon_adresses', { ram: ram || brouillonAdr.ram, liv: liv || brouillonAdr.liv });
      if (!exigerConnexion()) return;
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const r = await api.post('/colis', {
          mode: etat.mode, typeColis: etat.type, poidsEstime: etat.poids,
          assurance: etat.assurance, valeurDeclaree: parseFloat(etat.valeur) || 0,
          depot: f.get('depot'), guichet: f.get('guichet'), nbCartons: parseInt(f.get('nbCartons'), 10) || 1,
          description: f.get('description'), payeurArrivee: f.get('payeurArrivee') === 'on', cgvAcceptees: true,
          destinataire: { nom: f.get('nom'), telephone: normTel(f.get('telephone')) },
          ramassage: ram ? { demande: true, adresse: ram, jour: f.get('ram_jour') || undefined, moment: f.get('ram_moment') } : undefined,
          livraison: liv ? { demande: true, adresse: liv } : undefined,
        });
        stock.suppr('brouillon_dest'); stock.suppr('brouillon_adresses');
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
        <a class="btn btn-principal btn-grand btn-plein" href="#/suivi/${encodeURIComponent(c.numeroSuivi)}">Voir le suivi</a>
        <a class="btn btn-plein" href="${esc(`https://wa.me/?text=${encodeURIComponent(`Je t'envoie un colis. Numéro de suivi : ${c.numeroSuivi}`)}`)}" target="_blank" rel="noopener">${ic('bulle', 'ic-sm')} Prévenir ${esc(c.destinataire.nom.split(' ')[0])} sur WhatsApp</a>
      </div>`;
  }

  // ════════════════════════════════════════════════════════
  //  MES COLIS
  // ════════════════════════════════════════════════════════
  async function mesColis() {
    if (!exigerConnexion()) return;
    let mes = stock.lire('mes_colis');
    try {
      const r = await api.get('/colis');
      mes = { colis: r.colis, le: Date.now() };
      stock.ecrire('mes_colis', mes);
    } catch (e) { if (!e.reseau || !mes) throw e; bandeauReseau(mes.le); }
    const u = session.utilisateur();
    const envoyes = mes.colis.filter(c => c.expediteur?.telephone === u.telephone || c.client === u._id);
    const recus = mes.colis.filter(c => !envoyes.includes(c));
    const bloc = (titre, liste) => liste.length ? `<h2>${titre}</h2><div class="pile" style="--gap:10px">${liste.map(ligneColis).join('')}</div>` : '';
    main.innerHTML = `
      <div class="pile">
        <h1>Mes colis</h1>
        ${mes.colis.length ? bloc('Je reçois', recus) + bloc('J\'envoie', envoyes)
          : `<div class="vide pile"><p>Aucun colis pour le moment.</p><p class="petit">Les colis qui vous sont envoyés apparaissent ici automatiquement grâce à votre numéro de téléphone.</p><a class="btn btn-principal" href="#/envoyer">Envoyer un colis</a></div>`}
      </div>`;
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
        <button class="btn btn-plein" data-mdp>Changer mon mot de passe</button>
        <button class="btn btn-plein" data-sortir>${ic('sortie', 'ic-sm')} Se déconnecter</button>
        ${mentions()}
      </div>`;
    main.querySelector('[data-mdp]').addEventListener('click', () => K.changerMotDePasse());
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
