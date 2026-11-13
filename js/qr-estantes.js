import { qrDataUrl } from './qr-local.js';
import { ESTANTES, QR_SELECTED, QR_SEL_MODE } from './state-globals.js';
import { escHtml, jsAttrSafe } from './utils.js';
// ═══ js/qr-estantes.js — extraído de index.html (líneas 15278–15402 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ── SECCIÓN QR DE ESTANTES ────────────────────────────────────────────────
function toggleEstQrSection(){
  const hdr=document.getElementById('estQrHdr');
  const body=document.getElementById('estQrBody');
  if(!hdr||!body)return;
  const isOpen=hdr.classList.contains('open');
  if(!isOpen){hdr.classList.add('open');body.classList.add('open');renderPanoQrCard();renderEstQRGrid();}
  else{hdr.classList.remove('open');body.classList.remove('open');}
}

// Tarjeta QR única para el Panorama General (totales de toda la bodega),
// separada de la cuadrícula por estante — misma pegatina física sirve para
// que el auditor arranque su recorrido viendo el total antes de ir estante
// por estante.
function renderPanoQrCard(){
  const wrap=document.getElementById('panoQrWrap');
  if(!wrap)return;
  const base=getQRBaseURL();
  const url=`${base}?panorama=1`;
  const qrSrc=qrDataUrl(url,260);
  wrap.innerHTML=`<div style="display:flex;align-items:center;gap:14px;background:var(--bg2);border:1px solid rgba(192,57,43,.3);border-radius:10px;padding:12px 14px;flex-wrap:wrap">
    <img src="${qrSrc}" width="86" height="86" style="border-radius:6px;cursor:pointer;flex-shrink:0" loading="lazy" alt="QR Panorama General" onclick="openPanoramaModal()" title="Ver panorama general">
    <div style="flex:1;min-width:180px">
      <div style="font-family:var(--mono);font-size:12px;font-weight:800;color:var(--text);letter-spacing:.04em">📊 QR — Panorama General</div>
      <div style="font-family:var(--sans);font-size:11px;color:var(--text2);margin-top:3px;line-height:1.5">Este QR va a todos los totales de ubicaciones y referencias — para pegar en la entrada de la bodega.</div>
    </div>
    <div style="display:flex;gap:8px;flex-shrink:0">
      <button class="sbtn" style="height:34px;font-size:10px" onclick="openPanoramaModal()">👁 Ver ahora</button>
      <button class="xbtn" style="height:34px;font-size:10px" onclick="printPanoramaQR()">🖨 Imprimir</button>
    </div>
  </div>`;
}

function printPanoramaQR(){
  const base=getQRBaseURL();
  const url=`${base}?panorama=1`;
  const qrSrc=qrDataUrl(url,600);
  const now=new Date().toLocaleString('es-CO');
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR Panorama General Toyota</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#fff;padding:16px;display:flex;flex-direction:column;align-items:center}
  h1{font-size:14px;color:#c0392b;margin-bottom:4px}.meta{font-size:9px;color:#888;margin-bottom:16px}
  .card{display:inline-flex;flex-direction:column;align-items:center;border:2px solid #c0392b;border-radius:10px;padding:16px 20px;width:240px}
  img{image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges}
  @media print{@page{margin:8mm}}</style>
  </head><body>
  <h1>📊 QR Panorama General — Toyota Control UBI</h1>
  <div class="meta">Generado: ${now} · Totales de ubicaciones y referencias de toda la bodega</div>
  <div class="card">
    <div style="font-size:8px;color:#888;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Toyota · Control UBI</div>
    <img src="${qrSrc}" width="200" height="200" style="border-radius:4px;display:block;margin-bottom:8px">
    <div style="font-size:16px;font-weight:800;color:#111;letter-spacing:.03em;text-align:center">PANORAMA GENERAL</div>
    <div style="font-size:9px;color:#555;margin-top:2px">Escanear para ver totales</div>
  </div>
  </body></html>`);
  w.document.close();
  setTimeout(()=>{try{w.focus();w.print();}catch(e){}},800);
}

function getQRBaseURL(){
  // Base URL de la página actual sin parámetros
  return window.location.href.split('?')[0];
}

function renderEstQRGrid(){
  const grid=document.getElementById('estQrGrid');
  if(!grid)return;
  if(!ESTANTES.length){
    grid.innerHTML='<div style="font-family:var(--mono);font-size:10px;color:var(--text3);padding:10px 0">Carga un Excel con hoja DASH_ESTANTES para generar QRs.</div>';
    return;
  }
  const base=getQRBaseURL();
  const pctColor=p=>p>=0.4?'#1fc76a':p>=0.2?'#e89c20':p>=0.1?'#e89c20':'#e84040';
  grid.classList.toggle('qr-sel-mode',QR_SEL_MODE);
  grid.innerHTML=ESTANTES.map(e=>{
    const url=`${base}?estante=${encodeURIComponent(e[0])}`;
    const qrSrc=qrDataUrl(url,300);
    const pct100=Math.round(e[4]*100);
    const bc=pctColor(e[4]);
    const estSafe=escHtml(e[0]);
    const isSel=QR_SELECTED.has(e[0]);
    return `<div class="qr-card-wrap${isSel?' qr-selected':''}" data-est="${estSafe}">
      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:12px;text-align:center;cursor:pointer;transition:border-color .15s" onclick="toggleQRCard('${jsAttrSafe(e[0])}')" title="${QR_SEL_MODE?'Seleccionar':'Ver tarjeta de'} ${estSafe}">
        <img src="${qrSrc}" width="110" height="110" style="border-radius:6px;display:block;margin:0 auto 8px" loading="lazy" alt="QR ${estSafe}">
        <div style="font-family:var(--mono);font-size:14px;font-weight:800;color:var(--text);margin-bottom:3px">${estSafe}</div>
        <div style="font-family:var(--mono);font-size:9px;color:${bc};margin-bottom:2px">${pct100}% libre</div>
        <div style="font-family:var(--mono);font-size:8px;color:var(--text3)">${e[1]} ubis</div>
      </div>
      <div class="qr-card-check">${isSel?'✓':''}</div>
    </div>`;
  }).join('');
}

function printEstQRSheet(){
  if(!ESTANTES.length){alert('Carga un Excel con DASH_ESTANTES primero.');return;}
  const base=getQRBaseURL();
  const now=new Date().toLocaleString('es-CO');
  const cards=ESTANTES.map(e=>{
    const url=`${base}?estante=${encodeURIComponent(e[0])}`;
    const qrSrc=qrDataUrl(url,600);
    const pct100=Math.round(e[4]*100);
    return `<div style="display:inline-flex;flex-direction:column;align-items:center;border:2px solid #c0392b;border-radius:10px;padding:10px 12px;margin:8px;width:160px;page-break-inside:avoid">
      <div style="font-size:8px;color:#888;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px">Toyota · Control UBI</div>
      <img src="${qrSrc}" width="140" height="140" style="border-radius:4px;display:block;margin-bottom:6px">
      <div style="font-size:20px;font-weight:800;color:#111;letter-spacing:.04em">${e[0]}</div>
      <div style="font-size:9px;color:#555;margin-top:2px">ESTANTE · ${e[1]} ubi</div>
    </div>`;
  }).join('');

  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR Estantes Toyota</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#fff;padding:16px}
  h1{font-size:14px;color:#c0392b;margin-bottom:4px}.meta{font-size:9px;color:#888;margin-bottom:12px}
  .grid{display:flex;flex-wrap:wrap;justify-content:flex-start}
  img{image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges}
  @media print{@page{margin:8mm}h1,div{page-break-inside:avoid}}</style>
  </head><body>
  <h1>🏢 QR Estantes — Toyota Control UBI</h1>
  <div class="meta">Generado: ${now} · ${ESTANTES.length} estantes · Escanear para auditoría rápida</div>
  <div class="grid">${cards}</div>
  </body></html>`);
  w.document.close();
  setTimeout(()=>{try{w.focus();w.print();}catch(e){}},800);
}

export { getQRBaseURL, printEstQRSheet, printPanoramaQR, renderEstQRGrid, toggleEstQrSection };
