import { goTab } from './ui-header-tabs.js';
import { doSearch, setBM } from './buscador.js';
import { doPrec, setPM } from './precios.js';
import { doUbi } from './ubicaciones.js';
import { closeQRShelfModal } from './modales-estante-panorama.js';
import { _ppEnhance, _scanActive, _scanTarget, closeScanner, setScanStatus, set__scanActive } from './escaner.js';
import { pushHist } from './tema-historial.js';
import { conteoLibreSearch } from './conteo.js';
// ═══ js/foto.js — extraído de index.html (líneas 12578–12791 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════════════
// CAPTURA DE FOTO NATIVA — Punto 4 del diagnóstico
//
// Flujo:
//   openPhotoCapture() → <input capture="environment"> → cámara nativa SO
//   → handlePhotoCapture() → processPhotoFile()
//      ├─ Intento A: recorte central (proporción qrbox) ×2 + _ppEnhance
//      └─ Intento B: imagen completa escalada + _ppEnhance
//   → _tryDecodeCanvas()
//      ├─ BarcodeDetector (Chrome/Android/Edge)
//      └─ Html5Qrcode.scanFileV2 (iOS/universal)
//   → éxito: beep + vibrate + closeScanner() + fillAndSearch()
//   → fallo: mensaje de reintento, escáner en vivo sigue activo
// ══════════════════════════════════════════════════════════════════════════

function openPhotoCapture() {
  const inp = document.getElementById('scanPhotoInput');
  if (!inp) return;
  inp.value = '';  // permite volver a capturar la misma foto
  inp.click();
}

function handlePhotoCapture(input) {
  const file = input?.files?.[0];
  if (!file) return;
  input.value = '';
  processPhotoFile(file);
}

async function processPhotoFile(file) {
  setScanStatus('📸 Procesando foto…', true);

  try {
    const bitmap = await createImageBitmap(file);
    const imgW   = bitmap.width;
    const imgH   = bitmap.height;

    // Escalar si la foto es muy grande (evita OOM con fotos 12MP+)
    const MAX   = 2000;
    const scale = Math.min(1, MAX / Math.max(imgW, imgH));

    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const sW = Math.round(imgW * scale);  // dimensiones escaladas
    const sH = Math.round(imgH * scale);

    // ── Intento A: recorte central (misma proporción que el qrbox) ×2 ──────
    // El usuario encuadró el código; asumimos que está centrado en la foto.
    const cW   = Math.floor(Math.min(sW, sH) * 0.9);
    const cH   = Math.floor(cW * 0.5);
    // Traducir recorte a coordenadas del bitmap original (sin escalar)
    const srcW = Math.round(cW / scale);
    const srcH = Math.round(cH / scale);
    const srcX = Math.round((imgW - srcW) / 2);
    const srcY = Math.round((imgH - srcH) / 2);

    canvas.width  = cW * 2;
    canvas.height = cH * 2;
    ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

    let idata = ctx.getImageData(0, 0, canvas.width, canvas.height);
    _ppEnhance(idata);
    ctx.putImageData(idata, 0, 0);

    let decoded = await _tryDecodeCanvas(canvas);

    // ── Intento B: imagen completa escalada + mejora (sin recorte) ──────────
    // Cubre casos donde el código no está perfectamente centrado.
    if (!decoded) {
      canvas.width  = sW;
      canvas.height = sH;
      ctx.drawImage(bitmap, 0, 0, sW, sH);
      idata = ctx.getImageData(0, 0, sW, sH);
      _ppEnhance(idata);
      ctx.putImageData(idata, 0, 0);
      decoded = await _tryDecodeCanvas(canvas);
    }

    bitmap.close();

    if (decoded) {
      const cleanCode = decoded.trim().toUpperCase();
      if (cleanCode && _scanActive) {
        // Foto deliberada → confianza inmediata, sin esperar hits de confirmación
        set__scanActive( false);
        playScanBeep();
        if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
        closeScanner();
        fillAndSearch(cleanCode);
      }
    } else {
      setScanStatus('❌ No se detectó código — acerca más e intenta de nuevo', false);
      setTimeout(() => setScanStatus('Encuadra el código…', false), 3000);
    }

  } catch(err) {
    console.error('Photo decode error:', err);
    setScanStatus('Error al procesar la foto', false);
    setTimeout(() => setScanStatus('Encuadra el código…', false), 2500);
  }
}

// Intenta decodificar un canvas con BarcodeDetector (si disponible) o con
// Html5Qrcode.scanFileV2 como fallback universal. Devuelve el string crudo
// del primer código encontrado, o null si no hay código.
async function _tryDecodeCanvas(canvas) {

  // ── Ruta 1: BarcodeDetector nativo (Chrome 83+, Android, Edge) ──────────
  if (typeof BarcodeDetector !== 'undefined') {
    try {
      const sup  = await BarcodeDetector.getSupportedFormats();
      const want = ['code_128','code_39','code_93','ean_13','ean_8',
                    'upc_a','upc_e','itf','qr_code','codabar'];
      const fmts = want.filter(f => sup.includes(f));
      const bd   = new BarcodeDetector({ formats: fmts.length ? fmts : ['code_128','ean_13'] });
      const bmp = await createImageBitmap(canvas);
      const res  = await bd.detect(bmp);
      bmp.close();
      if (res?.length > 0 && res[0].rawValue) return res[0].rawValue;
    } catch(e) { /* sin código */ }
  }

  // ── Ruta 2: Html5Qrcode sobre imagen estática (iOS / universal) ─────────
  if (typeof Html5Qrcode !== 'undefined') {
    let dec;
    try { dec = new Html5Qrcode('pp-reader'); } catch(e) {}
    if (dec) {
      try {
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
        if (blob) {
          const result = await dec.scanFileV2(new File([blob], 's.jpg', { type: 'image/jpeg' }), false);
          try { dec.clear(); } catch(e) {}
          if (result?.decodedText) return result.decodedText;
        }
      } catch(e) {
        try { dec.clear(); } catch(e2) {}
      }
    }
  }

  return null;
}

// ── Rellenar el input destino y lanzar búsqueda ───────────────────────────
function fillAndSearch(code){
  switch(_scanTarget){

    case 'bus':
      document.getElementById('busQ').value = code;
      setBM('PAR');
      pushHist('bus', code);
      doSearch();
      goTab('bus', document.querySelector('.tab[data-tab="bus"]'));
      break;

    case 'prec':
      document.getElementById('precQ').value = code;
      setPM('PAR');
      pushHist('prec', code);
      doPrec();
      goTab('prec', document.querySelector('.tab[data-tab="prec"]'));
      break;

    case 'ubi':
      document.getElementById('ubiQ').value = code;
      pushHist('ubi', code);
      doUbi();
      goTab('ubi', document.querySelector('.tab[data-tab="ubi"]'));
      break;

    case 'conteo':
      const cq = document.getElementById('conteoLibreQ');
      if(cq){ cq.value = code; conteoLibreSearch(); }
      break;
  }
}

// ── Fallback manual (cuando no hay HTTPS / cámara) ───────────────────────
function scanFallbackSubmit(){
  const input = document.getElementById('scanFallbackInput');
  const code  = (input?.value || '').trim().toUpperCase();
  if(!code) return;
  input.value = '';
  closeScanner();
  fillAndSearch(code);
}

function playScanBeep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 1760;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
  } catch(e){}
}

// Cerrar con Escape
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(document.getElementById('scanOverlay')?.classList.contains('on')){closeScanner();return;}
    if(document.getElementById('qrSmOverlay')?.classList.contains('on'))closeQRShelfModal();
  }
});

export { handlePhotoCapture, openPhotoCapture, scanFallbackSubmit };
