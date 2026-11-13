import { openPhotoCapture } from './foto.js';
// ═══ js/escaner.js — extraído de index.html (líneas 12461–12577 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════════════════
//  ESCÁNER DE CÓDIGO DE BARRAS — html5-qrcode
// ══════════════════════════════════════════════════════════════════════════════

let _scanTarget   = 'bus';   // panel destino: 'bus' | 'prec' | 'ubi' | 'conteo'
let _scanActive   = false;   // guard: evita doble disparo

function setScanStatus(msg, confirming){
  const el = document.getElementById('scanConfirmStatus');
  if(!el) return;
  el.textContent = msg;
  el.classList.toggle('confirming', !!confirming);
}

// (El manejador de código detectado quedó inlineado en el flujo de captura
// de foto — ver más abajo, "Foto deliberada → confianza inmediata" — tras
// una limpieza de un diseño anterior de escaneo cuadro-a-cuadro en vivo.)

// ── Abrir escáner ─────────────────────────────────────────────────────────
function openScanner(target) {
  _scanTarget   = target || 'bus';
  _scanActive   = true;
  document.getElementById('scanOverlay').classList.add('on');
  document.body.style.overflow = 'hidden';
  document.getElementById('scanFallbackWrap').style.display = 'none';
  setScanStatus('Abriendo cámara…', true);

  // Cámara nativa del SO: mejor enfoque/exposición automáticos que el
  // stream en vivo (getUserMedia), que en la práctica fallaba mucho más.
  openPhotoCapture();
}

// ── Cerrar y limpiar ──────────────────────────────────────────────────────
function closeScanner() {
  _scanActive = false;
  document.getElementById('scanOverlay').classList.remove('on');
  setScanStatus('', false);
  document.body.style.overflow = '';
}


// ── Mejora de imagen: gris → percentile-stretch → umbral adaptativo ────────
// Trabaja in-place sobre el ImageData para evitar allocaciones extras.
// (Usada por processPhotoFile — captura con cámara nativa.)
function _ppEnhance(imageData) {
  const d  = imageData.data;
  const n  = imageData.width * imageData.height;

  // Paso A: Convertir a escala de grises (ITU-R BT.601)
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    gray[i] = (77 * d[p] + 150 * d[p+1] + 29 * d[p+2]) >> 8;
  }

  // Paso B: Normalización por percentil 2 / 98 (robusta a ruido)
  // Usamos histograma de 256 bins (O(n) una sola pasada)
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;

  const lo = Math.floor(n * 0.02);
  const hi = Math.floor(n * 0.98);
  let accum = 0, pLo = 0, pHi = 255;
  for (let v = 0; v < 256; v++) {
    accum += hist[v];
    if (accum <= lo) pLo = v;
    if (accum <= hi) pHi = v;
  }
  const range = pHi - pLo || 1;
  for (let i = 0; i < n; i++) {
    gray[i] = Math.min(255, Math.max(0, ((gray[i] - pLo) * 255 / range + 0.5) | 0));
  }

  // Paso C: Umbralización adaptativa local (ventana ~12% del ancho)
  // Usa tabla de integrales para calcular medias locales en O(1) por píxel.
  const W = imageData.width;
  const H = imageData.height;
  const half = Math.max(5, ((W * 0.12) | 1));  // radio de ventana (debe ser ≥1)
  const C    = 8;  // bias: un píxel es "oscuro" si está C debajo de la media local

  // Tabla de integrales sobre los valores normalizados
  const iW = W + 1;
  const integral = new Float64Array(iW * (H + 1));
  for (let y = 1; y <= H; y++) {
    for (let x = 1; x <= W; x++) {
      integral[y * iW + x] =
        gray[(y-1) * W + (x-1)]
        + integral[(y-1) * iW + x]
        + integral[y * iW + (x-1)]
        - integral[(y-1) * iW + (x-1)];
    }
  }

  // Aplicar umbral y escribir de vuelta en el ImageData (RGB = binary)
  for (let y = 0; y < H; y++) {
    const y1 = Math.max(0, y - half);
    const y2 = Math.min(H - 1, y + half);
    for (let x = 0; x < W; x++) {
      const x1   = Math.max(0, x - half);
      const x2   = Math.min(W - 1, x + half);
      const area = (x2 - x1) * (y2 - y1) || 1;
      const sum  = integral[(y2+1)*iW+(x2+1)]
                 - integral[y1*iW+(x2+1)]
                 - integral[(y2+1)*iW+x1]
                 + integral[y1*iW+x1];
      const mean  = sum / area;
      const pixel = gray[y * W + x];
      const bin   = pixel < (mean - C) ? 0 : 255;
      const p     = (y * W + x) * 4;
      d[p] = d[p+1] = d[p+2] = bin;
      d[p+3] = 255;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════

export { _ppEnhance, _scanActive, _scanTarget, closeScanner, openScanner, setScanStatus };
export const set__scanActive = (v) => (_scanActive = v);
