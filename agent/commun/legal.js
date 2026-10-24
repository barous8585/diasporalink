// ─────────────────────────────────────────────────────────────
//  Textes légaux : objets interdits, conditions générales, confidentialité
//  Source : shared/legal.js — copié dans les apps par `npm run sync-apps`.
//  Les chiffres (garde, plafonds, délais) viennent des réglages du back-office.
//  ⚠ Textes à faire relire par un juriste avant l'ouverture au public.
// ─────────────────────────────────────────────────────────────
(function () {
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nb = (n) => Number(n || 0).toLocaleString('fr-FR');

  // Refusés dans tous les cas
  const REFUSES = [
    ['Armes et explosifs', 'armes (même factices), munitions, feux d\'artifice, pétards'],
    ['Gaz et aérosols', 'bombes de peinture ou d\'insecticide, recharges de gaz, briquets, allumettes'],
    ['Produits inflammables', 'essence, alcool à brûler, diluants, vernis, peintures à solvant'],
    ['Produits corrosifs ou toxiques', 'acides, javel concentrée, pesticides, mercure'],
    ['Batteries au lithium seules', 'batteries de rechange, batteries externes (power banks)'],
    ['Drogues', 'stupéfiants, produits à base de cannabis'],
    ['Argent et objets de valeur', 'espèces, chèques, cartes bancaires, bijoux, or, métaux précieux'],
    ['Papiers d\'identité', 'passeports, cartes d\'identité ou titres de séjour d\'autres personnes'],
    ['Animaux et végétaux vivants', 'animaux, plantes, graines, terre'],
    ['Denrées périssables', 'viande, poisson, produits laitiers frais, plats cuisinés'],
    ['Produits illégaux', 'contrefaçons, objets volés, tout ce qu\'interdit la loi française ou guinéenne'],
  ];
  // Acceptés sous conditions : à déclarer au dépôt
  const CONDITIONS = [
    ['Parfums et cosmétiques avec alcool', 'en petite quantité, flacons fermés et protégés'],
    ['Téléphones, ordinateurs', 'batterie intégrée à l\'appareil, éteint et emballé'],
    ['Aliments secs, conserves, huiles, sauces', 'emballages d\'origine fermés et étanches'],
    ['Médicaments personnels', 'avec l\'ordonnance, en quantité pour un usage personnel'],
    ['Alcool et tabac', 'dans les limites autorisées par la douane du pays d\'arrivée'],
  ];

  function listeInterdits() {
    return `
      <h2>Refusés</h2>
      <ul class="liste-legale">${REFUSES.map(([t, d]) => `<li><b>${e(t)}</b> : ${e(d)}</li>`).join('')}</ul>
      <h2>Acceptés sous conditions</h2>
      <p class="petit muet">À signaler à l'agent au dépôt.</p>
      <ul class="liste-legale">${CONDITIONS.map(([t, d]) => `<li><b>${e(t)}</b> : ${e(d)}</li>`).join('')}</ul>
      <p class="petit">En cas de doute, demandez à l'agence avant d'emballer. Un colis qui contient un objet refusé peut être ouvert, refusé ou retenu par la douane ; les frais et les conséquences sont à la charge de l'expéditeur.</p>`;
  }

  const ident = (c) => {
    const s = c.entreprise || {};
    const f = c.facturation || {};
    return `${e(s.raisonSociale)}, ${e(s.forme)}${f.capital ? ` au capital de ${e(f.capital)}` : ''}, ${e(s.adresse)}, ${e(s.rcs)}, SIRET ${e(s.siret)}, TVA ${e(s.tva)}`;
  };
  const contact = (c) => {
    const f = c.facturation || {};
    return [f.email && `par e-mail à <a href="mailto:${e(f.email)}">${e(f.email)}</a>`, f.telephone && `par téléphone au ${e(f.telephone)}`, 'ou dans l\'une de nos agences'].filter(Boolean).join(', ');
  };

  function cgv(c) {
    const m = c.magasinage || {};
    const l = c.litiges || {};
    const modes = (c.modes || []).map(x => `${e(x.label.toLowerCase())} : ${e(x.delai)}`).join(' ; ');
    return `
      <p class="petit muet">Version du ${e(new Date(c.cgvVersion || Date.now()).toLocaleDateString('fr-FR'))}</p>
      <h2>1. Qui sommes-nous ?</h2>
      <p>Le service est assuré par ${ident(c)} (« TMS »). TMS transporte des colis entre la Guinée et l'Europe (France, Belgique), dans les deux sens, à partir de ses agences.</p>
      <p>En réservant en ligne ou en déposant un colis en agence, l'expéditeur accepte les présentes conditions et la liste des objets interdits.</p>

      <h2>2. Réservation, dépôt et pesée</h2>
      <p>Le prix affiché à la réservation est une estimation. Le prix définitif est fixé à la pesée en agence, selon le poids réel (avec un poids minimum facturé selon le mode de transport), le contenu et les options choisies. Le taux de change euro / franc guinéen est celui du jour du dépôt ; il est figé sur le reçu.</p>
      <p>L'expéditeur remet un colis bien fermé et emballé pour supporter le transport. L'agent peut refuser un colis mal emballé.</p>

      <h2>3. Contenu du colis</h2>
      <p>L'expéditeur est seul responsable du contenu de son colis et de sa déclaration. Il garantit qu'il ne contient aucun objet interdit. TMS peut ouvrir un colis en cas de doute, en présence de l'expéditeur lorsque c'est possible, et refuser de le transporter. Les droits, taxes et amendes liés à un contenu non déclaré ou interdit sont à la charge de l'expéditeur.</p>

      <h2>4. Prix et paiement</h2>
      <p>Les prix sont indiqués toutes taxes comprises. Le transport est payé au dépôt par l'expéditeur, ou à l'arrivée par le destinataire si cette option a été choisie. Les droits et taxes de douane du pays d'arrivée sont refacturés à l'identique au destinataire.</p>
      <p>Le colis est gardé gratuitement ${nb(m.joursGratuits)} jours à l'agence de retrait. Ensuite, des frais de garde s'appliquent : ${nb(m.fraisJourGnf)} GNF par jour en Guinée, ${nb(m.fraisJourEur)} € par jour en France et en Belgique.</p>
      <p>Le ramassage et la livraison à domicile sont facultatifs. Leur prix dépend de la distance entre l'agence et l'adresse ; il est affiché avant validation. Il se paie en ligne, d'avance (carte bancaire, Orange Money ou MTN MoMo selon le pays) : la course est programmée dès le paiement reçu. Une course payée n'est pas remboursée si le client l'annule ou change d'avis ; si elle est redemandée pour le même colis, le paiement déjà fait est conservé. Un paiement Orange Money ou MTN MoMo est validé après vérification de sa réception par TMS.</p>
      <p>Le colis n'est remis qu'une fois toutes les sommes payées. Une facture est délivrée pour chaque paiement.</p>

      <h2>5. Délais</h2>
      <p>Les délais sont indicatifs (${modes}). Ils peuvent être allongés par les contrôles de douane, les compagnies de transport ou des événements extérieurs. Un retard ne donne pas droit à indemnisation, sauf faute de TMS.</p>

      <h2>6. Remise du colis</h2>
      <p>Quand le colis est disponible, un code de retrait à 4 chiffres est communiqué. Le colis est remis contre ce code et une pièce d'identité au destinataire ou à la personne qu'il a autorisée. En livraison à domicile, le colis est remis contre le code. La personne signe à la remise.</p>
      <p>Un colis non retiré 90 jours après sa mise à disposition, malgré nos relances, est considéré comme abandonné : TMS pourra en disposer, après une dernière relance.</p>

      <h2>7. Responsabilité et indemnisation</h2>
      <p>TMS est responsable du colis de son dépôt à sa remise. En cas de perte ou d'avarie due à TMS, l'indemnisation est limitée à :</p>
      <ul class="liste-legale">
        <li><b>colis non assuré</b> : ${nb(l.indemnisationKgEur)} € par kilo de poids réel, dans la limite du préjudice prouvé ;</li>
        <li><b>colis assuré</b> : la valeur déclarée au dépôt, sur justificatifs (factures d'achat, photos).</li>
      </ul>
      <p>TMS n'est pas responsable d'un dommage dû à un emballage insuffisant, à un contenu interdit ou non déclaré, à un objet fragile non signalé, à une saisie par la douane, à la nature même du contenu ou à un cas de force majeure. Les frais de transport peuvent être remboursés en plus de l'indemnisation si le colis est perdu.</p>

      <h2>8. Réclamations</h2>
      <p>Une réclamation se fait depuis « Mes colis » (bouton « Signaler un problème ») ou en agence :</p>
      <ul class="liste-legale">
        <li><b>colis abîmé ou incomplet</b> : dans les ${nb(l.delaiAbimeJours)} jours suivant la remise, avec des photos du colis et du contenu ; gardez l'emballage ;</li>
        <li><b>colis perdu ou en retard</b> : dans les ${nb(l.delaiPerduJours)} jours suivant la date de livraison prévue.</li>
      </ul>
      <p>TMS répond dans un délai de 30 jours. La décision (indemnisation, remboursement par avoir ou refus motivé) est indiquée dans la réclamation.</p>

      <h2>9. Données personnelles</h2>
      <p>Les données nécessaires au transport sont traitées comme décrit dans notre <a href="#/confidentialite">politique de confidentialité</a>.</p>

      <h2>10. Litiges</h2>
      <p>Ces conditions sont soumises au droit français. En cas de désaccord, le client contacte d'abord TMS ${contact(c)}. À défaut d'accord, un client particulier peut recourir gratuitement à un médiateur de la consommation${c.facturation?.mediateur ? ` : ${e(c.facturation.mediateur)}` : ' (coordonnées communiquées sur demande)'}, ou saisir le tribunal compétent.</p>`;
  }

  function confidentialite(c) {
    return `
      <p class="petit muet">Version du ${e(new Date(c.cgvVersion || Date.now()).toLocaleDateString('fr-FR'))}</p>
      <h2>Qui est responsable ?</h2>
      <p>${ident(c)}. Pour toute question sur vos données, contactez-nous ${contact(c)}.</p>

      <h2>Quelles données ?</h2>
      <ul class="liste-legale">
        <li>Identité et téléphone de l'expéditeur, du destinataire et de la personne autorisée à retirer ;</li>
        <li>adresse, point de repère et position GPS pour un ramassage ou une livraison à domicile ;</li>
        <li>contenu, poids, valeur déclarée et photo du colis prise au dépôt ;</li>
        <li>paiements (montant, moyen, référence : nous ne voyons jamais les numéros de carte bancaire, traités par Stripe) ;</li>
        <li>signature à la remise ;</li>
        <li>pour nos livreurs : la position de leur téléphone au moment où ils valident une course ;</li>
        <li>vos réclamations et nos échanges.</li>
      </ul>

      <h2>Pourquoi ?</h2>
      <ul class="liste-legale">
        <li><b>Transporter et remettre votre colis</b>, vous informer de son suivi, encaisser et facturer (exécution du contrat) ;</li>
        <li><b>respecter la loi</b> : comptabilité, formalités de douane (obligation légale) ;</li>
        <li><b>prévenir la fraude et traiter les litiges</b> : code de retrait, signature, photo au dépôt, contrôle des livraisons (intérêt légitime de TMS).</li>
      </ul>
      <p>Vos données ne sont jamais vendues ni utilisées pour de la publicité.</p>

      <h2>Qui y a accès ?</h2>
      <p>Les agents et livreurs de TMS qui traitent votre colis, en Europe (France, Belgique) et en Guinée ; les administrations des douanes si elles le demandent ; nos prestataires techniques : hébergement de l'application et de la base de données (Render, MongoDB Atlas, Netlify), paiement par carte (Stripe) et, le cas échéant, envoi de SMS ou de messages WhatsApp. Certains de ces prestataires sont situés hors de l'Union européenne ; les transferts sont encadrés par les clauses contractuelles types de la Commission européenne. L'envoi vers la Guinée des données nécessaires à la remise du colis est indispensable au service que vous demandez.</p>

      <h2>Combien de temps ?</h2>
      <ul class="liste-legale">
        <li>Colis, suivi et réclamations : 3 ans après la remise du colis ;</li>
        <li>factures : 10 ans (obligation comptable) ;</li>
        <li>photos du colis, signatures et positions GPS : 1 an après la remise, sauf réclamation en cours ;</li>
        <li>compte client : jusqu'à sa suppression, ou 3 ans sans activité.</li>
      </ul>

      <h2>Vos droits</h2>
      <p>Vous pouvez accéder à vos données, les faire corriger ou effacer, vous opposer à leur traitement ou en limiter l'usage, et demander à les récupérer, en nous contactant ${contact(c)}. Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL (cnil.fr).</p>

      <h2>Cookies</h2>
      <p>L'application n'utilise ni cookies publicitaires ni outils de mesure d'audience. Elle garde seulement sur votre téléphone ce qui est nécessaire pour vous garder connecté et fonctionner sans réseau.</p>`;
  }

  window.KolisLegal = { REFUSES, CONDITIONS, listeInterdits, cgv, confidentialite };
})();
