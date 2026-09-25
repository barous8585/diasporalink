// ─────────────────────────────────────────────────────────────
//  Scanner de QR code / code-barres
//  1. BarcodeDetector (Chrome Android) — natif, rapide, hors-ligne
//  2. sinon html5-qrcode (iPhone…) chargé depuis le CDN puis gardé en cache
//  Une douchette USB/Bluetooth fonctionne aussi : elle tape le numéro + Entrée
//  dans le champ de saisie.
// ─────────────────────────────────────────────────────────────
(function () {
  const LIB = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';

  function chargerScript(src) {
    return new Promise((ok, ko) => {
      if (document.querySelector(`script[src="${src}"]`)) return ok();
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Scanner indisponible hors-ligne. Tapez le numéro.'));
      document.head.appendChild(s);
    });
  }

  // Petit bip + vibration : l'agent sait sans regarder que le scan est passé
  let audio;
  function bip(ok = true) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(); const g = audio.createGain();
      o.frequency.value = ok ? 1100 : 300; g.gain.value = 0.08;
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.09 : 0.3));
    } catch {}
    try { navigator.vibrate?.(ok ? 60 : [80, 60, 80]); } catch {}
  }

  // Extrait le numéro d'un QR : accepte « KL-26-00012 » ou une URL de suivi
  function extraireNumero(texte) {
    const t = String(texte || '').trim();
    const m = t.match(/[A-Z]{2,4}-\d{2}-\d{4,6}/i);
    return (m ? m[0] : t).toUpperCase();
  }

  /**
   * Démarre la caméra dans `conteneur`. Appelle surCode(numero) à chaque code lu
   * (le même code n'est renvoyé qu'après 2,5 s). Renvoie une fonction stop().
   */
  async function demarrer(conteneur, surCode) {
    let dernier = '', dernierLe = 0, actif = true;
    const emettre = (brut) => {
      const n = extraireNumero(brut);
      const maintenant = Date.now();
      if (n === dernier && maintenant - dernierLe < 2500) return;
      dernier = n; dernierLe = maintenant;
      surCode(n);
    };

    if ('BarcodeDetector' in window) {
      const formats = await BarcodeDetector.getSupportedFormats().catch(() => []);
      if (formats.includes('qr_code')) {
        const video = document.createElement('video');
        video.setAttribute('playsinline', ''); video.muted = true;
        conteneur.prepend(video);
        const flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = flux; await video.play();
        const detecteur = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'].filter(f => formats.includes(f)) });
        const boucle = async () => {
          if (!actif) return;
          try { const codes = await detecteur.detect(video); if (codes[0]) emettre(codes[0].rawValue); } catch {}
          setTimeout(boucle, 180);
        };
        boucle();
        return () => { actif = false; flux.getTracks().forEach(t => t.stop()); video.remove(); };
      }
    }

    await chargerScript(LIB);
    const zone = document.createElement('div');
    zone.id = `zone-scan-${Date.now()}`;
    zone.style.cssText = 'position:absolute;inset:0';
    conteneur.prepend(zone);
    const lecteur = new window.Html5Qrcode(zone.id, { verbose: false });
    await lecteur.start({ facingMode: 'environment' }, { fps: 8, qrbox: { width: 220, height: 220 } }, (t) => emettre(t), () => {});
    return async () => { actif = false; try { await lecteur.stop(); } catch {} zone.remove(); };
  }

  window.Scanner = { demarrer, bip, extraireNumero };
})();
