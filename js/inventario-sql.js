import { ACTIVE_BODEGA, API_URL, BODEGAS, BODEGA_DEFAULT, BODEGA_KEY, CROSS_IDX, INV_RAW_BY_BODEGA, activeHasLayout, bodegaName, otherBodega, set_ACTIVE_BODEGA, set_CROSS_IDX, set_INV_RAW_BY_BODEGA } from './config.js';
import { CURRENT_USER } from './auth.js';
import { apiFetch } from './api.js';
import { ESTANTES, INV, INV_IDX, KAIZEN_EXT, NOSTOCK_UBI, PRICES, SM_MAP, UBI2_MAP, UBI_TEO, _dupUbisCache, cleanNumber, saveToStorage, set_INV, set_INV_IDX, set_KAIZEN_EXT, set_NOSTOCK_UBI, set_UBI2_MAP, set__dupUbisCache } from './state-globals.js';
import { addInvRow, getPriceRow, normCode, stripDash } from './file-upload.js';
import { getEffectivePrice } from './precios-divisor.js';
import { FALLBACK_CACHE_MAX_H, INV_SOURCE, MANUAL_EXCEL_MODE, SQL_FETCH_TIMEOUT_MS, _skipRadarOnce, _wantExcelInv, hideFallbackBanner, set_INV_SOURCE, set__skipRadarOnce, set__wantExcelInv, showFallbackBanner } from './excel-respaldo.js';
import { goTab, updateHeaderStats } from './ui-header-tabs.js';
import { doSearch, goBusUbi } from './buscador.js';
import { doPrec } from './precios.js';
import { renderEstantes } from './estantes.js';
import { _dupCodsCache, cop, escHtml, fmt, setAlert, set__dupCodsCache } from './utils.js';
import { autoLoadExcel, autobar, scheduleReload, updateFreshBadge } from './autoload-excel.js';
import { buildSnapshot, detectChanges, handleQRParam, saveChanges } from './radar-cambios.js';
// ═══ js/inventario-sql.js — extraído de index.html (líneas 7462–8327 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ═══════════════════════════════════════════════════════════════════════
// MIGRACIÓN A SQL: inventario + KAIZEN vía vista plana (t_kaizen o como la
// llame IT). Reemplaza las 3 hojas Excel STOCK_UBI/STOCK_NOUBI/NOSTOCK_UBI
// + KAIZEN por una sola fuente plana, decidiendo la categoría de cada fila
// por sus propios valores de stock/ubicación en vez de por la hoja de
// origen — la misma regla que ya usaba cada hoja por separado:
//   stock>0 y ubicación   → inventario normal
//   stock>0 sin ubicación → inventario normal, ubi='Sin Ubicacion'
//   stock=0 y ubicación   → además se registra en NOSTOCK_UBI (estante
//                           ocupado sin producto — reporte "Ocupado sin
//                           stock" y KPI de Panorama)
//
// Precios (mensual), estantes y ubicaciones teóricas SIGUEN por Excel —
// esto solo cubre inventario + KAIZEN.
//
// Formato esperado por fila (mismos nombres pedidos a IT):
//   { cod, desc, stock, ubicacion, abc, grupo, m1..m6, oo, bo, costo, score, fecha }
// Recalcula el cruce de cada ubicación teórica contra el inventario VIVO
// (venga de Excel o de SQL) — reemplaza la fórmula de Excel que hacía este
// mismo cruce contra STOCK_UBI/OCUPADO para decidir código/descripción/
// stock/estado de cada ubicación. Se llama automáticamente cada vez que
// INV se reconstruye (desde processExcel o desde processFlatInvRows), así
// el resultado queda siempre al día sin depender de que Excel recalcule.
function recomputeUbiTeoOcupacion(){
  if(!UBI_TEO.length) return;
  const porUbi = new Map(); // ubicación -> [filas de INV con esa ubicación]
  for(const r of INV){
    if(r[3] && r[3]!=='Sin Ubicacion'){
      if(!porUbi.has(r[3])) porUbi.set(r[3], []);
      porUbi.get(r[3]).push(r);
    }
  }
  for(const u of UBI_TEO){
    const refs = porUbi.get(u[0]) || [];
    if(refs.length){
      // Si hay más de una referencia en la misma ubicación (duplicado), se
      // muestra la primera — el badge "DUP" del buscador ya avisa del caso.
      u[1] = refs[0][0];                                          // código
      u[2] = refs[0][1];                                          // descripción
      u[3] = refs.reduce((s,r)=>s+(cleanNumber(r[2])||0),0);      // stock total ahí
      u[4] = 'OCUPADA';
    } else {
      u[1] = ''; u[2] = ''; u[3] = 0; u[4] = 'LIBRE';
    }
  }
  set__dupUbisCache( null); set__dupCodsCache( null);
}

// Recalcula Total/Ocupadas/Libres/% Libre de cada estante contando las
// ubicaciones teóricas (ya con su estado recién recalculado por
// recomputeUbiTeoOcupacion) que empiezan con el nombre del estante — la
// MISMA regla de prefijo que ya usa el resto de la app en varios lugares
// (ubicación.startsWith(estante)). Reemplaza la fórmula de Excel que hacía
// este mismo conteo contra UBITEORICAS. Las notas (e[5]) se dejan tal cual
// vienen del Excel — eso sí es texto manual, no un cálculo.
function recomputeEstantesLibres(){
  if(!ESTANTES.length || !UBI_TEO.length) return;
  for(const e of ESTANTES){
    const prefix = String(e[0]||'').toUpperCase();
    const propias = UBI_TEO.filter(u=>String(u[0]||'').toUpperCase().startsWith(prefix));
    const total = propias.length;
    const ocupadas = propias.filter(u=>u[4]==='OCUPADA').length;
    const pct = total ? (total - ocupadas) / total : 0;
    e[1] = total;
    e[2] = ocupadas;
    e[3] = total - ocupadas;
    e[4] = pct;
    e[5] = pct >= 0.2 ? 'OK' : '<20%'; // mismo umbral que ya usa okEst/warnEst en computePanoramaKPIs
  }
}

function processFlatInvRows(rows, isSilent){
  try{
    const invMap = new Map();
    set_NOSTOCK_UBI( []);
    set_KAIZEN_EXT( {});
    set_UBI2_MAP( {});

    for(const row of (rows||[])){
      const cod = String(row.cod ?? '').trim();
      if(!cod) continue;
      const stock = cleanNumber(row.stock ?? 0);

      // Ubicación vacía → 'Sin Ubicacion'; puede traer 2 separadas por
      // espacio, igual que hoy en la hoja KAIZEN ("A12 B03").
      let ubiRaw = String(row.ubicacion ?? '').trim();
      if(!ubiRaw || ubiRaw.toLowerCase()==='nan' || ubiRaw==='0') ubiRaw = 'Sin Ubicacion';
      let ubi = ubiRaw, ubi2 = null;
      if(ubiRaw !== 'Sin Ubicacion'){
        const parts = ubiRaw.split(/\s+/).filter(Boolean);
        if(parts.length >= 2){ ubi = parts[0]; ubi2 = parts[1].toUpperCase(); }
      }

      addInvRow(invMap, cod, row.desc, stock, ubi, row.abc, 0, row.grupo, row.costo, row.score, row.fecha, row.ultima_compra);
      if(ubi2) UBI2_MAP[normCode(cod)] = ubi2;

      if(stock === 0 && ubi !== 'Sin Ubicacion'){
        NOSTOCK_UBI.push([cod, row.desc||'', ubi, stock]);
      }

      const meses = [row.m1,row.m2,row.m3,row.m4,row.m5,row.m6].map(v=>cleanNumber(v||0));
      const mad   = meses.reduce((a,b)=>a+b,0)/6;
      const fr    = meses.filter(m=>m>0).length; // FR Toyota DPOK: meses con ventas > 0
      // Clasificación DPOK (SOP Guía de Abastecimiento) según SubGrupo3 del ERP.
      const subgrupo3 = String(row.subgrupo3 || '').trim().toUpperCase();
      let clasifDPOK = 'OTRO';
      if(/mantenimiento|^mp$/.test(subgrupo3)) clasifDPOK = 'MP';
      else if(/colision/.test(subgrupo3)) clasifDPOK = 'COLISION';
      else if(/accesorio/.test(subgrupo3)) clasifDPOK = 'ACCESORIOS';
      else if(/insumo/.test(subgrupo3)) clasifDPOK = 'INSUMOS';
      else if(/^rg$|repuesto general|campañ/.test(subgrupo3)) clasifDPOK = 'RG';

      KAIZEN_EXT[cod] = {
        meses,
        oo:  cleanNumber(row.oo  || 0),
        bo:  cleanNumber(row.bo  || 0),
        mad, fr,
        // ── Campos DPOK Guía de Abastecimiento ──────────────────────
        dad:       cleanNumber(row.dad       || 0),
        mip_sql:   cleanNumber(row.mip_sql   || 0),
        dias_inv:  cleanNumber(row.dias_inv  || 0),  // Cobertura actual en días (según DAD)
        fase_in:   cleanNumber(row.fase_in   || 0),
        fase_out:  cleanNumber(row.fase_out  || 0),
        // "Dias" del SQL = antigüedad de la última compra, NO Lead Time
        // (no confundir — el LT real no tiene fuente en SQL, es manual).
        dias_ult_compra: cleanNumber(row.dias_ult_compra || 0),
        categoria: String(row.categoria || '').trim(),
        stock_min: cleanNumber(row.stock_min || 0),
        stock_max: cleanNumber(row.stock_max || 0),
        stock_seg: cleanNumber(row.stock_seg || 0),
        costo_prom:cleanNumber(row.costo_prom|| 0),
        subgrupo3, clasifDPOK,
      };
    }

    set_INV( [...invMap.values()]);
    set__dupUbisCache( null); set__dupCodsCache( null);
    set_INV_IDX( new Map());
    for(const r of INV){ const k=normCode(r[0]); if(!INV_IDX.has(k)) INV_IDX.set(k, r); }
    recomputeUbiTeoOcupacion();
    recomputeEstantesLibres();

    saveToStorage(INV, PRICES, UBI_TEO, ESTANTES, NOSTOCK_UBI);
    // Siempre — incluso en refrescos silenciosos: es la parte que le
    // faltaba a este flujo (ver comentario en updateHeaderStats). No
    // toca ninguna tabla ni interrumpe al usuario, así que es seguro
    // llamarla en cada ciclo de scheduleReload().
    if(typeof updateHeaderStats==='function') updateHeaderStats();
    if(!isSilent) alert('✅ Inventario actualizado desde SQL\n\n• Referencias: '+INV.length+'\n• Stock=0 con ubicación: '+NOSTOCK_UBI.length);
  }catch(e){
    console.error('[SQL inventario] Error procesando filas:', e);
    if(!isSilent) alert('❌ No se pudo procesar la respuesta del servidor: '+(e.message||e));
  }
}

// ══════════════════════════════════════════════════════════════════
// Cambia la bodega activa: reconstruye INV/INV_IDX/etc desde las filas
// de esa sede y arma el índice de la OTRA para el aviso cruzado.
// Todas las vistas siguen leyendo los mismos globales — no se tocan.
// ══════════════════════════════════════════════════════════════════
function setActiveBodega(bodega, opts = {}){
  const b = BODEGAS[Number(bodega)] ? Number(bodega) : BODEGA_DEFAULT;
  set_ACTIVE_BODEGA( b);
  try{ localStorage.setItem(BODEGA_KEY, String(b)); }catch(e){}

  const filas = INV_RAW_BY_BODEGA[b] || [];
  processFlatInvRows(filas, true);   // silencioso: el aviso lo damos abajo

  // Índice de la otra sede — solo código → fila, para consulta puntual.
  set_CROSS_IDX( new Map());
  const otras = INV_RAW_BY_BODEGA[otherBodega(b)] || [];
  for(const r of otras){
    const k = normCode(r.cod);
    if(k && !CROSS_IDX.has(k)) CROSS_IDX.set(k, r);
  }

  renderBodegaSwitch();
  applyLayoutAvailability();

  if(!opts.skipReload){
    // Re-renderizar la vista visible con los datos de la nueva sede.
    if(typeof doSearch === 'function' && document.getElementById('panel-bus')?.classList.contains('active')) doSearch();
    if(typeof renderUbiTable === 'function') try{ renderUbiTable(); }catch(e){}
    if(typeof renderEstantes === 'function') try{ renderEstantes(); }catch(e){}
    if(typeof renderNoStock === 'function') try{ renderNoStock(); }catch(e){}
  }
  if(!opts.silent){
    setAlert('bAlert','ok',true,`🏢 Sede activa: <b>${BODEGAS[b].sede}</b> · ${filas.length} referencias`);
  }
}

// Busca un código en la OTRA bodega. Devuelve null si no está.
function lookupCrossBodega(cod){
  if(!cod) return null;
  const row = CROSS_IDX.get(normCode(cod)) || CROSS_IDX.get(normCode(stripDash(cod)));
  if(!row) return null;
  const meses = [row.m1,row.m2,row.m3,row.m4,row.m5,row.m6].map(v=>cleanNumber(v||0));
  return {
    bodega: otherBodega(ACTIVE_BODEGA),
    nombre: bodegaName(otherBodega(ACTIVE_BODEGA)),
    cod: row.cod,
    desc: row.desc || '',
    stock: cleanNumber(row.stock||0),
    ubicacion: String(row.ubicacion||'').trim() || 'Sin Ubicación',
    abc: row.abc || '—',
    grupo: row.grupo || '—',
    costo: cleanNumber(row.costo||0),
    fecha: row.fecha || '',
    ultima_compra: row.ultima_compra || '',
    meses,
    mad: meses.reduce((a,b)=>a+b,0)/6
  };
}

// Caché de INV_RAW_BY_BODEGA: solo guarda la sede activa para no
// duplicar el storage en móvil. La sede cruzada se reconstruye desde
// SQL en el siguiente arranque; el aviso cruzado funciona mientras
// la sesión está abierta y ambas sedes ya cargaron desde la red.
const BODEGA_CACHE_KEY = 'ctrl_inv_bodegas';
function saveBodegaCache(porBodega){
  try{
    // Solo la sede activa: PRICES + UBI_TEO ya ocupan mucho espacio.
    // Guardar las dos duplicaría INV y provocaría que en móvil se
    // agote la cuota y se pierdan los precios.
    const soloActiva = {};
    soloActiva[ACTIVE_BODEGA] = porBodega[ACTIVE_BODEGA] || [];
    localStorage.setItem(BODEGA_CACHE_KEY, JSON.stringify({ts:Date.now(), data:soloActiva}));
  }catch(e){
    // Cuota: sacrificar el caché de bodega antes que los precios.
    // No es crítico: SQL lo recarga en el siguiente arranque.
    try{ localStorage.removeItem(BODEGA_CACHE_KEY); }catch(e2){}
  }
}
function loadBodegaCache(){
  try{
    const raw = localStorage.getItem(BODEGA_CACHE_KEY);
    return raw ? (JSON.parse(raw).data || null) : null;
  }catch(e){ return null; }
}

// Deshabilita visualmente las pestañas que dependen del layout físico
// cuando la sede activa no lo tiene cargado. Nunca se muestran los
// estantes de Sur junto al stock de Norte.
const LAYOUT_TABS = ['ubi','estantes','sugerir','conteo'];
function applyLayoutAvailability(){
  const ok = activeHasLayout();
  LAYOUT_TABS.forEach(t=>{
    const btn = document.querySelector(`[data-tab="${t}"]`);
    if(!btn) return;
    btn.classList.toggle('tab-nolayout', !ok);
    btn.title = ok ? '' : `No disponible: la bodega ${bodegaName(ACTIVE_BODEGA)} aún no tiene ubicaciones teóricas cargadas`;
  });
  const w = document.getElementById('layoutWarn');
  if(w){
    w.style.display = ok ? 'none' : 'block';
    w.innerHTML = ok ? '' :
      `⚠️ La sede <b>${BODEGAS[ACTIVE_BODEGA].sede}</b> todavía no tiene cargado su mapa de ubicaciones y estantes.
       Stock, precios y consulta funcionan normal; las vistas de ubicación quedan deshabilitadas para no mezclar
       los estantes de la otra sede con este inventario.`;
  }
}

function renderBodegaSwitch(){
  const el = document.getElementById('bodegaSwitch');
  if(!el) return;
  el.innerHTML = Object.values(BODEGAS).map(b=>`
    <button class="bodega-opt ${b.id===ACTIVE_BODEGA?'on':''}"
            onclick="onBodegaSwitch(${b.id})"
            title="Ver el inventario de ${b.sede}">
      ${b.nombre.toUpperCase()}<span class="bo-sub">${b.id}</span>
    </button>`).join('');
}

function onBodegaSwitch(b){
  if(Number(b)===ACTIVE_BODEGA) return;
  if(!INV_RAW_BY_BODEGA[b] || !INV_RAW_BY_BODEGA[b].length){
    alert(`Todavía no hay datos cargados de ${BODEGAS[b].sede}.\n\nActualiza el inventario para traer las dos sedes.`);
    return;
  }
  setActiveBodega(b);   // el cambio es solo de sesión: no toca el perfil
}

// ── Modal de detalle cruzado (P6) ──────────────────────────────────
let _xbCurrent = null;

function openCrossBodegaModal(cod){
  const x = lookupCrossBodega(cod);
  if(!x){ alert('Esa referencia no está en la otra sede.'); return; }
  _xbCurrent = x;

  document.getElementById('xbTitle').innerHTML =
    `<span style="font-family:var(--mono)">${escHtml(x.cod)}</span> — ${escHtml(x.desc||'sin descripción')}`;

  const mesesHtml = x.meses.map((v,i)=>`<span style="font-family:var(--mono);font-size:10px;color:var(--text2)">M${i+1}: <b>${fmt(v)}</b></span>`).join(' · ');

  document.getElementById('xbContent').innerHTML = `
    <div class="xb-grid">
      <div class="xb-cell"><div class="xb-lbl">Sede</div><div class="xb-val">${escHtml(x.nombre)} · ${x.bodega}</div></div>
      <div class="xb-cell"><div class="xb-lbl">Stock disponible</div>
           <div class="xb-val big" style="color:${x.stock>0?'var(--green)':'var(--red)'}">${fmt(x.stock)}</div></div>
      <div class="xb-cell"><div class="xb-lbl">Ubicación</div><div class="xb-val">${escHtml(x.ubicacion)}</div></div>
      <div class="xb-cell"><div class="xb-lbl">Clase ABC</div><div class="xb-val">${escHtml(x.abc)}</div></div>
      <div class="xb-cell"><div class="xb-lbl">Costo inventario</div><div class="xb-val">${cop(x.costo)}</div></div>
      <div class="xb-cell"><div class="xb-lbl">Consumo prom. (MAD)</div><div class="xb-val">${x.mad.toFixed(1)}</div></div>
    </div>
    <div class="xb-cell" style="margin-top:10px">
      <div class="xb-lbl">Consumo últimos 6 meses</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">${mesesHtml}</div>
    </div>
    ${x.fecha ? `<div style="font-size:10px;color:var(--text3);margin-top:8px">Última entrada registrada: ${escHtml(String(x.fecha).slice(0,10))}</div>` : ''}
    ${x.ultima_compra ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">Última compra registrada: ${escHtml(String(x.ultima_compra).slice(0,10))}</div>` : ''}
  `;
  document.getElementById('xbGoBtn').textContent = `🔄 Cambiar a ${x.nombre}`;
  document.getElementById('bodegaCrossOverlay').classList.add('on');
}

function closeCrossBodegaModal(){
  document.getElementById('bodegaCrossOverlay').classList.remove('on');
  _xbCurrent = null;
}

function xbSwitchToThere(){
  if(!_xbCurrent) return;
  const cod = _xbCurrent.cod, destino = _xbCurrent.bodega;
  closeCrossBodegaModal();
  setActiveBodega(destino);
  // Buscar el código ya en la sede nueva.
  const inp = document.getElementById('busQ');
  if(inp){ inp.value = cod; if(typeof showTab==='function') showTab('bus'); doSearch(); }
}

function xbCopyCode(){
  if(!_xbCurrent) return;
  navigator.clipboard?.writeText(_xbCurrent.cod);
  const b = document.getElementById('xbCopyBtn');
  const o = b.textContent; b.textContent = '✓ Copiado';
  setTimeout(()=>b.textContent=o, 1200);
}

// ── Modal de detalle de referencia LOCAL (buscador) ─────────────────
// Muestra stock, ubicación, precio, costo inventario, última entrada,
// última compra y consumo de la sede ACTIVA. El mismo diseño que el
// modal de la otra sede, pero de aquí.
let _rdCurrent = null;

function openRefDetailModal(cod){
  const invRow = INV_IDX.get(normCode(cod));
  if(!invRow){ alert('No se encontró la referencia en el inventario.'); return; }

  const pr  = getPriceRow(cod);
  const grp = invRow[6]||'';
  const smD = SM_MAP[normCode(cod)];

  // Consumo 6 meses desde KAIZEN_EXT
  const kx  = KAIZEN_EXT[normCode(cod)];
  const meses = kx ? kx.meses : [0,0,0,0,0,0];
  const mad   = meses.reduce((a,b)=>a+b,0)/6;

  // Precios
  const pMost = pr ? pr[0] : null;
  const pAcc  = pr ? pr[1] : null;
  const pEff  = pr ? getEffectivePrice(pr, grp) : null;
  const pCos  = pr && pr[3]>0 ? pr[3] : null;  // costo unitario del Excel

  // Costo inventario real (SQL)
  const costoInv = invRow[7] && Number(invRow[7])>0 ? Number(invRow[7]) : null;

  // Fechas
  const fechaEntrada = invRow[9] ? String(invRow[9]).slice(0,10) : '';
  const fechaCompra  = invRow[10] ? String(invRow[10]).slice(0,10)
                     : smD?.ult_compra || '';

  _rdCurrent = { cod:invRow[0], ubi:invRow[3] };

  document.getElementById('rdTag').textContent =
    `📦 ${BODEGAS[ACTIVE_BODEGA]?.sede||'Sede activa'} · ${bodegaName(ACTIVE_BODEGA)}`;
  document.getElementById('rdTitle').innerHTML =
    `<span style="font-family:var(--mono)">${escHtml(invRow[0])}</span> — ${escHtml(invRow[1]||'sin descripción')}`;

  const mesesHtml = meses.map((v,i)=>`<span style="font-family:var(--mono);font-size:10px;color:var(--text2)">M${i+1}: <b>${fmt(v)}</b></span>`).join(' · ');

  document.getElementById('rdContent').innerHTML = `
    <div class="xb-grid">
      <div class="xb-cell"><div class="xb-lbl">Stock disponible</div>
        <div class="xb-val big" style="color:${Number(invRow[2])>0?'var(--green)':'var(--red)'}">${fmt(invRow[2])}</div></div>
      <div class="xb-cell"><div class="xb-lbl">Ubicación</div>
        <div class="xb-val">${escHtml(invRow[3])}</div></div>
      <div class="xb-cell"><div class="xb-lbl">Clase ABC</div>
        <div class="xb-val">${escHtml(invRow[4]||'—')}</div></div>
      <div class="xb-cell"><div class="xb-lbl">Grupo</div>
        <div class="xb-val" style="font-size:12px">${escHtml(grp||'—')}</div></div>
      ${pMost!=null?`<div class="xb-cell"><div class="xb-lbl">Mostrador (sin IVA)</div><div class="xb-val">${cop(pMost)}</div></div>`:''}
      ${pAcc!=null?`<div class="xb-cell"><div class="xb-lbl">Accesorios (sin IVA)</div><div class="xb-val">${cop(pAcc)}</div></div>`:''}
      ${pCos!=null?`<div class="xb-cell"><div class="xb-lbl">Costo unitario (lista)${pr&&pr._div?` · ÷${pr._div}`:''}</div><div class="xb-val">${cop(pCos)}</div></div>`:''}
      ${costoInv!=null?`<div class="xb-cell"><div class="xb-lbl">Costo inventario (SQL)</div><div class="xb-val">${cop(costoInv)}</div></div>`:''}
      <div class="xb-cell"><div class="xb-lbl">Consumo prom. (MAD)</div><div class="xb-val">${mad.toFixed(1)}</div></div>
    </div>
    <div class="xb-cell" style="margin-top:10px">
      <div class="xb-lbl">Consumo últimos 6 meses</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">${mesesHtml}</div>
    </div>
    ${smD?`<div class="xb-cell" style="margin-top:10px;border-color:var(--red)">
      <div class="xb-lbl" style="color:var(--red)">⚠ STOCK MUERTO</div>
      <div style="font-size:10px;color:var(--text2);margin-top:4px">Últ. venta: <b>${smD.ult_vt||'—'}</b></div>
    </div>`:''}
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:10px;color:var(--text3)">
      ${fechaEntrada?`<span>📅 Última entrada: <b>${escHtml(fechaEntrada)}</b></span>`:''}
      ${fechaCompra ?`<span>🛒 Última compra: <b>${escHtml(fechaCompra)}</b></span>`:''}
    </div>
  `;

  const goBtnUbi = document.getElementById('rdGoUbi');
  if(goBtnUbi) goBtnUbi.style.display = invRow[3]&&invRow[3]!=='Sin Ubicacion' ? '' : 'none';

  // Limpiar imágenes de la referencia anterior antes de mostrar la nueva.
  const imgBox = document.getElementById('rdImgResult');
  if(imgBox){ imgBox.style.display='none'; imgBox.innerHTML=''; }
  const imgBtn = document.getElementById('rdImgBtn');
  if(imgBtn) imgBtn.disabled = false;
  _rdImgItems = [];

  document.getElementById('refDetailOverlay').classList.add('on');
}

// Abre el modal de detalle (el mismo de Buscador/Diagnóstico) para una
// referencia que viene de Lista de Precios. Esa pestaña cubre TODO el
// catálogo oficial Toyota, no solo lo que hay físicamente en esta sede,
// así que openRefDetailModal(cod) por sí sola no sirve: esa función exige
// encontrar la referencia en el inventario activo y si no la encuentra
// solo muestra una alerta (nunca abre el modal ni el botón de imágenes).
//
// Aquí, si la referencia SÍ está en inventario se delega directo a
// openRefDetailModal(cod) (mismo detalle completo de siempre). Si NO está
// (el caso típico en Precios), se arma una versión reducida con lo único
// que sí hay ahí: precio y descripción, dejando claro que no hay stock en
// esta sede. En ambos casos _rdCurrent queda igual de listo, así que
// rdShowImages() — que solo necesita el código — funciona sin cambios.
function openRefDetailFromPrec(cod, desc){
  const invRow = INV_IDX.get(normCode(cod));
  if(invRow){ openRefDetailModal(cod); return; }

  const pr    = getPriceRow(cod);
  const pMost = pr ? pr[0] : null;
  const pAcc  = pr ? pr[1] : null;
  const pCos  = pr && pr[3]>0 ? pr[3] : null;

  _rdCurrent = { cod, ubi:null };

  document.getElementById('rdTag').textContent = '💰 LISTA DE PRECIOS · Sin stock en ' + bodegaName(ACTIVE_BODEGA);
  document.getElementById('rdTitle').innerHTML =
    `<span style="font-family:var(--mono)">${escHtml(cod)}</span> — ${escHtml(desc||'sin descripción')}`;

  document.getElementById('rdContent').innerHTML = `
    <div class="xb-grid">
      ${pMost!=null?`<div class="xb-cell"><div class="xb-lbl">Mostrador (sin IVA)</div><div class="xb-val">${cop(pMost)}</div></div>`:''}
      ${pAcc!=null?`<div class="xb-cell"><div class="xb-lbl">Accesorios (sin IVA)</div><div class="xb-val">${cop(pAcc)}</div></div>`:''}
      ${pCos!=null?`<div class="xb-cell"><div class="xb-lbl">Costo unitario (lista)${pr&&pr._div?` · ÷${pr._div}`:''}</div><div class="xb-val">${cop(pCos)}</div></div>`:''}
    </div>
    <div class="rd-img-warn" style="margin-top:10px">⚠️ No aparece en el inventario activo de ${escHtml(bodegaName(ACTIVE_BODEGA))} — datos tomados de la lista de precios.</div>
  `;

  // Sin ubicación (no está en inventario): ocultar ese botón.
  const goBtnUbi = document.getElementById('rdGoUbi');
  if(goBtnUbi) goBtnUbi.style.display = 'none';

  const imgBox = document.getElementById('rdImgResult');
  if(imgBox){ imgBox.style.display='none'; imgBox.innerHTML=''; }
  const imgBtnEl = document.getElementById('rdImgBtn');
  if(imgBtnEl) imgBtnEl.disabled = false;
  _rdImgItems = [];

  document.getElementById('refDetailOverlay').classList.add('on');
}

function closeRefDetailModal(){
  if(typeof rdCloseLightbox==='function') rdCloseLightbox();
  document.getElementById('refDetailOverlay').classList.remove('on');
  _rdCurrent = null;
}

function rdCopyCode(){
  if(!_rdCurrent) return;
  const cod = _rdCurrent.cod;
  navigator.clipboard?.writeText(cod);
  const b = document.querySelector('#refDetailOverlay .upbtn');
  const o = b.textContent; b.textContent='✓ Copiado';
  setTimeout(()=>b.textContent=o, 1200);
}
function rdGoPrice(){
  if(!_rdCurrent) return;
  // Guardar ANTES de cerrar: closeRefDetailModal() pone _rdCurrent = null
  const cod = _rdCurrent.cod;
  closeRefDetailModal();
  document.getElementById('precQ').value = cod;
  // showTab no existe — usar goTab (la función real de navegación de tabs)
  goTab('prec', document.querySelectorAll('.tab[data-tab="prec"]')[0]);
  if(typeof doPrec==='function') doPrec();
}
function rdGoUbi(){
  if(!_rdCurrent) return;
  // Guardar ANTES de cerrar: closeRefDetailModal() pone _rdCurrent = null
  const ubi = _rdCurrent.ubi;
  const cod = _rdCurrent.cod;
  closeRefDetailModal();
  if(typeof goBusUbi==='function') goBusUbi(ubi, cod);
}

// ── Imágenes de referencia (botón "Ver imágenes" del modal de detalle) ──
// Solo por botón — nunca automático, para no saturar a DuckDuckGo (que
// bloquea temporalmente si se le piden muchas búsquedas seguidas). No hay
// llaves: server.js hace la búsqueda; aquí solo se llama a /api/imagenes
// por el mismo Worker que el resto de la API.
// Cada foto es una MINIATURA de DuckDuckGo; al tocarla se abre un visor
// ampliado con la imagen completa (si el sitio de origen no deja
// mostrarla se queda la miniatura) y el enlace a la página de origen para
// confirmar la pieza allá. Son fotos de apoyo para identificar, no un
// catálogo oficial: por eso se rotulan "verificar antes de usar".
let _rdImgItems = [];
let _rdLbIdx = 0;
const _rdImgCache = new Map();   // sesión: evita repetir la llamada al reabrir el mismo código

function _rdSafeUrl(u){ return /^https?:\/\//i.test(String(u||'')) ? String(u) : ''; }

async function rdShowImages(){
  if(!_rdCurrent) return;
  const cod = _rdCurrent.cod;
  const invRow = INV_IDX.get(normCode(cod));
  const desc = invRow ? (invRow[1]||'') : '';
  const btn = document.getElementById('rdImgBtn');
  const box = document.getElementById('rdImgResult');
  box.style.display = 'block';

  const key = normCode(cod);
  let data = _rdImgCache.get(key);
  if(!data){
    if(btn) btn.disabled = true;
    box.innerHTML = '<div class="rd-img-loading"><span class="spin"></span> Buscando imágenes…</div>';
    try{
      const r = await apiFetch('/api/imagenes?cod='+encodeURIComponent(cod)+'&desc='+encodeURIComponent(desc));
      const j = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(j.error || ('Error '+r.status));
      data = j;
      _rdImgCache.set(key, data);
    }catch(e){
      // Si el modal ya cambió de referencia mientras esperaba, no pisar el nuevo contenido.
      if(_rdCurrent && _rdCurrent.cod===cod){
        box.innerHTML = '<div class="rd-img-warn">⚠ '+escHtml(e.message||'No se pudieron buscar imágenes.')+'</div>';
      }
      if(btn) btn.disabled = false;
      return;
    }
    if(btn) btn.disabled = false;
  }
  if(!_rdCurrent || _rdCurrent.cod!==cod) return;

  const items = (data.items||[]).filter(it=>_rdSafeUrl(it.thumb) && _rdSafeUrl(it.full));
  _rdImgItems = items;
  if(!items.length){
    box.innerHTML = '<div class="rd-img-warn">Sin imágenes para esta referencia.</div>';
    return;
  }
  const aviso = data.modo==='descripcion'
    ? '<div class="rd-img-warn">No hubo coincidencia por código: estas fotos salen de la descripción y son solo referenciales, pueden no ser esta pieza exacta.</div>'
    : '';
  box.innerHTML = aviso +
    '<div class="rd-img-label">Imágenes de referencia · verificar antes de usar</div>'+
    '<div class="rd-img-gallery">'+items.map((it,i)=>
      '<button class="rd-img-thumb" onclick="rdOpenLightbox('+i+')" title="'+escHtml(it.title||'')+'">'+
      '<img src="'+escHtml(it.thumb)+'" loading="lazy" alt="" referrerpolicy="no-referrer"></button>'
    ).join('')+'</div>';
}

function rdOpenLightbox(i){
  if(!_rdImgItems.length) return;
  _rdLbIdx = Math.max(0, Math.min(i, _rdImgItems.length-1));
  rdRenderLightbox();
  document.getElementById('rdLightbox').classList.add('on');
}
function rdRenderLightbox(){
  const it = _rdImgItems[_rdLbIdx]; if(!it) return;
  const img = document.getElementById('rdLbImg');
  // Imagen completa; si el sitio bloquea hotlinking o falla, cae a la miniatura.
  img.onerror = ()=>{ img.onerror = null; img.src = it.thumb; };
  img.src = it.full;
  document.getElementById('rdLbCount').textContent = (_rdLbIdx+1)+' / '+_rdImgItems.length;
  document.getElementById('rdLbTitle').textContent = it.title || '';
  const src = document.getElementById('rdLbSrc');
  const s = _rdSafeUrl(it.source);
  src.style.display = s ? '' : 'none';
  src.href = s || '#';
}
function rdLbStep(d){
  if(!_rdImgItems.length) return;
  _rdLbIdx = (_rdLbIdx + d + _rdImgItems.length) % _rdImgItems.length;
  rdRenderLightbox();
}
function rdCloseLightbox(){
  document.getElementById('rdLightbox').classList.remove('on');
  document.getElementById('rdLbImg').removeAttribute('src');
}


// Trae el inventario desde el servicio puente (server.js → SQL Server).
// Si falla (túnel caído, red, token) NO borra lo que había — el último
// dato cargado (SQL o Excel) sigue disponible. Como fallback descarga el
// Excel de GitHub igual que antes.
const SQL_INV_URL = API_URL + "/api/kaizen";
   // definido al inicio del script

async function loadInvFromSQL(silent = false){
  try{
    if(MANUAL_EXCEL_MODE) throw new Error('Modo Excel activado manualmente');
    if(!silent) autobar(15);
    // ── Radar de Cambios: snapshot de la sede activa ANTES de traer los
    // datos nuevos ──────────────────────────────────────────────────────
    // Desde que el inventario (stock/ubicación) pasó a venir de SQL en vez
    // de Excel, el radar dejó de detectar esos cambios: buildSnapshot()/
    // detectChanges() solo se llamaban al final de processExcel(), y el
    // Excel ya no trae stock — solo precios. Este refresco de SQL (tanto
    // el inicial como los silenciosos de scheduleReload) nunca disparaba
    // la comparación. Se captura aquí, ANTES del fetch, y se compara más
    // abajo una vez setActiveBodega reconstruye INV con los datos nuevos
    // — misma sede activa en ambos extremos, así que compara peras con
    // peras (cambiar de sede manualmente NO pasa por aquí, así que no
    // genera falsos positivos entre Sur y Norte).
    const _prevSrc = INV_SOURCE;
    const _radSnapSQL = (INV.length && INV_SOURCE==='sql') ? buildSnapshot() : null;

    // bodega=all → una sola petición trae Sur y Norte. Necesario para que
    // el aviso cruzado funcione sin red y sin una llamada por búsqueda.
    // Timeout: si el servidor no existe o no responde (app fuera de la red
    // corporativa) no se debe quedar colgado — se pasa al modo respaldo.
    const _ctl = new AbortController();
    const _tmo = setTimeout(()=>_ctl.abort(), SQL_FETCH_TIMEOUT_MS);
    let res;
    try{
      res = await apiFetch('/api/kaizen?bodega=all', { signal: _ctl.signal });
    }finally{ clearTimeout(_tmo); }
    if(!res.ok) throw new Error('HTTP ' + res.status);
    if(!silent) autobar(55);
    const raw = await res.json();

    // Normalizar y separar por bodega en una sola pasada. Acepta tanto
    // el nombre de columna crudo del SQL (Bodega) como el normalizado
    // (bodega) por si el backend cambia de forma en el futuro.
    const porBodega = {};
    for(const id of Object.keys(BODEGAS)) porBodega[id] = [];

    for(const r of raw){
      const bod = Number(r.bodega ?? r.Bodega ?? BODEGA_DEFAULT);
      if(!BODEGAS[bod]) continue;   // bodega desconocida: se ignora
      porBodega[bod].push({
        bodega:    bod,
        cod:       r.codigo            ?? r.cod       ?? '',
        desc:      r.Descripcion       ?? r.desc      ?? '',
        stock:     r.Stock             ?? r.stock     ?? 0,
        ubicacion: r.Ubicacion         ?? r.ubicacion ?? '',
        abc:       r.ABC               ?? r.abc       ?? '',
        grupo:     r.SubGrupo2         ?? r.grupo     ?? '',
        m1: r.M1 ?? r.m1 ?? 0,
        m2: r.M2 ?? r.m2 ?? 0,
        m3: r.M3 ?? r.m3 ?? 0,
        m4: r.M4 ?? r.m4 ?? 0,
        m5: r.M5 ?? r.m5 ?? 0,
        m6: r.M6 ?? r.m6 ?? 0,
        costo:     r.Costo_Inventario  ?? r.costo       ?? 0,
        costo_prom:r.Costo_Promedio    ?? r.costo_prom  ?? 0,
        fecha:     r.Fecha_entrada     ?? r.fecha       ?? '',
        ultima_compra: r.ultima_compra ?? r.FechaUltimaCompra ?? '',
        oo:    r.oo ?? 0,
        // B/O: aceptar cualquier variante de nombre que el SQL exporte
        bo:    r.BO ?? r['B/O'] ?? r.bo ?? r.BackOrder ?? 0,
        score: r.score ?? 0,
        // ── Campos DPOK Guía de Abastecimiento ──────────────────────
        dad:       r.DAD               ?? r.dad          ?? 0,   // Días antigüedad demanda
        mip_sql:   r.MIP               ?? r.mip          ?? 0,   // Punto Máx. Inventario (SQL)
        dias_inv:  r.Dias_Inv_Act_Prom ?? r.dias_inv     ?? 0,   // Días que alcanza el stock actual según el DAD (cobertura en días)
        fase_in:   r.FASE_IN           ?? r.fase_in      ?? 0,   // Entrando en fase
        fase_out:  r.FASE_OUT          ?? r.fase_out     ?? 0,   // Saliendo de fase
        // OJO: "Dias" NO es Lead Time — es días desde la última compra
        // (antigüedad de la última orden). El Lead Time real no tiene
        // fuente en el SQL; sigue siendo el parámetro L/T que el usuario
        // ajusta manualmente en el panel de Diagnóstico.
        dias_ult_compra: r.Dias        ?? r.dias         ?? 0,
        // Sugerido_1 del SQL NO se mapea aquí — es un precio en la base
        // de datos, no una cantidad sugerida de pedido; no aplica a este
        // sistema (confirmado por el usuario).
        categoria: r['Categoria Inventario'] ?? r.Categoria_Inventario ?? r.categoria ?? '',
        subgrupo:  r.SubGrupo          ?? r.subgrupo     ?? '',
        subgrupo2: r.SubGrupo2         ?? r.subgrupo2    ?? '',
        subgrupo3: r.SubGrupo3         ?? r.subgrupo3    ?? '',
        stock_min: r.Stock_Min         ?? r.stock_min    ?? 0,
        stock_max: r.Stock_Max         ?? r.stock_max    ?? 0,
        stock_seg: r.Stock_Seguridad   ?? r.stock_seg    ?? 0,
      });
    }

    if(!Object.values(porBodega).some(a=>a.length)) throw new Error('El servidor respondió sin filas');
    set_INV_RAW_BY_BODEGA( porBodega);
    saveBodegaCache(porBodega);
    // SQL volvió: salir del modo respaldo
    set_INV_SOURCE( 'sql'); set__wantExcelInv( false); set__skipRadarOnce( false);
    hideFallbackBanner();

    if(!silent) autobar(85);
    // Restaura la sede que el usuario tenía activa en esta sesión/dispositivo
    // (ver setActiveBodega — el login ya fija ACTIVE_BODEGA según el perfil).
    setActiveBodega(ACTIVE_BODEGA, {silent, skipReload:true});

    // ── Radar de Cambios: comparar contra el snapshot de antes de este
    // refresh. La parte de precios del diff siempre sale vacía aquí (SQL
    // no toca PRICES), así que solo puede reportar STOCK/UBICACION —
    // exactamente lo que se estaba perdiendo.
    if(_radSnapSQL){
      const _afterSnapSQL = buildSnapshot();
      const _changesSQL = detectChanges(_radSnapSQL, _afterSnapSQL);
      if(_changesSQL.length) saveChanges(_changesSQL);
    }

    updateFreshBadge(Date.now());
    handleQRParam();
    // Siempre verificar si el Excel de GitHub cambió, sin importar si ya
    // hay precios en caché. El HEAD request con ETag es barato (~200ms) y
    // no re-descarga el archivo si no cambió. Esto corrige que en móvil,
    // cuando iOS o Android liberan storage y PRICES queda {} o desactualizado,
    // el Excel se recargue en el siguiente arranque sin intervención manual.
    autoLoadExcel(true).catch(e => console.warn('[autoLoadExcel init]', e.message));
    if(!silent) setTimeout(()=>autobar(0), 600);

  } catch(e){
    autobar(0);
    console.warn('[SQL inventario] Fallo al cargar desde SQL:', e.message);
    // Sin SQL: decidir la fuente de respaldo.
    //  · caché del dispositivo reciente (≤ FALLBACK_CACHE_MAX_H) → se usa (es dato SQL completo)
    //  · si no hay caché, o es viejo → Excel de GitHub (modo respaldo)
    let cacheTs = 0, cached = null;
    try{
      const rawC = localStorage.getItem(BODEGA_CACHE_KEY);
      if(rawC){ const o = JSON.parse(rawC); cacheTs = o.ts||0; cached = o.data||null; }
    }catch(_){}
    const ageH = cacheTs ? (Date.now()-cacheTs)/3600000 : Infinity;
    if(INV_SOURCE==='excel' && INV.length){
      // Ya estamos en modo respaldo y SQL sigue caído: mantener, y revisar si el Excel cambió.
      showFallbackBanner('excel');
      autoLoadExcel(true).catch(()=>{});
      return;
    }
    if(!MANUAL_EXCEL_MODE && cached && Object.keys(cached).length && ageH <= FALLBACK_CACHE_MAX_H){
      set_INV_RAW_BY_BODEGA( cached);
      set_INV_SOURCE( 'cache');
      setActiveBodega(ACTIVE_BODEGA, {silent:true, skipReload:true});
      showFallbackBanner('cache', 'hace '+(ageH<1?Math.max(1,Math.round(ageH*60))+' min':Math.round(ageH)+' h'));
      // Los precios/estantes del Excel se mantienen frescos aunque SQL esté caído.
      autoLoadExcel(true).catch(()=>{});
      scheduleReload();
      return;
    }
    if(!silent && !INV.length){
      document.getElementById('hstattext').textContent = 'SQL no disponible · cargando Excel de respaldo…';
    }
    // Respaldo: inventario completo desde el Excel de GitHub
    set__wantExcelInv( true);
    autoLoadExcel(silent);
    return; // scheduleReload lo arranca autoLoadExcel
  }
  scheduleReload();
}

// Sincronización profunda: pide al ERP que refresque t_kaizen (ejecuta
// SP_TCU del lado del SQL Server) — operación pesada, por eso queda
// restringida a administradores en vez de dispararse en cada recarga de
// cualquier usuario. Tras confirmar éxito, refresca la app con
// loadInvFromSQL() para traer ya los datos actualizados.
// Sincronización asíncrona con el ERP (arreglo del 502 Bad Gateway):
// SP_TCU tarda ~28s y Cloudflare Workers corta cualquier petición HTTP a
// los ~15s. Por eso el POST ya no espera al SP — lo dispara, responde 202
// de inmediato, y aquí se pregunta el estado cada 3s hasta que termina.
// Además viaja atada a la bodega ACTIVA: sincronizar Norte no bloquea Sur.
async function syncERPFromSQL(btn){
  if(!CURRENT_USER || CURRENT_USER.rol!=='admin'){
    alert('Solo un administrador puede sincronizar con el ERP.');
    return;
  }
  const bodega = ACTIVE_BODEGA;
  if(!confirm(`Esto le pide al ERP que actualice los datos de ${BODEGAS[bodega].sede} (bodega ${bodega}) — puede tardar unos minutos. ¿Continuar?`)) return;

  const origHtml = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled=true; btn.innerHTML='⏳ Iniciando sincronización…'; }

  const POLL_MS     = 3000;             // cada cuánto se pregunta el estado
  const MAX_WAIT_MS = 10*60*1000;       // se rinde a los 10 minutos
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  try{
    // ── 1. Disparar el trabajo para esta bodega (respuesta inmediata: 202) ──
    const res = await apiFetch(`/api/sync-kaizen?bodega=${bodega}`, { method: 'POST' });

    // 409 = ya había una sincronización corriendo para esta bodega (otro
    // admin la lanzó). No es un error: nos enganchamos a esa y esperamos.
    if(res.status !== 202 && res.status !== 409){
      throw new Error('HTTP '+res.status);
    }
    if(res.status === 409){
      if(btn) btn.innerHTML='⏳ Ya hay una sincronización en curso — esperando…';
    }

    // ── 2. Consultar el estado hasta que termine ──
    const t0 = Date.now();
    let estado = null;

    while(Date.now() - t0 < MAX_WAIT_MS){
      await sleep(POLL_MS);

      let st;
      try{
        st = await apiFetch(`/api/sync-kaizen/status?bodega=${bodega}`);
      }catch(netErr){
        // Un fallo de red puntual no debe abortar: el SP sigue corriendo
        // del otro lado. Se reintenta en el siguiente ciclo.
        continue;
      }
      if(!st.ok) continue;

      estado = await st.json();

      if(estado.state === 'running'){
        const seg = Math.round((Date.now() - t0)/1000);
        if(btn) btn.innerHTML = `⏳ Sincronizando ${BODEGAS[bodega].nombre}… (${seg}s)`;
        continue;
      }
      break; // done | error | idle
    }

    // ── 3. Resolver según el resultado ──
    if(!estado || estado.state === 'running'){
      throw new Error('La sincronización sigue en curso tras varios minutos. Los datos pueden actualizarse solos más tarde; vuelva a consultar el inventario en unos minutos.');
    }
    if(estado.state === 'error'){
      throw new Error(estado.error || 'El ERP reportó un error durante la sincronización');
    }

    // Estado 'done': ya se puede traer el inventario fresco (las dos sedes).
    if(btn) btn.innerHTML='⏳ Trayendo datos actualizados…';
    await loadInvFromSQL(false);

    const dur = estado.durationMs ? ' ('+Math.round(estado.durationMs/1000)+'s)' : '';
    alert(`✅ ${BODEGAS[bodega].sede} sincronizada${dur} — inventario actualizado con los datos más recientes.`);

  }catch(e){
    console.error('[Sync ERP]', e);
    alert('❌ No se pudo sincronizar con el ERP: '+(e.message||e));
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML=origHtml; }
  }
}

export { closeCrossBodegaModal, closeRefDetailModal, loadInvFromSQL, lookupCrossBodega, onBodegaSwitch, openCrossBodegaModal, openRefDetailFromPrec, openRefDetailModal, rdCloseLightbox, rdCopyCode, rdGoPrice, rdGoUbi, rdLbStep, rdOpenLightbox, rdShowImages, recomputeEstantesLibres, recomputeUbiTeoOcupacion, setActiveBodega, syncERPFromSQL, xbCopyCode, xbSwitchToThere };
