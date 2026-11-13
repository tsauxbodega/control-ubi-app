import { cloudSave, ukey } from './cloud-sync.js';
import { ESTANTES, INV } from './state-globals.js';
import { cp, escHtml, jsAttrSafe, setAlert } from './utils.js';
import { limpiarCruceTray, updateCruceTraySlot } from './cruce-conteo.js';
// ═══ js/conteo.js — extraído de index.html (líneas 14340–14840 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== CONTEO =====================
// Storage: one key per estante
let CONTEO_STORE = {};
let CONTEO_CURRENT = [];
let CONTEO_ESTANTE = '';
let CONTEO_MODE = 'estante'; // 'estante' | 'libre' | 'diffs'
let CONTEO_SORT = { col: null, dir: 1 }; // sort state for conteo table
const CONTEO_KEY = 'ctrl_conteo_v2';

// Selección para cruce desde conteo
let CRUCE_CONTEO_A = null; // { idx (en CONTEO_CURRENT o -1 si libre), cod, desc, sistema, conteo, ubi }
let CRUCE_CONTEO_B = null;
let LAST_LABEL_CONTEXT = null; // { mode:'main'|'conteo', a, b, plan, ubiTeoA, ubiTeoB }

function saveConteoStore(){
  try{ localStorage.setItem(ukey(CONTEO_KEY), JSON.stringify(CONTEO_STORE)); }catch(e){}
  cloudSave('conteo', CONTEO_STORE);
}
function loadConteoStoreLocal(){
  try{
    const r = localStorage.getItem(ukey(CONTEO_KEY));
    if(r) CONTEO_STORE = JSON.parse(r);
    else CONTEO_STORE = {};
  }catch(e){ CONTEO_STORE={}; }
}
function loadConteoStore(){ loadConteoStoreLocal(); } // compatibilidad; la carga real por usuario ocurre en hydrateUserCloudData()

// ── Modo tabs ──
function setConteoMode(mode, btn){
  CONTEO_MODE = mode;
  // Support both old .conteo-mode-btn and new .conteo-mode-card
  document.querySelectorAll('.conteo-mode-btn').forEach(b=>b.classList.remove('on'));
  document.querySelectorAll('.conteo-mode-card').forEach(c=>c.classList.remove('on'));
  if(btn) btn.classList.add('on');
  document.getElementById('conteoModeEstante').style.display = mode==='estante'?'':'none';
  document.getElementById('conteoModeLibre').style.display   = mode==='libre'?'':'none';
  document.getElementById('conteoModeDiffs').style.display   = mode==='diffs'?'':'none';
  // Resetear tabla si se cambia de modo
  if(mode==='libre'){
    document.getElementById('conteoLibreQ').value='';
    conteoLibreSearch();
  } else if(mode==='diffs'){
    renderConteoDiffsOnly();
  } else {
    // Restaurar vista del estante activo si existe
    if(CONTEO_ESTANTE && CONTEO_CURRENT.length){
      renderConteo();
      document.getElementById('conteoTableWrap').style.display='';
    }
  }
}

// ── Modal selector de estante (antes era un acordeón siempre visible) ──
function openConteoShelfModal(){
  buildConteoshelfGrid(); // datos frescos cada vez que se abre
  document.getElementById('conteoShelfOverlay').classList.add('on');
}
function closeConteoShelfModal(){
  document.getElementById('conteoShelfOverlay').classList.remove('on');
}
// Resumen compacto que queda siempre visible en la pantalla principal,
// sin necesidad de abrir el modal para saber en qué estante se está.
function updateConteoShelfSummary(){
  const el=document.getElementById('conteoShelfSummaryText');
  if(!el) return;
  if(!CONTEO_ESTANTE){
    el.innerHTML='<span style="color:var(--text3)">Ningún estante seleccionado</span>';
    return;
  }
  const saved=CONTEO_STORE[CONTEO_ESTANTE]||[];
  const total=saved.length;
  const aud=saved.filter(d=>d.auditado).length;
  const diffs=saved.filter(d=>d.conteo!==null && d.conteo!==d.sistema).length;
  const pct=total>0?Math.round(aud/total*100):0;
  el.innerHTML=`<b style="color:var(--amber)">${escHtml(CONTEO_ESTANTE)}</b> · ${aud}/${total} auditadas (${pct}%)`+
    (diffs>0?` · <span style="color:var(--red)">${diffs} con diferencia</span>`:'');
}

// Toggle para la sección "Análisis de cruce"
function toggleCruceMatchCollapse(hdrEl){
  if(!hdrEl) return;
  const body = document.getElementById('cruceMatchBody');
  if(!body) return;
  const collapsed = body.classList.toggle('collapsed');
  hdrEl.classList.toggle('collapsed', collapsed);
  hdrEl.setAttribute('aria-expanded', String(!collapsed));
}

// Navegar con Enter entre inputs de conteo físico
function conteoInputKeydown(e, idx){
  if(e.key !== 'Enter') return;
  e.preventDefault();
  const inputs = Array.from(document.querySelectorAll('#conteoBody .inv-count-input'));
  const next = inputs[idx + 1];
  if(next){ next.focus(); next.select(); }
}

// ── Construcción del mosaico de estantes ──
function buildConteoshelfGrid(){
  const grid = document.getElementById('conteoShelfGrid');
  const meta = document.getElementById('conteoShelfMeta');
  if(!grid) return;

  let estList = [];
  if(ESTANTES.length){
    estList = ESTANTES.slice().sort((a,b)=>a[0].localeCompare(b[0])).map(e=>e[0]);
  } else if(INV.length){
    const prefixes = new Set(
      INV.map(r=>r[3]).filter(u=>u&&u!=='Sin Ubicacion')
        .map(u=>{ const m=u.match(/^([A-Za-z]+\d*)/); return m?m[1]:u.slice(0,2); })
        .filter(Boolean)
    );
    estList = [...prefixes].sort();
  }

  if(!estList.length){
    grid.innerHTML='<div class="csp-empty-hint">Carga un Excel con inventario para ver los estantes disponibles.</div>';
    if(meta) meta.textContent = '0 estantes disponibles';
    return;
  }

  if(meta) meta.textContent = `${estList.length} estante${estList.length!==1?'s':''} disponibles`;

  // Prefijos madre: estos grupos absorben sub-prefijos (PEA,PEB → PE; IRRA,IRRB → IRR; SMN,SMZ → SM)
  const PARENT_GROUPS = ['IRR', 'PE', 'SM'];
  const getGroupKey = est => {
    const m = est.match(/^([A-Za-z]+)/);
    const alpha = m ? m[1] : est[0] || '—';
    for (const pg of PARENT_GROUPS) {
      if (alpha.startsWith(pg)) return pg;
    }
    return alpha;
  };

  const groups = {};
  estList.forEach(est => {
    const g = getGroupKey(est);
    if (!groups[g]) groups[g] = [];
    groups[g].push(est);
  });

  const cardsHtml = Object.keys(groups).sort().map(gKey => {
    const cards = groups[gKey].map(est => {
      const saved     = CONTEO_STORE[est] || [];
      const total     = saved.length;
      const aud       = saved.filter(d => d.auditado).length;
      const diffs     = saved.filter(d => d.conteo !== null && d.conteo !== d.sistema).length;
      const pend      = saved.filter(d => d.conteo === null && !d.auditado).length;
      const pct       = total > 0 ? Math.round((aud / total) * 100) : 0;
      const isDone    = total > 0 && aud === total;
      const isPartial = total > 0 && aud > 0 && aud < total;
      const isSel     = est === CONTEO_ESTANTE;
      const stateClass = isSel ? 'sel' : isDone ? 'state-done' : isPartial ? 'state-partial' : '';
      const barCls    = isDone ? 'done' : isPartial ? 'partial' : '';
      const refCount  = INV.filter(r => r[3] && r[3].toUpperCase().startsWith(est.toUpperCase()) && r[3] !== 'Sin Ubicacion').length;

      // Badge estado
      const badgeHtml = isDone
        ? `<span class="csp-badge done">LISTO</span>`
        : diffs > 0
          ? `<span class="csp-badge diffs">${diffs} DIF</span>`
          : isPartial
            ? `<span class="csp-badge partial">PARCIAL</span>`
            : `<span class="csp-badge pending">PEND</span>`;

      // Colores métricas
      const audColor  = aud > 0   ? 'color:var(--green)' : 'color:var(--text)';
      const diffColor = diffs > 0 ? 'color:var(--red)'   : 'color:var(--text)';
      const pendColor = pend > 0  ? 'color:var(--amber)'  : 'color:var(--text)';

      const title = `Estante ${est} · ${refCount} refs · ${aud} auditadas · ${diffs} con diferencia`;

      return `<div class="csp-card ${stateClass}" onclick="selectConteoEstante('${jsAttrSafe(est)}')" title="${title}" data-est="${est}">
        <div class="csp-indicator"></div>
        <div class="csp-inner">
          <div class="csp-head">
            <div class="csp-name">${est}</div>
            ${badgeHtml}
          </div>
        </div>
        <div class="csp-stats">
          <div class="csp-stat">
            <b>${refCount}</b>
            <span>Refs</span>
          </div>
          <div class="csp-stat">
            <b style="${audColor}">${aud}</b>
            <span>Aud</span>
          </div>
          <div class="csp-stat">
            <b style="${diffs > 0 ? diffColor : pendColor}">${diffs > 0 ? diffs : pend}</b>
            <span>${diffs > 0 ? 'Dif' : 'Pend'}</span>
          </div>
        </div>
        <div class="csp-bar-wrap">
          <div class="csp-bar"><div class="csp-barfill ${barCls}" style="width:${pct}%"></div></div>
          <div class="csp-bar-labels">
            <span class="csp-bar-lbl">${pct}% auditado</span>
            <span class="csp-bar-lbl">${total} ítems</span>
          </div>
        </div>
      </div>`;
    }).join('');

    const groupHdr = Object.keys(groups).length > 1
      ? `<div class="csp-group-lbl">${gKey}</div>`
      : '';
    return `<div class="csp-group">${groupHdr}<div class="csp-row">${cards}</div></div>`;
  }).join('');

  grid.innerHTML = `<div class="csp-grid">${cardsHtml}</div>`;
}

function selectConteoEstante(est){
  CONTEO_ESTANTE = est;
  document.querySelectorAll('.csp-card').forEach(c=>{
    const isSel = c.dataset.est === est;
    c.classList.toggle('sel', isSel);
    // preserve state-done / state-partial, only toggle sel
  });
  // Also auto-load if double-click shortcut: load on single click
  loadConteoEstante();
}

function buildEstanteRows(estante){
  const saved = CONTEO_STORE[estante] || [];
  const rows = INV
    .filter(r=>r[3]&&r[3]!=='Sin Ubicacion'&&r[3].toUpperCase().startsWith(estante.toUpperCase()))
    .sort((a,b)=>a[3].localeCompare(b[3]));
  return rows.map(r=>{
    const prev = saved.find(d=>d.cod===r[0]&&d.ubi===r[3]);
    return { cod:r[0], desc:r[1], ubi:r[3], sistema:r[2],
      conteo:  prev ? prev.conteo  : null,
      auditado: prev ? prev.auditado : false,
      auditTs:  prev ? prev.auditTs  : null };
  });
}

function loadConteoEstante(){
  const estante = CONTEO_ESTANTE;
  if(!estante){
    setAlert('conteoAlert','alw',true,'⚠️ Selecciona un estante en el mosaico primero.');
    return;
  }
  if(!INV.length){ setAlert('conteoAlert','ale',true,'❌ Carga un Excel primero.'); return; }
  setAlert('conteoAlert');
  const rows = buildEstanteRows(estante);
  if(!rows.length){
    setAlert('conteoAlert','alw',true,`⚠️ No hay referencias para el estante "${estante}".`);
    return;
  }
  // Guardar estado anterior
  if(CONTEO_ESTANTE && CONTEO_CURRENT.length){
    CONTEO_STORE[CONTEO_ESTANTE] = CONTEO_CURRENT.map(d=>({...d}));
    saveConteoStore();
  }
  CONTEO_CURRENT = rows;
  CONTEO_STORE[estante] = CONTEO_CURRENT.map(d=>({...d}));
  saveConteoStore();
  renderConteo();
  document.getElementById('conteoTableWrap').style.display='';
  document.getElementById('invSummary').classList.add('on');
  // Cerrar el modal de selección y refrescar el resumen compacto
  closeConteoShelfModal();
  updateConteoShelfSummary();
  buildConteoshelfGrid();
  // Auto-scroll to table
  setTimeout(()=>{ document.getElementById('conteoTableWrap').scrollIntoView({behavior:'smooth',block:'start'}); }, 80);
}

// ── Búsqueda libre ──
function conteoLibreSearch(){
  const q = (document.getElementById('conteoLibreQ')?.value||'').trim().toUpperCase();
  if(!q){ document.getElementById('conteoTableWrap').style.display='none'; return; }
  if(!INV.length){ setAlert('conteoAlert','ale',true,'❌ Carga un Excel primero.'); return; }

  const matches = INV.filter(r=>
    r[0].toUpperCase().includes(q) ||
    (r[1]||'').toUpperCase().includes(q)
  ).slice(0,80);

  if(!matches.length){
    setAlert('conteoAlert','alw',true,'⚠️ Sin resultados.');
    document.getElementById('conteoTableWrap').style.display='none';
    return;
  }
  setAlert('conteoAlert');
  // Construir filas combinando con CONTEO_STORE existente
  const allSaved = Object.values(CONTEO_STORE).flat();
  CONTEO_CURRENT = matches.map(r=>{
    const prev = allSaved.find(d=>d.cod===r[0]&&d.ubi===r[3]);
    return { cod:r[0], desc:r[1], ubi:r[3], sistema:r[2],
      conteo:  prev?prev.conteo:null,
      auditado:prev?prev.auditado:false,
      auditTs: prev?prev.auditTs:null };
  });

  // En libre, no hay un "estante activo" concreto: usamos '_libre_' como key
  CONTEO_ESTANTE = '_libre_';
  renderConteo();
  document.getElementById('conteoTableWrap').style.display='';
  document.getElementById('invSummary').classList.add('on');
  setTimeout(()=>{ document.getElementById('conteoTableWrap').scrollIntoView({behavior:'smooth',block:'start'}); }, 80);
}

// ── Solo diferencias ──
function renderConteoDiffsOnly(){
  const diffs = getConteoDiffs();
  if(!diffs.length){
    setAlert('conteoAlert','alw',true,'⚠️ No hay diferencias registradas todavía. Ingresa conteos en modo Estante o Búsqueda Libre primero.');
    document.getElementById('conteoTableWrap').style.display='none';
    return;
  }
  setAlert('conteoAlert');
  CONTEO_CURRENT = diffs.map(d=>({...d, auditado:false, auditTs:null}));
  CONTEO_ESTANTE = '_diffs_';
  renderConteo();
  document.getElementById('conteoTableWrap').style.display='';
  document.getElementById('invSummary').classList.add('on');
  setTimeout(()=>{ document.getElementById('conteoTableWrap').scrollIntoView({behavior:'smooth',block:'start'}); }, 80);
}

// ── Render tabla ──
function renderConteo(){
  updateConteoSummary();
  const tbody = document.getElementById('conteoBody');
  if(!tbody) return;

  // Etiqueta estante activo
  const wrap = document.getElementById('conteoTableWrap');
  let lbl = wrap.querySelector('.conteo-estante-lbl');
  if(!lbl){ lbl=document.createElement('div'); lbl.className='conteo-estante-lbl'; lbl.style.cssText='font-family:var(--mono);font-size:10px;color:var(--amber);padding:8px 14px;border-bottom:1px solid var(--border);background:var(--bg3);letter-spacing:.1em;'; wrap.insertBefore(lbl, wrap.firstChild); }
  const label = CONTEO_ESTANTE==='_libre_' ? 'BÚSQUEDA LIBRE' : CONTEO_ESTANTE==='_diffs_' ? 'SOLO DIFERENCIAS' : `ESTANTE: ${CONTEO_ESTANTE}`;
  const saved = Object.keys(CONTEO_STORE).filter(k=>k[0]!=='_');
  lbl.textContent = `${label}${saved.length>0?' · '+saved.length+' estante(s) con progreso':'' }`;

  tbody.innerHTML = CONTEO_CURRENT.map((d,i)=>{
    const conteoVal = d.conteo===null ? '' : d.conteo;
    const diff = d.conteo!==null ? d.conteo - d.sistema : null;
    const diffCls = diff===null?'zero':diff>0?'pos':diff<0?'neg':'zero';
    const diffStr = diff===null?'—':diff===0?'0':diff>0?'+'+diff:''+diff;
    const inputCls = diff===null?'':diff>0?'diff-pos':diff<0?'diff-neg':'';

    // Botón selector para cruce
    const isA = CRUCE_CONTEO_A && CRUCE_CONTEO_A.cod===d.cod && CRUCE_CONTEO_A.ubi===d.ubi;
    const isB = CRUCE_CONTEO_B && CRUCE_CONTEO_B.cod===d.cod && CRUCE_CONTEO_B.ubi===d.ubi;
    const selCls = isA?'selA':isB?'selB':'';
    const selLabel = isA?'A':isB?'B':'+';

    return `<tr data-idx="${i}">
      <td><button class="conteo-sel-btn ${selCls}" title="Seleccionar para cruce" onclick="toggleConteoSelCruce(${i})">${selLabel}</button></td>
      <td><span class="inv-audit-dot ${d.auditado?'done':''}" title="${d.auditado?'Auditado · '+d.auditTs:'Click para marcar auditado'}" onclick="toggleAudit(${i})"></span></td>
      <td style="color:var(--text3);font-size:9px">${i+1}</td>
      <td class="tcode" style="cursor:pointer" onclick="openRefDetailFromPrec('${jsAttrSafe(d.cod)}','${jsAttrSafe(d.desc||'')}')">${d.cod}${cp(d.cod)}</td>
      <td class="tdesc">${d.desc||'—'}</td>
      <td style="color:var(--cyan);font-family:var(--mono);font-size:10px">${d.ubi}</td>
      <td class="tnum ${d.sistema>0?'pos':'zero'}">${d.sistema}</td>
      <td><input class="inv-count-input ${inputCls}" type="number" min="0" value="${conteoVal}" placeholder="—"
          oninput="setConteo(${i},this.value)" onkeydown="conteoInputKeydown(event,${i})"></td>
      <td class="inv-diff-cell ${diffCls}">${diffStr}</td>
      <td style="font-family:var(--mono);font-size:9px;color:var(--text3)">${d.auditado?(d.auditTs||'✓'):'—'}</td>
    </tr>`;
  }).join('');
}

function sortConteo(col){
  // Toggle direction if same column, else reset to asc
  if(CONTEO_SORT.col === col){
    CONTEO_SORT.dir *= -1;
  } else {
    CONTEO_SORT.col = col;
    CONTEO_SORT.dir = 1;
  }
  const d = CONTEO_SORT.dir;

  // Update all arrow indicators
  ['cod','desc','ubi','sistema','conteo','diff'].forEach(c=>{
    const el = document.getElementById('csa-'+c);
    if(el) el.textContent = c===col ? (d===1?'▲':'▼') : '';
  });

  // Sort CONTEO_CURRENT in-place (stable on idx fallback)
  CONTEO_CURRENT.sort((a,b)=>{
    let va, vb;
    if(col==='diff'){
      va = a.conteo!==null ? a.conteo - a.sistema : -Infinity;
      vb = b.conteo!==null ? b.conteo - b.sistema : -Infinity;
    } else if(col==='conteo'){
      va = a.conteo!==null ? a.conteo : -Infinity;
      vb = b.conteo!==null ? b.conteo : -Infinity;
    } else if(col==='sistema'){
      va = Number(a.sistema)||0;
      vb = Number(b.sistema)||0;
    } else {
      va = (a[col]||'').toString().toUpperCase();
      vb = (b[col]||'').toString().toUpperCase();
    }
    if(va < vb) return -d;
    if(va > vb) return d;
    return 0;
  });

  renderConteo();
}

function setConteo(idx, val){
  const n = (val===''||val===null) ? null : (parseInt(val)||0);
  CONTEO_CURRENT[idx].conteo = n;

  const row = document.querySelector(`#conteoBody tr[data-idx="${idx}"]`);
  if(row){
    const input    = row.querySelector('.inv-count-input');
    const diffCell = row.querySelector('.inv-diff-cell');
    if(n!==null){
      const diff = n - CONTEO_CURRENT[idx].sistema;
      diffCell.textContent = diff===0?'0':diff>0?'+'+diff:''+diff;
      diffCell.className   = 'inv-diff-cell '+(diff>0?'pos':diff<0?'neg':'zero');
      input.className      = 'inv-count-input '+(diff>0?'diff-pos':diff<0?'diff-neg':'');
    } else {
      diffCell.textContent='—'; diffCell.className='inv-diff-cell zero';
      input.className='inv-count-input';
    }
  }

  // Persistir: en modo libre o diffs, guardar bajo la ubi/estante real del ítem
  if(CONTEO_ESTANTE==='_libre_'||CONTEO_ESTANTE==='_diffs_'){
    const d = CONTEO_CURRENT[idx];
    const est = inferEstante(d.ubi);
    if(!CONTEO_STORE[est]) CONTEO_STORE[est]=[];
    const existing = CONTEO_STORE[est].find(x=>x.cod===d.cod&&x.ubi===d.ubi);
    if(existing){ Object.assign(existing,d); } else { CONTEO_STORE[est].push({...d}); }
  } else {
    CONTEO_STORE[CONTEO_ESTANTE] = CONTEO_CURRENT.map(d=>({...d}));
  }
  saveConteoStore();
  updateConteoSummary();
  // Actualizar nums en cruce tray si esta fila está seleccionada
  if(CRUCE_CONTEO_A&&CRUCE_CONTEO_A.cod===CONTEO_CURRENT[idx].cod) updateCruceTraySlot('A');
  if(CRUCE_CONTEO_B&&CRUCE_CONTEO_B.cod===CONTEO_CURRENT[idx].cod) updateCruceTraySlot('B');
}

function inferEstante(ubi){
  if(!ubi||ubi==='Sin Ubicacion') return '_sin_ubi_';
  const m = ubi.match(/^([A-Za-z]+\d*)/);
  return m?m[1]:ubi.slice(0,2);
}

function toggleAudit(idx){
  const d = CONTEO_CURRENT[idx];
  d.auditado = !d.auditado;
  d.auditTs  = d.auditado ? new Date().toLocaleString('es-CO') : null;
  if(CONTEO_ESTANTE==='_libre_'||CONTEO_ESTANTE==='_diffs_'){
    const est = inferEstante(d.ubi);
    if(!CONTEO_STORE[est]) CONTEO_STORE[est]=[];
    const existing = CONTEO_STORE[est].find(x=>x.cod===d.cod&&x.ubi===d.ubi);
    if(existing){ Object.assign(existing,d); } else { CONTEO_STORE[est].push({...d}); }
  } else {
    CONTEO_STORE[CONTEO_ESTANTE] = CONTEO_CURRENT.map(x=>({...x}));
  }
  saveConteoStore();
  renderConteo();
}

function updateConteoSummary(){
  const tot   = CONTEO_CURRENT.length;
  const aud   = CONTEO_CURRENT.filter(d=>d.auditado).length;
  const diffs = CONTEO_CURRENT.filter(d=>d.conteo!==null&&d.conteo!==d.sistema).length;
  const pend  = CONTEO_CURRENT.filter(d=>d.conteo===null&&!d.auditado).length;
  document.getElementById('cntTot').textContent  = tot;
  document.getElementById('cntAud').textContent  = aud;
  document.getElementById('cntDiff').textContent = diffs;
  document.getElementById('cntPend').textContent = pend;
}

function getConteoDiffs(){
  return Object.values(CONTEO_STORE).flat()
    .filter(d=>d.conteo!==null&&d.conteo!==d.sistema)
    .map(d=>({ cod:d.cod, desc:d.desc, ubi:d.ubi, sistema:d.sistema, conteo:d.conteo, diff:d.conteo-d.sistema }));
}

function resetConteo(){
  const scope = (CONTEO_ESTANTE&&CONTEO_ESTANTE[0]!=='_')
    ? `¿Reiniciar el conteo del estante "${CONTEO_ESTANTE}"? El progreso de otros estantes se conserva.`
    : '¿Reiniciar todo el conteo guardado?';
  if(!confirm(scope)) return;
  if(CONTEO_ESTANTE&&CONTEO_ESTANTE[0]!=='_'){
    delete CONTEO_STORE[CONTEO_ESTANTE];
    CONTEO_CURRENT = [];
  } else {
    CONTEO_STORE = {};
    CONTEO_CURRENT = [];
    CONTEO_ESTANTE = '';
  }
  saveConteoStore();
  document.getElementById('conteoTableWrap').style.display='none';
  document.getElementById('invSummary').classList.remove('on');
  setAlert('conteoAlert');
  limpiarCruceTray();
  buildConteoshelfGrid();
}

export { CONTEO_CURRENT, CONTEO_ESTANTE, CONTEO_KEY, CONTEO_MODE, CONTEO_STORE, CRUCE_CONTEO_A, CRUCE_CONTEO_B, LAST_LABEL_CONTEXT, buildConteoshelfGrid, closeConteoShelfModal, conteoInputKeydown, conteoLibreSearch, getConteoDiffs, loadConteoEstante, loadConteoStoreLocal, openConteoShelfModal, renderConteo, renderConteoDiffsOnly, resetConteo, selectConteoEstante, setConteo, setConteoMode, sortConteo, toggleAudit, toggleCruceMatchCollapse };
export const set_CONTEO_ESTANTE = (v) => (CONTEO_ESTANTE = v);
export const set_CONTEO_STORE = (v) => (CONTEO_STORE = v);
export const set_CRUCE_CONTEO_A = (v) => (CRUCE_CONTEO_A = v);
export const set_CRUCE_CONTEO_B = (v) => (CRUCE_CONTEO_B = v);
export const set_LAST_LABEL_CONTEXT = (v) => (LAST_LABEL_CONTEXT = v);
