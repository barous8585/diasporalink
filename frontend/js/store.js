// ── STORE: centralized state management ────────────────────────────────────

const Store = (() => {
  let _state = {
    user: {
      name: 'Aminata Konaté',
      initials: 'AK',
      phone: '+33 6 12 34 56 78',
      email: 'aminata.konate@email.com',
      address: '12 rue des Lilas, 49000 Angers',
      rating: 4.9,
      totalShipments: 12,
      totalSpent: 486
    },
    pickupForm: {
      address: '12 rue des Lilas, 49000 Angers',
      date: '',
      slot: 'morning',
      country: 'SN',
      recipientName: '',
      recipientPhone: '',
      packageType: 'clothes',
      weight: '',
      value: '',
      destinationCity: ''
    },
    colis: [
      {
        id: 'DL-2048',
        destination: 'Dakar, Sénégal',
        flag: '🇸🇳',
        recipient: 'Maman',
        status: 'transit',
        statusLabel: 'En transit',
        date: '22 mai 2025',
        price: 46.50,
        carrier: 'Moussa Diallo',
        carrierPhone: '+33 6 77 88 99 00',
        currentStep: 2,
        steps: [
          { label: 'Pick-up effectué', detail: 'Angers · 22 mai · 09h30', done: true },
          { label: 'Contrôle douanier', detail: 'Paris · 23 mai · 14h00', done: true },
          { label: 'En cours de transport', detail: 'Vol Paris → Dakar · ETA 25 mai', active: true },
          { label: 'Arrivée entrepôt Dakar', detail: 'Prévu 26 mai', done: false },
          { label: 'Livraison au destinataire', detail: 'Prévu 27 – 28 mai', done: false }
        ]
      },
      {
        id: 'DL-1994',
        destination: 'Abidjan, Côte d\'Ivoire',
        flag: '🇨🇮',
        recipient: 'Sœur Fatou',
        status: 'delivered',
        statusLabel: 'Livré',
        date: '10 avril 2025',
        price: 52.00
      },
      {
        id: 'DL-1871',
        destination: 'Douala, Cameroun',
        flag: '🇨🇲',
        recipient: 'Tonton Joseph',
        status: 'delivered',
        statusLabel: 'Livré',
        date: '3 mars 2025',
        price: 39.00
      }
    ],
    messages: [
      { id: 1, from: 'agent', sender: 'Moussa · Votre livreur', text: 'Bonjour Aminata ! Je suis bien arrivé à votre adresse. Je serai là dans 5 minutes.', time: '09:24' },
      { id: 2, from: 'user', text: 'Parfait Moussa, je descends !', time: '09:26' },
      { id: 3, from: 'agent', sender: 'Moussa · Votre livreur', text: 'Colis récupéré ✓ Merci. Il sera remis ce soir à notre entrepôt Paris.', time: '09:34' },
      { id: 4, from: 'system', text: '📦 Votre colis est en transit vers Dakar. Suivi : #DL-2048', time: '14:02' },
      { id: 5, from: 'user', text: 'Super, merci ! Ma maman est prévenue ?', time: '14:15' },
      { id: 6, from: 'agent', sender: 'Système DiasporaLink', text: 'Oui ! Un SMS de confirmation a été envoyé au +221 77 XXX XX XX.', time: '14:16' }
    ],
    countries: [
      { code: 'SN', name: 'Sénégal', flag: '🇸🇳', cities: ['Dakar', 'Saint-Louis', 'Thiès', 'Ziguinchor'] },
      { code: 'CI', name: 'Côte d\'Ivoire', flag: '🇨🇮', cities: ['Abidjan', 'Bouaké', 'San-Pédro'] },
      { code: 'CM', name: 'Cameroun', flag: '🇨🇲', cities: ['Douala', 'Yaoundé', 'Bafoussam'] },
      { code: 'GN', name: 'Guinée', flag: '🇬🇳', cities: ['Conakry', 'Kankan', 'Labé'] },
      { code: 'ML', name: 'Mali', flag: '🇲🇱', cities: ['Bamako', 'Sikasso', 'Mopti'] },
      { code: 'BF', name: 'Burkina Faso', flag: '🇧🇫', cities: ['Ouagadougou', 'Bobo-Dioulasso'] },
      { code: 'CD', name: 'RD Congo', flag: '🇨🇩', cities: ['Kinshasa', 'Lubumbashi', 'Goma'] },
      { code: 'MR', name: 'Mauritanie', flag: '🇲🇷', cities: ['Nouakchott', 'Nouadhibou'] },
      { code: 'TG', name: 'Togo', flag: '🇹🇬', cities: ['Lomé', 'Sokodé'] }
    ],
    slots: [
      { key: 'morning', label: 'Matin (8h – 12h)' },
      { key: 'afternoon', label: 'Après-midi (13h – 17h)' },
      { key: 'evening', label: 'Soir (17h – 20h)' }
    ],
    packageTypes: [
      { key: 'clothes', label: 'Vêtements / Textiles', icon: '👕' },
      { key: 'electronics', label: 'Électronique', icon: '📱' },
      { key: 'medicine', label: 'Médicaments', icon: '💊' },
      { key: 'documents', label: 'Documents', icon: '📄' },
      { key: 'food', label: 'Alimentaire sec', icon: '🥫' },
      { key: 'mixed', label: 'Mixte', icon: '📦' }
    ],
    pricePerKg: { SN: 7.5, CI: 8.0, CM: 7.8, GN: 8.5, ML: 8.2, BF: 8.3, CD: 9.0, MR: 8.6, TG: 8.1 },
    pickupFee: 5.0,
    insuranceRate: 0.023
  };

  const listeners = {};

  return {
    get: (key) => key ? _state[key] : _state,
    set: (key, value) => {
      _state[key] = typeof value === 'object' && !Array.isArray(value) && _state[key]
        ? { ..._state[key], ...value }
        : value;
      if (listeners[key]) listeners[key].forEach(fn => fn(_state[key]));
    },
    on: (key, fn) => {
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(fn);
    },
    computePrice: () => {
      const f = _state.pickupForm;
      const kg = parseFloat(f.weight) || 0;
      const val = parseFloat(f.value) || 0;
      const ppkg = _state.pricePerKg[f.country] || 8.0;
      const transport = kg * ppkg;
      const insurance = val * _state.insuranceRate;
      const total = _state.pickupFee + transport + (insurance > 0 ? insurance : 0);
      return {
        pickup: _state.pickupFee,
        transport: transport,
        insurance: insurance > 0 ? insurance : 0,
        total: total
      };
    }
  };
})();

window.Store = Store;
