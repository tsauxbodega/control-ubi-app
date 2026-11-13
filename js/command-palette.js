import { ESTANTES, INV } from './state-globals.js';
import { getPriceRow } from './file-upload.js';
import { getEffectivePrice } from './precios-divisor.js';
import { goTab } from './ui-header-tabs.js';
import { goBusUbi, goBuscador, goEstante, goPrecio } from './buscador.js';
import { cop, escHtml, fmt, togglePick } from './utils.js';
import { MANT_COMBOS, MANT_EXPANDED, openMantModal } from './mantenimientos.js';
// ═══ js/command-palette.js — extraído de index.html (líneas 18222–18567 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ═══════════════════════════════════════════════════════════════════
// COMMAND PALETTE — Búsqueda global en Control UBI
// ═══════════════════════════════════════════════════════════════════
// Activación: botón FAB (⌘ / abajo-izquierda) · tecla "/" fuera de inputs
//             · Ctrl+K / Cmd+K en cualquier contexto.
// Fuentes simultáneas: INV (inventario) · MANT_COMBOS · ESTANTES.
// Navegación teclado: ↑↓ mueve foco · Enter dispara acción primaria · Esc cierra.
// Cada tipo de resultado tiene acciones inline sin salir del palette.

let CPA_OPEN  = false;
let CPA_FLAT  = [];   // resultados aplanados para navegación por teclado
let CPA_IDX   = -1;   // índice del resultado enfocado (-1 = ninguno)
let CPA_TIMER = null; // debounce

const CPA_LOCAL      = 'ctrl_cpa_recent';
const CPA_MAX_RECENT = 8;

function cpaGetRecent(){
  try{ return JSON.parse(localStorage.getItem(CPA_LOCAL)||'[]'); }
  catch(e){ return []; }
}
function cpaSaveRecent(q){
  if(!q||q.length<2) return;
  let r=cpaGetRecent().filter(x=>x!==q);
  r.unshift(q);
  try{ localStorage.setItem(CPA_LOCAL,JSON.stringify(r.slice(0,CPA_MAX_RECENT))); }catch(e){}
}

// ── Abrir / cerrar ────────────────────────────────────────────────
function openPalette(){
  if(CPA_OPEN) return;
  CPA_OPEN=true; CPA_FLAT=[]; CPA_IDX=-1;
  const ov=document.getElementById('cpaPalette');
  ov.style.display='flex';
  requestAnimationFrame(()=>ov.classList.add('on'));
  const inp=document.getElementById('cpaInput');
  inp.value='';
  setTimeout(()=>inp.focus(),80);
  cpaRenderEmpty();
}
function closePalette(){
  if(!CPA_OPEN) return;
  const ov=document.getElementById('cpaPalette');
  ov.classList.remove('on');
  setTimeout(()=>{ ov.style.display='none'; CPA_OPEN=false; },200);
}
function cpaMaybeClose(e){
  if(e.target===document.getElementById('cpaPalette')) closePalette();
}

// Teclas globales: "/" abre cuando no hay foco en un input; Ctrl+K siempre.
document.addEventListener('keydown', e=>{
  if(!CPA_OPEN){
    const tag=(e.target.tagName||'').toLowerCase();
    const editable=tag==='input'||tag==='textarea'||tag==='select'||e.target.isContentEditable;
    if(e.key==='/'&&!editable&&!e.ctrlKey&&!e.metaKey){ e.preventDefault(); openPalette(); return; }
    if(e.key==='k'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); openPalette(); return; }
  }
});

// ── Navegación por teclado dentro del palette ─────────────────────
function cpaKeyNav(e){
  if(e.key==='Escape'){ closePalette(); return; }
  if(e.key==='ArrowDown'){
    e.preventDefault();
    CPA_IDX=Math.min(CPA_IDX+1,CPA_FLAT.length-1);
    cpaUpdateFocus();
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    CPA_IDX=Math.max(CPA_IDX-1,-1);
    cpaUpdateFocus();
  } else if(e.key==='Enter'){
    e.preventDefault();
    if(CPA_IDX>=0&&CPA_FLAT[CPA_IDX]) CPA_FLAT[CPA_IDX].primary();
  }
}
function cpaUpdateFocus(){
  document.querySelectorAll('.cpa-item').forEach((el,i)=>{
    el.classList.toggle('on',i===CPA_IDX);
    if(i===CPA_IDX) el.scrollIntoView({block:'nearest'});
  });
}

// ── Input con debounce ────────────────────────────────────────────
function cpaOnInput(val){
  clearTimeout(CPA_TIMER);
  CPA_IDX=-1;
  if(!val.trim()){ cpaRenderEmpty(); return; }
  CPA_TIMER=setTimeout(()=>cpaSearch(val),130);
}

// ── Motor de búsqueda ─────────────────────────────────────────────
function cpaSearch(raw){
  const q=raw.trim().toUpperCase();
  if(!q){ cpaRenderEmpty(); return; }
  const invR  = cpaSearchInv(q);
  const mantR = cpaSearchMant(q);
  const estR  = cpaSearchEstantes(q);
  CPA_FLAT=[];
  CPA_IDX=(invR.length||mantR.length||estR.length)?0:-1;
  cpaRender(q,invR,mantR,estR);
}

function cpaSearchInv(q){
  if(!INV.length) return [];
  const exact=[],starts=[],partial=[];
  for(const r of INV){
    const cod=String(r[0]||'').toUpperCase();
    const desc=String(r[1]||'').toUpperCase();
    if(exact.length>=6) break;
    if(cod===q||desc===q)                    exact.push(r);
    else if(cod.startsWith(q))               starts.push(r);
    else if(cod.includes(q)||desc.includes(q)) partial.push(r);
  }
  return [...exact,...starts,...partial].slice(0,6);
}

function cpaSearchMant(q){
  if(!MANT_COMBOS.length) return [];
  const res=[];
  for(const c of MANT_COMBOS){
    const veh=(c.vehiculo||'').toUpperCase();
    const mant=(c.mantenimiento||'').toUpperCase();
    const matchItems=(c.items||[]).filter(it=>
      String(it.cod||'').toUpperCase().includes(q)||
      String(it.tag||'').toUpperCase().includes(q)
    );
    if(veh.includes(q)||mant.includes(q)||matchItems.length){
      res.push({combo:c, hits:matchItems.length?matchItems:(c.items||[]).filter(it=>it.cod).slice(0,3)});
    }
    if(res.length>=4) break;
  }
  return res;
}

function cpaSearchEstantes(q){
  if(!ESTANTES.length) return [];
  return ESTANTES.filter(e=>String(e[0]||'').toUpperCase().includes(q)).slice(0,3);
}

// ── Render ────────────────────────────────────────────────────────
// ── Registro de acciones por índice (evita JSON/comillas en onclick) ──────────
// Cada resultado guardado en CPA_FLAT también tiene entrada en CPA_REG con
// sus acciones y el objeto trayItem ya listo para togglePick.
let CPA_REG = {};

// ── cpaGoTab: navega a una pestaña y cierra el palette ────────────────────────
// Se usa en los botones "Ir a" del estado vacío y también desde resultados.
// Al usar esta función en el onclick evitamos el problema de escapar comillas
// en el CSS selector dentro de un atributo HTML.
function cpaGoTab(id){
  closePalette();
  const tab=document.querySelector('.tab[data-tab="'+id+'"]');
  goTab(id,tab);
}

function cpaRenderEmpty(){
  const el=document.getElementById('cpaResults');
  if(!el) return;
  const recent=cpaGetRecent();
  const hasData=INV.length>0;
  // Recientes: guardamos los textos en un array global temporal para
  // que los botones los referencien por índice sin necesitar comillas escapadas.
  window._cpaRecent=recent;
  el.innerHTML=`<div class="cpa-empty-wrap">
    <div style="margin-bottom:8px">
      ${hasData
        ?`<span class="cpa-chip g">● ${INV.length.toLocaleString('es-CO')} refs · ${MANT_COMBOS.length} combos · ${ESTANTES.length} estantes</span>`
        :`<span class="cpa-chip a">⚠ Excel no cargado — carga el inventario para buscar en él</span>`}
    </div>
    ${recent.length?`
      <div class="cpa-group-hdr" style="padding-left:0;margin-top:10px">Búsquedas recientes</div>
      <div class="cpa-recent-list">
        ${recent.map((r,ri)=>`<button class="cpa-recent-chip" onclick="cpaSearchRecent(${ri})">${escHtml(r)}</button>`).join('')}
        <button class="cpa-recent-chip" style="opacity:.5" onclick="cpaClearRecent()">✕ limpiar</button>
      </div>`:''}
    <div class="cpa-group-hdr" style="padding-left:0;margin-top:14px">Ir a</div>
    <div class="cpa-goto-grid">
      <button class="cpa-goto-btn" onclick="cpaGoTab('bus')"><span>🔍</span> Buscador</button>
      <button class="cpa-goto-btn" onclick="closePalette();openMantModal()"><span>🚗</span> Mantenimientos</button>
      <button class="cpa-goto-btn" onclick="cpaGoTab('ubi')"><span>📍</span> Ubicaciones</button>
      <button class="cpa-goto-btn" onclick="cpaGoTab('estantes')"><span>🏢</span> Estantes</button>
      <button class="cpa-goto-btn" onclick="cpaGoTab('conteo')"><span>📋</span> Conteo</button>
      <button class="cpa-goto-btn" onclick="cpaGoTab('exportar')"><span>📤</span> Exportar</button>
    </div>
  </div>`;
  CPA_FLAT=[];
}
function cpaSearchRecent(ri){
  const q=(window._cpaRecent||[])[ri];
  if(!q) return;
  const inp=document.getElementById('cpaInput');
  if(inp) inp.value=q;
  cpaSearch(q);
}
function cpaClearRecent(){
  try{ localStorage.removeItem(CPA_LOCAL); }catch(e){}
  cpaRenderEmpty();
}

function cpaRender(q,invRes,mantRes,estRes){
  const el=document.getElementById('cpaResults');
  if(!el) return;
  let html='';
  CPA_FLAT=[];
  CPA_REG={};

  // ── INV ──────────────────────────────────────────────────────────
  if(invRes.length){
    html+=`<div class="cpa-group-hdr">📦 Inventario</div>`;
    invRes.forEach((r,i)=>{
      const cod =String(r[0]||'');
      const desc=String(r[1]||'(Sin descripción)');
      const stk =r[2];
      const ubi =String(r[3]||'');
      const pr  =getPriceRow(cod);
      const effP=pr?getEffectivePrice([pr[0],pr[1]],String(r[6]||'')):null;
      const hasUbi=ubi&&ubi!=='Sin Ubicacion';
      const fi=i; // INV siempre arranca en índice 0
      CPA_FLAT.push({primary:()=>{ cpaSaveRecent(cod); closePalette(); goBuscador(cod); }});
      CPA_REG[fi]={
        trayItem:{cod,desc,stock:stk,ubi:hasUbi?ubi:'',price:effP!=null?Math.round(effP*1.19):null},
        hasUbi, ubi, cod
      };
      html+=`<div class="cpa-item${fi===0?' on':''}" data-idx="${fi}"
        onclick="cpaItemClick(${fi})"
        onmouseenter="CPA_IDX=${fi};cpaUpdateFocus()">
        <div class="cpa-item-main">
          <span class="cpa-item-cod">${escHtml(cod)}</span>
          <span class="cpa-item-desc">${escHtml(desc)}</span>
        </div>
        <div class="cpa-item-meta">
          ${stk>0?`<span class="cpa-chip g">Stock ${fmt(stk)}</span>`:`<span class="cpa-chip r">Sin stock</span>`}
          ${hasUbi?`<span class="cpa-chip c">${escHtml(ubi)}</span>`:''}
          ${effP!=null?`<span class="cpa-chip">${cop(Math.round(effP*1.19))}</span>`:''}
        </div>
        <div class="cpa-item-actions">
          <button class="cpa-action" onmousedown="event.preventDefault()" onclick="event.stopPropagation();cpaActBuscar(${fi})">🔍 Buscar</button>
          ${hasUbi?`<button class="cpa-action" onmousedown="event.preventDefault()" onclick="event.stopPropagation();cpaActUbi(${fi})">📍 Ubicación</button>`:''}
          <button class="cpa-action" onmousedown="event.preventDefault()" onclick="event.stopPropagation();cpaActPrecio(${fi})">💰 Precio</button>
          <button class="cpa-action" onmousedown="event.preventDefault()" onclick="event.stopPropagation();cpaAddTray(${fi})">＋ Tray</button>
        </div>
      </div>`;
    });
  }

  // ── MANTENIMIENTOS ────────────────────────────────────────────────
  if(mantRes.length){
    html+=`<div class="cpa-group-hdr">🚗 Mantenimientos</div>`;
    mantRes.forEach(({combo,hits})=>{
      const fi=CPA_FLAT.length;
      CPA_FLAT.push({primary:()=>{ closePalette(); cpaGoMant(combo.id); }});
      CPA_REG[fi]={comboId:combo.id};
      html+=`<div class="cpa-item" data-idx="${fi}"
        onclick="cpaItemClick(${fi})"
        onmouseenter="CPA_IDX=${fi};cpaUpdateFocus()">
        <div class="cpa-item-main">
          <span class="cpa-item-cod">${escHtml(combo.vehiculo)}</span>
          <span class="cpa-item-desc">${escHtml(combo.mantenimiento)}</span>
        </div>
        <div class="cpa-item-meta">
          ${hits.slice(0,4).map(it=>`<span class="cpa-chip" style="font-family:var(--mono)">${it.tag?escHtml(it.tag)+' · ':''}${escHtml(it.cod)}</span>`).join('')}
          ${hits.length>4?`<span class="cpa-chip">+${hits.length-4} más</span>`:''}
        </div>
        <div class="cpa-item-actions">
          <button class="cpa-action" onmousedown="event.preventDefault()" onclick="event.stopPropagation();cpaItemClick(${fi})">🚗 Ver combo</button>
        </div>
      </div>`;
    });
  }

  // ── ESTANTES ──────────────────────────────────────────────────────
  if(estRes.length){
    html+=`<div class="cpa-group-hdr">🏢 Estantes</div>`;
    estRes.forEach((e)=>{
      const fi=CPA_FLAT.length;
      const pct=Math.round((e[4]||0)*100);
      const color=pct>=90?'r':pct>=70?'a':'g';
      CPA_FLAT.push({primary:()=>{ closePalette(); goEstante(e[0]); }});
      CPA_REG[fi]={estante:e[0]};
      html+=`<div class="cpa-item" data-idx="${fi}"
        onclick="cpaItemClick(${fi})"
        onmouseenter="CPA_IDX=${fi};cpaUpdateFocus()">
        <div class="cpa-item-main">
          <span class="cpa-item-cod">${escHtml(e[0])}</span>
          <span class="cpa-item-desc">${e[1]||0} posiciones</span>
        </div>
        <div class="cpa-item-meta">
          <span class="cpa-chip ${color}">${pct}% ocupado</span>
          <span class="cpa-chip">${e[3]||0} libres</span>
        </div>
        <div class="cpa-item-actions">
          <button class="cpa-action" onmousedown="event.preventDefault()" onclick="event.stopPropagation();cpaActEstante(${fi})">🏢 Ver estante</button>
          <button class="cpa-action" onmousedown="event.preventDefault()" onclick="event.stopPropagation();cpaActEstanteUbi(${fi})">📍 Ubicaciones</button>
        </div>
      </div>`;
    });
  }

  if(!html){
    html=`<div class="cpa-empty-wrap" style="text-align:center;padding:24px 16px;color:var(--text3);font-size:12px">
      Sin resultados para "<b style="color:var(--text)">${escHtml(q)}</b>"
      ${!INV.length?'<br><span style="color:var(--amber);font-size:10px;display:block;margin-top:8px">⚠ Carga el Excel para buscar en el inventario</span>':''}
    </div>`;
  }

  el.innerHTML=html;
  cpaUpdateFocus();
}

// ── Acciones tipadas (sin JSON en onclick) ────────────────────────
function cpaItemClick(idx){
  CPA_IDX=idx;
  if(CPA_FLAT[idx]) CPA_FLAT[idx].primary();
}
function cpaActBuscar(fi){ const r=CPA_REG[fi]; if(!r) return; cpaSaveRecent(r.cod); closePalette(); goBuscador(r.cod); }
function cpaActUbi(fi)   { const r=CPA_REG[fi]; if(!r||!r.hasUbi) return; closePalette(); goBusUbi(r.ubi); }
function cpaActPrecio(fi){ const r=CPA_REG[fi]; if(!r) return; closePalette(); goPrecio(r.cod); }
function cpaActEstante(fi){ const r=CPA_REG[fi]; if(!r) return; closePalette(); goEstante(r.estante); }
function cpaActEstanteUbi(fi){ const r=CPA_REG[fi]; if(!r) return; closePalette(); goBusUbi(r.estante); }
function cpaAddTray(fi){
  const r=CPA_REG[fi];
  if(!r||!r.trayItem) return;
  togglePick(r.trayItem, null);
  const fab=document.getElementById('pickFab');
  if(fab){ fab.classList.remove('bump'); void fab.offsetWidth; fab.classList.add('bump'); setTimeout(()=>fab.classList.remove('bump'),300); }
}
function cpaGoMant(id){
  MANT_EXPANDED.add(id);
  closePalette();
  openMantModal();
  setTimeout(()=>{
    const cards=document.querySelectorAll('#mantOverlay .mant-card');
    for(const card of cards){
      const btn=card.querySelector('[data-id]');
      if(btn&&btn.dataset.id===id){
        card.scrollIntoView({behavior:'smooth',block:'center'});
        card.style.transition='box-shadow .3s';
        card.style.boxShadow='0 0 0 2px var(--gold)';
        setTimeout(()=>card.style.boxShadow='',1200);
        break;
      }
    }
  },350);
}

export { CPA_IDX, closePalette, cpaActBuscar, cpaActEstante, cpaActEstanteUbi, cpaActPrecio, cpaActUbi, cpaAddTray, cpaClearRecent, cpaGoTab, cpaItemClick, cpaKeyNav, cpaMaybeClose, cpaOnInput, cpaSearchRecent, cpaUpdateFocus, openPalette };
