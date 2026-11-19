// ═══ js/excel-worker-client.js — lee el .xlsx en un Web Worker (si se puede) ═══
// Interpretar un libro de varios MB congela la pantalla unos segundos si se hace en el hilo principal. En la versión
// compilada (dist/) la lectura corre en js/excel-parse.worker.js; si el Worker no está disponible o falla, se lee en el
// hilo principal como antes (nunca se pierde la carga). En desarrollo (carpeta raíz, sin compilar) se lee directo.
import { parseWorkbook } from './excel-parse.js';

const USE_WORKER = typeof __UBI_WORKER__ !== 'undefined' && __UBI_WORKER__;   // build.mjs lo define como true
const WORKER_URL = 'js/excel-parse.worker.js';
const WORKER_TIMEOUT_MS = 45000;

function parseInMainThread(buf, opts){
  // Un respiro antes de empezar para que la barra de progreso alcance a pintarse.
  return new Promise(r => setTimeout(r, 0)).then(() => parseWorkbook(globalThis.XLSX, buf, opts));
}

export function parseExcelBuffer(buf, opts = {}){
  if(!USE_WORKER || typeof Worker === 'undefined') return parseInMainThread(buf, opts);
  return new Promise((resolve, reject) => {
    let w, timer, settled = false;
    const finish = (fn, v) => { if(settled) return; settled = true; clearTimeout(timer); try{ w && w.terminate(); }catch(e){} fn(v); };
    const fallback = () => { if(settled) return; settled = true; clearTimeout(timer); try{ w && w.terminate(); }catch(e){} parseInMainThread(buf, opts).then(resolve, reject); };
    try{ w = new Worker(WORKER_URL); }catch(e){ return fallback(); }
    timer = setTimeout(fallback, WORKER_TIMEOUT_MS);
    w.onmessage = (ev) => { const d = ev.data || {}; if(d.error || !d.data) fallback(); else finish(resolve, d.data); };
    w.onerror = () => fallback();
    const copy = buf.slice(0);                 // se transfiere una copia: el original queda para el plan B
    try{ w.postMessage({ buf: copy, opts }, [copy]); }catch(e){ fallback(); }
  });
}
