import { INV_IDX } from './state-globals.js';
import { normCode } from './file-upload.js';
import { escHtml, jsAttrSafe } from './utils.js';
import { novFmtCOP } from './radar-cambios.js';
// ═══ js/radar-precios.js — extraído de index.html (líneas 11199–11390 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════════════════
//  RADAR DE PRECIOS EN LA NUBE — historial compartido, persistente entre
//  sesiones y dispositivos (Firestore). Antes el radar de cambios completo
//  vivía solo en localStorage: (1) por dispositivo, se perdía si alguien
//  limpiaba el navegador o entraba desde otro equipo, y (2) el "antes" para
//  comparar solo existía en memoria de ESA pestaña — si el Excel se
//  actualizaba en GitHub con la pestaña cerrada, el próximo que la abriera
//  arrancaba con INV vacío y el cambio de precio quedaba invisible para
//  siempre. Con precios ya cambiando mes a mes, eso significaba perder
//  comparativas reales.
//  Este módulo SOLO cubre precios (Mostrador/Costo) — es lo que pidieron
//  llevar a la nube; stock/ubicación/nuevo/removido siguen como antes
//  (radar local, ver NOV_CHANGES_KEY más abajo).
//  Un registro por referencia: guarda el precio ACTUAL (línea base para el
//  próximo diff) + un arreglo `hist` con cada cambio real detectado
//  (ts + valores) — la comparativa mes a mes que se pidió.
//
//  NOTA (04/09/2026): esta sección quedó 100% LOCAL a propósito — dejó de
//  usar Firestore (ni lecturas ni escrituras) tras el diagnóstico de cuota
//  gratuita excedida. La comparativa vive en localStorage, por dispositivo
//  (no se comparte entre el equipo, pero deja de sumar carga a la nube).
const RADAR_PRICE_LOCAL_KEY = 'ctrl_ubi_radar_precio_cache';
const RADAR_PRICE_HIST_KEY  = 'ctrl_ubi_radar_precio_hist';
let RADAR_PRICE_BASELINE = {};   // cod -> [mostrador, accesorios, costo] — última base conocida (local)
let RADAR_PRICE_HIST = {};       // cod -> [{ts,mostrador,accesorios,costo,prevMostrador,prevAccesorios,prevCosto}, ...]

function radarPriceSaveLocalCache(){
  try{ localStorage.setItem(RADAR_PRICE_LOCAL_KEY, JSON.stringify(RADAR_PRICE_BASELINE)); }catch(e){}
  try{ localStorage.setItem(RADAR_PRICE_HIST_KEY, JSON.stringify(RADAR_PRICE_HIST)); }catch(e){}
}
function radarPriceLoadLocalCache(){
  try{
    const raw = localStorage.getItem(RADAR_PRICE_LOCAL_KEY);
    if(raw) RADAR_PRICE_BASELINE = JSON.parse(raw) || {};
  }catch(e){}
  try{
    const rawH = localStorage.getItem(RADAR_PRICE_HIST_KEY);
    if(rawH) RADAR_PRICE_HIST = JSON.parse(rawH) || {};
  }catch(e){}
}
function startRadarPriceListener(){
  radarPriceLoadLocalCache();
}
// Compara los precios recién cargados contra RADAR_PRICE_BASELINE (la base
// local conocida) y guarda en localStorage solo lo que realmente cambió,
// dejando además la referencia sembrada para la próxima comparación aunque
// no haya cambiado nada esta vez. 100% local — no toca Firestore.
async function syncRadarPriceCloud(afterPrices){
  if(!afterPrices) return;
  try{
    const now=Date.now();
    for(const cod in afterPrices){
      const a=afterPrices[cod]; // [mostrador, accesorios, costo]
      const b=RADAR_PRICE_BASELINE[cod];
      const changed = b && (Number(b[0])!==a[0] || Number(b[2])!==a[2]); // Mostrador o Costo
      if(changed){
        if(!Array.isArray(RADAR_PRICE_HIST[cod])) RADAR_PRICE_HIST[cod]=[];
        RADAR_PRICE_HIST[cod].push({
          ts:now, mostrador:a[0], accesorios:a[1], costo:a[2],
          prevMostrador:Number(b[0])||0, prevAccesorios:Number(b[1])||0, prevCosto:Number(b[2])||0
        });
      }
      RADAR_PRICE_BASELINE[cod]=a;
    }
    radarPriceSaveLocalCache();
  }catch(e){
    console.warn('[Radar de precios] No se pudo actualizar la comparación local:', e);
  }
}

// ── Vista "Historial de precios (local)" — comparativa completa ANTES vs
//    AHORA de todas las referencias que han cambiado, en una sola tabla
//    (no una por una). Se lee de localStorage (RADAR_PRICE_HIST) al abrir
//    el modal — sin red, sin Firestore — y de ahí en adelante el buscador
//    solo filtra en memoria.
let RPH_BULK = null; // [{cod, hist:[{ts,mostrador,accesorios,costo,prevMostrador,prevAccesorios,prevCosto}, ...]}]

function openRadarPriceHistory(cod){
  document.getElementById('radarPriceOverlay').classList.add('on');
  document.getElementById('rphDetail').innerHTML='';
  document.getElementById('rphSearch').value=cod||'';
  rphLoadBulk().then(()=>{ if(cod) rphExpand(cod); });
}
function closeRadarPriceHistory(){
  document.getElementById('radarPriceOverlay').classList.remove('on');
}
async function rphLoadBulk(){
  const results=document.getElementById('rphResults');
  results.innerHTML='<div style="padding:16px 0;text-align:center;color:var(--text3);font-family:var(--mono);font-size:11px">Cargando comparativa local…</div>';
  try{
    const rows=[];
    for(const cod in RADAR_PRICE_HIST){
      const hist=Array.isArray(RADAR_PRICE_HIST[cod])?RADAR_PRICE_HIST[cod]:[];
      if(!hist.length) continue; // nunca ha cambiado — nada que comparar, se omite
      rows.push({cod, hist:[...hist].sort((a,b)=>a.ts-b.ts)});
    }
    RPH_BULK=rows;
    rphRenderBulk();
  }catch(e){
    results.innerHTML=`<div class="nov-empty-txt" style="padding:14px 0">⚠️ No se pudo cargar la comparativa local (${escHtml(e.message||'error')}).</div>`;
  }
}
function rphSearch(){ rphRenderBulk(); }
function rphRenderBulk(){
  const results=document.getElementById('rphResults');
  if(!RPH_BULK) return;
  const q=(document.getElementById('rphSearch').value||'').trim().toUpperCase();
  let rows=RPH_BULK;
  if(q){
    rows=rows.filter(r=>{
      const inv=INV_IDX.get(normCode(r.cod));
      return r.cod.toUpperCase().includes(q) || (inv&&String(inv[1]||'').toUpperCase().includes(q));
    });
  }
  if(!rows.length){
    results.innerHTML=`<div class="nov-empty-txt" style="padding:14px 0">⚠️ ${q?'Sin referencias con cambios que coincidan.':'Todavía no hay ninguna referencia con cambios registrados en este dispositivo.'}</div>`;
    return;
  }
  // El cambio más reciente de cada referencia primero
  rows=[...rows].sort((a,b)=> b.hist[b.hist.length-1].ts - a.hist[a.hist.length-1].ts);
  const fmtDelta=v=>v===0?'—':`<span style="color:${v>0?'var(--red)':'var(--green)'};font-weight:700">${v>0?'+':''}$${novFmtCOP(Math.abs(v))}</span>`;
  results.innerHTML=`<div style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:8px">${rows.length} referencia${rows.length===1?'':'s'} con cambios de precio · toca una fila para ver su historial completo</div>
  <div style="overflow-x:auto"><table class="nov-tbl" style="width:100%;min-width:600px">
    <thead><tr>
      <th class="nov-td">Código</th>
      <th class="nov-td nov-td-val">Mostrador antes</th>
      <th class="nov-td nov-td-val">Mostrador ahora</th>
      <th class="nov-td nov-td-delta">Δ</th>
      <th class="nov-td nov-td-val">Costo antes</th>
      <th class="nov-td nov-td-val">Costo ahora</th>
      <th class="nov-td nov-td-delta">Δ</th>
    </tr></thead>
    <tbody>${rows.map(r=>{
      const last=r.hist[r.hist.length-1];
      const dM=last.mostrador-last.prevMostrador, dC=last.costo-last.prevCosto;
      const inv=INV_IDX.get(normCode(r.cod));
      const desc=inv?escHtml(inv[1]||''):'';
      const moreBadge=r.hist.length>1?`<span class="nov-occ" style="margin-left:6px">×${r.hist.length}</span>`:'';
      return `<tr style="cursor:pointer" onclick="rphExpand('${jsAttrSafe(r.cod)}')">
        <td class="nov-td"><div style="font-family:var(--mono);font-weight:700;font-size:11px">${escHtml(r.cod)}${moreBadge}</div><div style="font-size:10px;color:var(--text3);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${desc}</div></td>
        <td class="nov-td nov-td-val">$${novFmtCOP(last.prevMostrador)}</td>
        <td class="nov-td nov-td-val">$${novFmtCOP(last.mostrador)}</td>
        <td class="nov-td nov-td-delta">${fmtDelta(dM)}</td>
        <td class="nov-td nov-td-val">$${novFmtCOP(last.prevCosto)}</td>
        <td class="nov-td nov-td-val">$${novFmtCOP(last.costo)}</td>
        <td class="nov-td nov-td-delta">${fmtDelta(dC)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}
// Historial completo de UNA referencia (todas las veces que ha cambiado,
// no solo la última) — se abre debajo de la tabla al tocar una fila.
function rphExpand(cod){
  if(!RPH_BULK) return;
  const row=RPH_BULK.find(r=>r.cod===cod);
  const area=document.getElementById('rphDetail');
  if(!row||!area) return;
  const fmtDelta=v=>v===0?'—':`<span style="color:${v>0?'var(--red)':'var(--green)'};font-weight:700">${v>0?'+':''}$${novFmtCOP(Math.abs(v))}</span>`;
  const rowsHtml=[...row.hist].sort((a,b)=>b.ts-a.ts).map(h=>{
    const fecha=new Date(h.ts).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'});
    const dM=h.mostrador-h.prevMostrador, dC=h.costo-h.prevCosto;
    return `<tr>
      <td class="nov-td nov-td-fecha">${fecha}</td>
      <td class="nov-td nov-td-val">$${novFmtCOP(h.prevMostrador)}</td>
      <td class="nov-td nov-td-val">$${novFmtCOP(h.mostrador)}</td>
      <td class="nov-td nov-td-delta">${fmtDelta(dM)}</td>
      <td class="nov-td nov-td-val">$${novFmtCOP(h.prevCosto)}</td>
      <td class="nov-td nov-td-val">$${novFmtCOP(h.costo)}</td>
      <td class="nov-td nov-td-delta">${fmtDelta(dC)}</td>
    </tr>`;
  }).join('');
  area.innerHTML=`<div class="sbox" style="margin-top:10px">
    <div class="slbl" style="display:flex;align-items:center;justify-content:space-between">
      <span>📈 Historial completo — ${escHtml(cod)}</span>
      <button class="xbtn" onclick="document.getElementById('rphDetail').innerHTML=''">✕ Cerrar</button>
    </div>
    <div style="overflow-x:auto"><table class="nov-tbl" style="width:100%;min-width:600px;margin-top:8px">
      <thead><tr>
        <th class="nov-td nov-td-fecha">Fecha</th>
        <th class="nov-td nov-td-val">Mostrador antes</th>
        <th class="nov-td nov-td-val">Mostrador ahora</th>
        <th class="nov-td nov-td-delta">Δ</th>
        <th class="nov-td nov-td-val">Costo antes</th>
        <th class="nov-td nov-td-val">Costo ahora</th>
        <th class="nov-td nov-td-delta">Δ</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  </div>`;
  area.scrollIntoView({behavior:'smooth',block:'nearest'});
}

export { RADAR_PRICE_BASELINE, closeRadarPriceHistory, openRadarPriceHistory, radarPriceSaveLocalCache, rphExpand, rphSearch, startRadarPriceListener, syncRadarPriceCloud };
