// ─────────────────────────────────────────────────────────────
//  Scanner de QR code (étiquettes TMS) et de codes-barres
//  - La vidéo de la caméra est gérée ici (même rendu partout).
//  - Décodage : lecteur intégré du navigateur (BarcodeDetector, Android/Chrome)
//    sinon jsQR, hébergé avec l'app (iPhone, ordinateur, Firefox), donc aussi
//    hors-ligne et sans dépendre d'un site extérieur.
//  - Une douchette USB/Bluetooth marche aussi : elle « tape » le numéro + Entrée
//    dans le champ de saisie.
// ─────────────────────────────────────────────────────────────
(function () {
  const JSQR = 'commun/vendor/jsqr.min.js';

  function chargerScript(src) {
    return new Promise((ok, ko) => {
      if (document.querySelector(`script[src="${src}"]`) && window.jsQR) return ok();
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Lecteur de QR indisponible. Tapez le numéro.'));
      document.head.appendChild(s);
    });
  }

  // Petit bip + vibration : l'agent sait sans regarder que le scan est passé
  let audio;
  function bip(ok = true) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const o = audio.createOscillator(); const g = audio.createGain();
      o.frequency.value = ok ? 1100 : 300; g.gain.value = 0.08;
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.09 : 0.3));
    } catch {}
    try { navigator.vibrate?.(ok ? 60 : [80, 60, 80]); } catch {}
  }

  // Extrait le numéro d'un QR : accepte « TMS-26-00012 » ou une URL de suivi
  function extraireNumero(texte) {
    const t = String(texte || '').trim();
    const m = t.match(/[A-Z]{2,4}-\d{2}-\d{4,6}/i);
    return (m ? m[0] : t).toUpperCase();
  }

  // Messages compréhensibles quand la caméra ne s'ouvre pas
  function messageErreur(e) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    switch (e?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return ios
          ? 'Caméra refusée. Ouvrez Réglages → Safari → Caméra → Autoriser, puis rechargez la page.'
          : 'Caméra refusée. Touchez le cadenas à gauche de l\'adresse → Autorisations → Caméra → Autoriser, puis réessayez.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Aucune caméra trouvée sur cet appareil. Tapez le numéro ou utilisez une douchette.';
      case 'NotReadableError':
      case 'AbortError':
        return 'La caméra est déjà utilisée par une autre application. Fermez-la et réessayez.';
      default:
        return e?.message || 'Caméra indisponible. Tapez le numéro.';
    }
  }

  async function ouvrirCamera() {
    if (!window.isSecureContext) throw new Error('La caméra ne marche que sur une adresse sécurisée (https).');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Ce navigateur ne donne pas accès à la caméra. Essayez Chrome ou Safari à jour.');
    const essais = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: true, audio: false }, // ordinateur : n'importe quelle webcam
    ];
    let derniere;
    for (const c of essais) {
      try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) {
        derniere = e;
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break;
      }
    }
    throw new Error(messageErreur(derniere));
  }

  async function creerDecodeur() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          const d = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'].filter(f => formats.includes(f)) });
          return async (video) => (await d.detect(video))[0]?.rawValue || null;
        }
      } catch {}
    }
    await chargerScript(JSQR);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (video) => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return null;
      // Image réduite : plus rapide sur les petits téléphones, assez nette pour une étiquette
      const r = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
    };
  }

  /**
   * Démarre la caméra dans `conteneur`. Appelle surCode(numero) à chaque code lu
   * (le même code n'est renvoyé qu'après 2,5 s). Renvoie une fonction stop(),
   * avec stop.lampe(allumer) si l'appareil a une lampe torche.
   */
  async function demarrer(conteneur, surCode) {
    const flux = await ouvrirCamera();
    let actif = true, dernier = '', dernierLe = 0, minuteur;
    const video = document.createElement('video');
    video.className = 'video-scan';
    video.setAttribute('playsinline', ''); video.setAttribute('autoplay', ''); video.muted = true;
    video.srcObject = flux;
    conteneur.prepend(video);
    conteneur.classList.add('actif');
    try { await video.play(); } catch {}

    const arreter = async () => {
      actif = false; clearTimeout(minuteur);
      flux.getTracks().forEach(t => t.stop());
      video.remove(); conteneur.classList.remove('actif');
      document.removeEventListener('visibilitychange', surVisibilite);
    };
    // L'appli passe en arrière-plan : on coupe la caméra (batterie, vie privée)
    const surVisibilite = () => { if (document.hidden) arreter(); };
    document.addEventListener('visibilitychange', surVisibilite);

    let decoder;
    try { decoder = await creerDecodeur(); } catch (e) { await arreter(); throw e; }

    const boucle = async () => {
      if (!actif) return;
      if (video.readyState >= 2) {
        try {
          const brut = await decoder(video);
          if (brut) {
            const n = extraireNumero(brut);
            const t = Date.now();
            if (n !== dernier || t - dernierLe > 2500) { dernier = n; dernierLe = t; surCode(n); }
          }
        } catch {}
      }
      minuteur = setTimeout(boucle, 160);
    };
    boucle();

    const piste = flux.getVideoTracks()[0];
    const caps = piste?.getCapabilities?.() || {};
    if (caps.torch) arreter.lampe = (on) => piste.applyConstraints({ advanced: [{ torch: !!on }] }).catch(() => {});
    return arreter;
  }

  window.Scanner = { demarrer, bip, extraireNumero, messageErreur };
})();
