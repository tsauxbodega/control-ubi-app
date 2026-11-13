import { ESTANTES } from './state-globals.js';
import { goTab } from './ui-header-tabs.js';
import { jsAttrSafe } from './utils.js';
import { CONTEO_ESTANTE, CONTEO_STORE, buildConteoshelfGrid, loadConteoEstante, set_CONTEO_ESTANTE } from './conteo.js';
// ═══ js/estantes.js — extraído de index.html (líneas 9619–9745 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== ESTANTES =====================
// Texto del mini buscador de estantes (''=todos). Filtra EN VIVO con
// cada tecla — no requiere elegir una sugerencia de una lista aparte.
let estNameFilter='';
function estFilterLive(q){
  estNameFilter=(q||'').trim().toUpperCase();
  renderEstantes();
}

function renderEstantes(){
  const fil = document.getElementById('estFilter').value;
  const srt = document.getElementById('estSort').value;

  if(!ESTANTES.length){
    document.getElementById('estBody').innerHTML=`<div class="nodatabanner"><div class="ndi">🏢</div><div class="ndm">No hay datos de estantes</div><div class="nds">Carga un Excel con la hoja DASH_ESTANTES</div></div>`;
    return;
  }

  let rows = [...ESTANTES];
  if(estNameFilter) rows = rows.filter(r=>r[0].toUpperCase().includes(estNameFilter));
  if(fil==='ok')   rows = rows.filter(r=>r[4]>=0.2);
  if(fil==='warn') rows = rows.filter(r=>r[4]<0.2);
  if(srt==='pct_asc')  rows.sort((a,b)=>a[4]-b[4]);
  else if(srt==='pct_desc') rows.sort((a,b)=>b[4]-a[4]);
  else if(srt==='total')    rows.sort((a,b)=>b[1]-a[1]);
  else rows.sort((a,b)=>a[0].localeCompare(b[0]));

  const pctColor = p =>
    p>=0.4 ? 'var(--green)' :
    p>=0.2 ? 'var(--amber)' :
    p>=0.1 ? 'var(--gold)'  : 'var(--red)';

  const urgBadge = p => {
    if(p>=0.4) return `<span style="font-family:var(--mono);font-size:8px;padding:2px 6px;border-radius:4px;background:rgba(31,199,106,.12);color:var(--green);border:1px solid rgba(31,199,106,.25)">HOLGADO</span>`;
    if(p>=0.2) return `<span style="font-family:var(--mono);font-size:8px;padding:2px 6px;border-radius:4px;background:rgba(232,156,32,.12);color:var(--gold2);border:1px solid rgba(232,156,32,.25)">PRECAUCIÓN</span>`;
    if(p>=0.1) return `<span style="font-family:var(--mono);font-size:8px;padding:2px 6px;border-radius:4px;background:rgba(192,57,43,.12);color:var(--amber);border:1px solid rgba(192,57,43,.25)">CRÍTICO</span>`;
    return             `<span style="font-family:var(--mono);font-size:8px;padding:2px 6px;border-radius:4px;background:rgba(232,64,64,.15);color:var(--red);border:1px solid rgba(232,64,64,.3)">LLENO</span>`;
  };

  const occupColor = pOcu =>
    pOcu >= 90 ? 'var(--red)'   :
    pOcu >= 80 ? 'var(--amber)' :
    pOcu >= 60 ? 'var(--gold)'  : 'var(--blue)';

  const sparkBar = (ocu, lib, total) => {
    const pOcu = Math.round((ocu/total)*100);
    const pLib = Math.round((lib/total)*100);
    const oc = occupColor(pOcu);
    return `<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;width:100%;gap:1px">
      <div style="flex:${pOcu};background:${oc};opacity:.75"></div>
      <div style="flex:${pLib};background:var(--green);opacity:.8"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:3px">
      <span style="font-family:var(--mono);font-size:7px;color:${oc}">Ocup. ${pOcu}%</span>
      <span style="font-family:var(--mono);font-size:7px;color:var(--green)">Libre ${pLib}%</span>
    </div>`;
  };

  const diffCount  = est => (CONTEO_STORE[est]||[]).filter(d=>d.conteo!==null&&d.conteo!==d.sistema).length;
  const conteoCount= est => (CONTEO_STORE[est]||[]).filter(d=>d.conteo!==null).length;

  document.getElementById('estBody').innerHTML = rows.map(r=>{
    const pct    = r[4];
    const pct100 = Math.round(pct*100);
    const bc     = pctColor(pct);
    const diffs  = diffCount(r[0]);
    const conteos= conteoCount(r[0]);

    const conteoTip = conteos>0 ? `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 14px 8px;border-bottom:1px solid var(--border)">
        <span style="font-family:var(--mono);font-size:8px;padding:1px 6px;border-radius:3px;background:rgba(74,142,240,.1);color:var(--blue);border:1px solid rgba(74,142,240,.2)">📋 ${conteos} contados</span>
        ${diffs>0?`<span style="font-family:var(--mono);font-size:8px;padding:1px 6px;border-radius:3px;background:rgba(232,64,64,.12);color:var(--red);border:1px solid rgba(232,64,64,.25)">⚠ ${diffs} diffs</span>`:''}
      </div>` : '';

    return `<div class="shelfcard-v2" style="cursor:pointer" onclick="goEstante('${jsAttrSafe(r[0])}')">
      <div class="shelfcard-v2-top">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-family:var(--mono);font-weight:700;font-size:16px;color:var(--text);letter-spacing:.04em">${r[0]}</div>
          <div style="display:flex;align-items:center;gap:6px">
            ${urgBadge(pct)}
            <button class="shelf-qr-btn" title="Ver tarjeta QR de este estante" onclick="event.stopPropagation();openQRShelfModal('${jsAttrSafe(r[0])}')">QR</button>
          </div>
        </div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text3);margin-bottom:10px">ESTANTE</div>
        ${sparkBar(r[2],r[3],r[1])}
      </div>
      <div class="shelfcard-v2-stats">
        <div class="shelfcard-v2-stat">
          <div class="shelfcard-v2-stat-val">${r[1]}</div>
          <div class="shelfcard-v2-stat-lbl">Total</div>
        </div>
        <div class="shelfcard-v2-stat">
          <div class="shelfcard-v2-stat-val" style="color:var(--blue)">${r[2]}</div>
          <div class="shelfcard-v2-stat-lbl">Ocupadas</div>
        </div>
        <div class="shelfcard-v2-stat">
          <div class="shelfcard-v2-stat-val" style="color:${bc}">${r[3]}</div>
          <div class="shelfcard-v2-stat-lbl">Libres</div>
        </div>
        <div class="shelfcard-v2-stat">
          <div class="shelfcard-v2-stat-val" style="color:${bc}">${pct100}%</div>
          <div class="shelfcard-v2-stat-lbl">% Libre</div>
        </div>
      </div>
      ${conteoTip}
      <div class="shelfcard-v2-actions">
        <button class="shelfcard-v2-btn"
          onclick="event.stopPropagation();goEstante('${jsAttrSafe(r[0])}')">
          📍 Ver ubicaciones
        </button>
        <button class="shelfcard-v2-btn primary"
          onclick="event.stopPropagation();irConteoEstante('${jsAttrSafe(r[0])}')">
          📋 Contar
        </button>
      </div>
    </div>`;
  }).join('');
}

function irConteoEstante(name){
  goTab('conteo', document.querySelectorAll('.tab[data-tab="conteo"]')[0]);
  set_CONTEO_ESTANTE( name);
  buildConteoshelfGrid();
  loadConteoEstante();
}

export { estFilterLive, irConteoEstante, renderEstantes };
