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
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ANDROID = /Android/.test(navigator.userAgent);
  // Navigateur intégré à une appli (Facebook, Instagram, TikTok, Snapchat…) : souvent sans caméra
  const DANS_APPLI = /FBAN|FBAV|Instagram|TikTok|Snapchat|Line\/|; wv\)/.test(navigator.userAgent);
  function messageErreur(e) {
    const astuce = ' Utilisez « Photo de l\'étiquette » en attendant.';
    if (DANS_APPLI) return `Ce navigateur intégré bloque la caméra. Ouvrez la page dans ${IOS ? 'Safari' : 'Chrome'} (menu ⋮ → « Ouvrir dans le navigateur »).${astuce}`;
    switch (e?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return IOS
          ? `Caméra refusée. Réglages → Safari → Caméra → « Autoriser », puis rechargez la page.${astuce}`
          : `Caméra refusée. Touchez le cadenas à gauche de l'adresse → Autorisations → Caméra → Autoriser. Vérifiez aussi Paramètres du téléphone → Applications → Chrome → Autorisations → Appareil photo.${astuce}`;
      case 'NotFoundError':
      case 'OverconstrainedError':
        return ANDROID
          ? `Le téléphone ne donne pas la caméra au navigateur. Vérifiez : 1) Paramètres → Applications → Chrome → Autorisations → Appareil photo : Autoriser ; 2) l'interrupteur « Accès à la caméra » des réglages rapides est activé.${astuce}`
          : IOS ? `La caméra n'est pas accessible. Réglages → Safari → Caméra → « Autoriser », et vérifiez Réglages → Temps d'écran → Restrictions.${astuce}`
          : `Aucune caméra trouvée sur cet appareil.${astuce}`;
      case 'NotReadableError':
      case 'AbortError':
        return `La caméra est utilisée par une autre application (appel vidéo, appareil photo…). Fermez-la et réessayez.${astuce}`;
      default:
        return `${e?.message || 'Caméra indisponible.'}${astuce}`;
    }
  }

  async function ouvrirCamera() {
    if (!window.isSecureContext) throw new Error('La caméra ne marche que sur une adresse sécurisée (https).');
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error(DANS_APPLI ? messageErreur({}) : `Ce navigateur ne donne pas accès à la caméra en direct. Utilisez « Photo de l'étiquette », ou ouvrez la page dans ${IOS ? 'Safari' : 'Chrome'}.`);
      err.code = 'sans_camera'; throw err;
    }
    // Du plus précis au plus simple : certains téléphones refusent une demande trop détaillée
    const essais = [
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false },
    ];
    let derniere;
    for (const c of essais) {
      try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) {
        derniere = e;
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break;
      }
    }
    // Dernier recours : demander chaque caméra par son identifiant (caméra arrière d'abord)
    if (derniere?.name !== 'NotAllowedError' && navigator.mediaDevices.enumerateDevices) {
      try {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        cams.sort((a, b) => (/back|rear|arri|environment|0$/i.test(b.label) ? 1 : 0) - (/back|rear|arri|environment|0$/i.test(a.label) ? 1 : 0));
        for (const cam of cams) {
          try { return await navigator.mediaDevices.getUserMedia({ video: cam.deviceId ? { deviceId: { exact: cam.deviceId } } : true, audio: false }); } catch (e) { derniere = e; }
        }
      } catch {}
    }
    const err = new Error(messageErreur(derniere));
    err.code = derniere?.name || 'inconnue';
    console.warn('Caméra :', derniere?.name, derniere?.message);
    throw err;
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
   * Lit le QR code d'une photo prise avec l'appareil photo du téléphone
   * (marche partout, même quand la caméra en direct est bloquée).
   * Renvoie le numéro, ou lève une erreur si aucun code n'est lisible.
   */
  async function lirePhoto(fichier) {
    let source;
    try { source = await createImageBitmap(fichier, { imageOrientation: 'from-image' }); }
    catch {
      source = await new Promise((ok, ko) => {
        const img = new Image(); const url = URL.createObjectURL(fichier);
        img.onload = () => { URL.revokeObjectURL(url); ok(img); };
        img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Photo illisible.')); };
        img.src = url;
      });
    }
    const W = source.width, H = source.height;
    if ('BarcodeDetector' in window) {
      try {
        const d = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'] });
        const r = await d.detect(source);
        if (r[0]?.rawValue) return extraireNumero(r[0].rawValue);
      } catch {}
    }
    await chargerScript(JSQR);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Plusieurs tailles et un recadrage au centre : une photo de téléphone est grande et le QR petit
    const zones = [[0, 0, W, H, 1200], [0, 0, W, H, 800], [W * 0.2, H * 0.2, W * 0.6, H * 0.6, 1000], [0, 0, W, H, 1800]];
    for (const [x, y, w, h, max] of zones) {
      const r = Math.min(1, max / Math.max(w, h));
      canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
      ctx.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) return extraireNumero(code.data);
    }
    throw new Error('QR code non lu sur la photo. Reprenez-la de plus près, bien à plat et nette, ou tapez le numéro.');
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

  window.Scanner = { demarrer, lirePhoto, bip, extraireNumero, messageErreur };
})();
