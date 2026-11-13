import { CURRENT_USER } from './auth.js';
import { INV, PICKLIST, PRICES, UBI_TEO } from './state-globals.js';
import { getPriceRow } from './file-upload.js';
import { getEffectivePrice } from './precios-divisor.js';
import { goTab } from './ui-header-tabs.js';
import { doSearch } from './buscador.js';
import { setPM } from './precios.js';
import { doUbi } from './ubicaciones.js';
import { escHtml, jsAttrSafe, pickKeyFromItem, pickSave, renderPickUI } from './utils.js';
import { openPanoramaModal, openQRShelfModal } from './modales-estante-panorama.js';
// ═══ js/radar-cambios.js — extraído de index.html (líneas 11391–11938 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════════════════
//  RADAR DE CAMBIOS — Motor de diff automático entre versiones del Excel
// ══════════════════════════════════════════════════════════════════════════════

const NOV_CHANGES_KEY = 'ctrl_ubi_changes_v1';
let _novFilter = 'TODOS';

// Formato de moneda compartido entre detectChanges() y saveChanges() (la
// consolidación recalcula deltas sobre el arrastre completo, no solo el
// último salto — ver saveChanges).
const novFmtCOP = n => Number(n||0).toLocaleString('es-CO', {minimumFractionDigits:0, maximumFractionDigits:0});

// ── Snapshot compacto del estado actual ──
function buildSnapshot(){
  const snap = { ts: Date.now(), inv: {}, prices: {} };
  // INV: [cod, desc, stock, ubi, ...]
  // OJO: un código puede estar en VARIAS ubicaciones — antes solo se
  // guardaba la primera que aparecía en INV, así que un código con 2+
  // ubicaciones podía disparar un falso "cambio de ubicación" cada vez
  // que el orden de las filas del Excel variaba entre cargas, aunque
  // ninguna ubicación real hubiera cambiado. Ahora se guarda el conjunto
  // completo (ordenado, para comparar de forma estable) y detectChanges()
  // solo reporta UBI cuando el código tiene exactamente una ubicación en
  // ambos snapshots.
  for(const r of INV){
    const cod = r[0];
    if(!snap.inv[cod]) snap.inv[cod] = { s:0, u:new Set(), d:r[1] };
    snap.inv[cod].s += Number(r[2])||0;
    if(r[3]) snap.inv[cod].u.add(r[3]);
  }
  for(const cod in snap.inv) snap.inv[cod].u = [...snap.inv[cod].u].sort();
  // PRICES: [mostrador, accesorios, desc, costo]
  for(const [cod, row] of Object.entries(PRICES)){
    if(row && row[0]) snap.prices[cod] = [Number(row[0])||0, Number(row[1])||0, Number(row[3])||0];
  }
  return snap;
}

// ── Motor de diff ──
function detectChanges(before, after){
  if(!before || !after) return [];
  const changes = [];
  const ts = Date.now();
  const bCods = new Set(Object.keys(before.inv));
  const aCods = new Set(Object.keys(after.inv));

  // Nuevas referencias
  for(const cod of aCods){
    if(!bCods.has(cod)){
      const a = after.inv[cod];
      changes.push({ type:'NUEVO', cod, desc:a.d, stock:a.s, ubi:(a.u&&a.u[0])||'', ts, read:false });
    }
  }

  // Referencias removidas
  for(const cod of bCods){
    if(!aCods.has(cod)){
      const b = before.inv[cod];
      changes.push({ type:'REMOVIDO', cod, desc:b.d, ts, read:false });
    }
  }

  // Cambios de stock y ubicación
  for(const cod of aCods){
    if(!bCods.has(cod)) continue;
    const b = before.inv[cod];
    const a = after.inv[cod];
    const bs = Number(b.s)||0, as_ = Number(a.s)||0;
    const ubiTxt = (a.u&&a.u[0])||(b.u&&b.u[0])||'';

    // Antes esto solo miraba "¿llegó EXACTO a 0?" y "¿bajó pero se quedó
    // arriba de 0?" — un salto directo a stock NEGATIVO (overselling,
    // typeo de digitación) no encajaba en ninguno de los dos casos y
    // quedaba completamente invisible para el Radar. Ahora cualquier
    // cambio de stock genera algo: cruzar a ≤0 es AGOTADO (o AGOTADO_NEG
    // si quedó en negativo, más grave — típicamente error de digitación
    // más que agotamiento real), y cualquier otro movimiento es
    // STOCK_UP/STOCK_DOWN sin importar en qué terreno (positivo o
    // negativo) esté.
    if(bs !== as_){
      if(bs > 0 && as_ <= 0){
        changes.push({ type: as_ < 0 ? 'AGOTADO_NEG' : 'AGOTADO', cod, desc:a.d, oldStock:bs, newStock:as_, ubi:ubiTxt, ts, read:false });
      } else if(as_ > bs){
        changes.push({ type:'STOCK_UP', cod, desc:a.d, oldStock:bs, newStock:as_, delta:as_-bs, ts, read:false });
      } else {
        changes.push({ type:'STOCK_DOWN', cod, desc:a.d, oldStock:bs, newStock:as_, delta:as_-bs, ts, read:false });
      }
    }

    // Cambio de ubicación: solo se reporta cuando el código vive en
    // EXACTAMENTE una ubicación en ambos snapshots. Con 2+ ubicaciones el
    // "conjunto" puede variar de orden o de tamaño (agregar/quitar una
    // bodega) sin que sea realmente un traslado 1-a-1, así que reportarlo
    // como "cambio de ubicación" sería engañoso — mejor omitirlo que dar
    // un falso positivo.
    if(b.u.length===1 && a.u.length===1){
      const bu=b.u[0], au=a.u[0];
      if(bu!==au && au!=='Sin Ubicacion' && bu!=='Sin Ubicacion'){
        changes.push({ type:'UBI', cod, desc:a.d, oldUbi:bu, newUbi:au, ts, read:false });
      }
    }
  }

  // Cambios de precio Mostrador y de Costo (antes el costo se guardaba en
  // el snapshot pero nunca se comparaba — dato muerto. El costo es clave
  // para saber si el margen de una referencia se está achicando aunque el
  // precio de venta no se haya tocado).
  const allPriceCods = new Set([...Object.keys(before.prices), ...Object.keys(after.prices)]);
  for(const cod of allPriceCods){
    const b = before.prices[cod];
    const a = after.prices[cod];
    if(!b || !a) continue;
    const desc = (after.inv[cod]||before.inv[cod]||{}).d || '—';

    const bm = Number(b[0])||0, am = Number(a[0])||0;
    if(bm > 0 && am > 0 && bm !== am){
      const delta = am - bm, pct = Math.round((delta / bm) * 100);
      changes.push({
        type: delta > 0 ? 'PRECIO_UP' : 'PRECIO_DOWN',
        cod, desc, field:'Mostrador',
        oldPrice:bm, newPrice:am, delta, pct,
        oldFmt: novFmtCOP(bm), newFmt: novFmtCOP(am), deltaFmt: novFmtCOP(Math.abs(delta)),
        ts, read:false
      });
    }

    const bc = Number(b[2])||0, ac = Number(a[2])||0; // [mostrador, accesorios, costo]
    if(bc > 0 && ac > 0 && bc !== ac){
      const delta = ac - bc, pct = Math.round((delta / bc) * 100);
      changes.push({
        type: delta > 0 ? 'COSTO_UP' : 'COSTO_DOWN',
        cod, desc, field:'Costo',
        oldPrice:bc, newPrice:ac, delta, pct,
        oldFmt: novFmtCOP(bc), newFmt: novFmtCOP(ac), deltaFmt: novFmtCOP(Math.abs(delta)),
        ts, read:false
      });
    }
  }

  // Eliminar duplicados dentro de la misma actualización
  const seen = new Set();
  return changes.filter(c => {
    const k = c.type + '|' + c.cod;
    if(seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── Persistencia ──
function saveChanges(changes){
  if(!changes.length) return;
  try{
    // Antes: cada actualización simplemente ANTEPONÍA sus cambios a la
    // lista existente, con un tope global de 300 registros. Eso tenía dos
    // problemas: (1) si el mismo código subía de precio 20 días seguidos,
    // aparecían 20 tarjetas casi idénticas — puro ruido; y (2) el tope de
    // 300 se repartía entre TODAS las actualizaciones acumuladas, así que
    // una carga grande podía desplazar (borrar) el historial de una carga
    // reciente sin avisar. Ahora se CONSOLIDA: mismo código+tipo de
    // cambio se fusiona en una sola tarjeta, conservando el valor
    // ORIGINAL (antes del primer cambio detectado) para mostrar el
    // arrastre completo, y contando cuántas veces ha cambiado.
    const existing = loadChanges();
    const byKey = new Map(existing.map(e => [e.type+'|'+e.cod, e]));
    for(const c of changes){
      const key = c.type+'|'+c.cod;
      const prev = byKey.get(key);
      if(!prev){ byKey.set(key, {...c, firstTs:c.ts, occurrences:1}); continue; }
      const merged = {...c, firstTs: prev.firstTs||prev.ts, occurrences:(prev.occurrences||1)+1, read:false};
      if(prev.oldStock!=null) merged.oldStock=prev.oldStock;
      if(prev.oldUbi!=null)   merged.oldUbi=prev.oldUbi;
      if(prev.oldPrice!=null) merged.oldPrice=prev.oldPrice;
      if(merged.oldStock!=null && merged.newStock!=null) merged.delta = merged.newStock-merged.oldStock;
      if(merged.oldPrice!=null && merged.newPrice!=null){
        merged.delta = merged.newPrice-merged.oldPrice;
        merged.pct = merged.oldPrice ? Math.round((merged.delta/merged.oldPrice)*100) : 0;
        merged.oldFmt=novFmtCOP(merged.oldPrice); merged.newFmt=novFmtCOP(merged.newPrice); merged.deltaFmt=novFmtCOP(Math.abs(merged.delta));
      }
      byKey.set(key, merged);
    }
    // El tope ahora es por combinación código+tipo (no por evento), así
    // que 500 alcanza para muchísimo más historial real antes de empezar
    // a descartar lo más antiguo (por última vez visto).
    const all = [...byKey.values()].sort((a,b)=>b.ts-a.ts).slice(0, 500);
    localStorage.setItem(NOV_CHANGES_KEY, JSON.stringify(all));
    updateNovBadge();
    // Si el panel está visible, refrescarlo
    if(document.getElementById('panel-novedades')?.classList.contains('active')) renderNovedades();
  } catch(e){}
}
function loadChanges(){
  try{ const r = localStorage.getItem(NOV_CHANGES_KEY); return r ? JSON.parse(r) : []; } catch(e){ return []; }
}
function countUnread(){ return loadChanges().filter(c => !c.read).length; }
function updateNovBadge(){
  const n = countUnread();
  const badge = document.getElementById('novBadge');
  if(!badge) return;
  badge.textContent = n > 99 ? '99+' : n;
  badge.style.display = n > 0 ? 'inline-flex' : 'none';
}
function markAllRead(){
  try{
    localStorage.setItem(NOV_CHANGES_KEY, JSON.stringify(loadChanges().map(c => ({...c, read:true}))));
  } catch(e){}
  updateNovBadge();
  renderNovedades();
}
// Faltaba por completo: el onclick de cada fila de Novedades ya llamaba a
// markOneRead(cod), pero la función nunca se había escrito — cada clic
// navegaba a la búsqueda (doBusFromNov) sin marcar nada como leído, así
// que el contador de "no leídas" nunca bajaba salvo con "Marcar todo".
// Marca TODAS las entradas de ese código (puede haber una por tipo de
// cambio: precio, stock, etc.) para que un solo clic limpie el badge de
// esa referencia por completo.
function markOneRead(cod){
  const c = String(cod??'').trim().toUpperCase();
  try{
    localStorage.setItem(NOV_CHANGES_KEY, JSON.stringify(loadChanges().map(x => x.cod===c ? {...x, read:true} : x)));
  } catch(e){}
  updateNovBadge();
}
function clearAllChanges(){
  if(!confirm('¿Limpiar todo el historial del Radar de Cambios?')) return;
  localStorage.removeItem(NOV_CHANGES_KEY);
  updateNovBadge();
  renderNovedades();
}
function setNovFilter(f){ _novFilter = f; renderNovedades(); }
function doBusFromNov(cod){
  document.getElementById('busQ').value = cod;
  goTab('bus', document.querySelector('.tab[data-tab="bus"]'));
  setPM('EXA'); doSearch();
}

// ── Render del panel ──
let _novSearch = '';
function setNovSearch(v){ _novSearch = (v||'').trim().toUpperCase(); renderNovedades(); }
function novAddToTray(cod){
  const r = INV.find(x=>x[0]===cod);
  if(!r){ alert('Ese código ya no está en el inventario actual.'); return; }
  const pr = getPriceRow(cod);
  const price = pr ? getEffectivePrice(pr, r[6]) : null;
  const item = {cod:r[0], desc:r[1]||'', stock:r[2]||0, ubi:r[3]||'', price: price!=null?Math.round(price):null};
  const key = pickKeyFromItem(item);
  if(PICKLIST.has(key)){ alert('Esa referencia ya está en el Selection Tray.'); return; }
  PICKLIST.set(key, {...item, ts:Date.now()});
  pickSave();
  renderPickUI();
  const fab=document.getElementById('pickFab');
  if(fab){fab.classList.remove('bump');void fab.offsetWidth;fab.classList.add('bump');setTimeout(()=>fab.classList.remove('bump'),300);}
}

function renderNovedades(){
  const container = document.getElementById('novContainer');
  if(!container) return;
  const all = loadChanges();
  const unread = all.filter(c => !c.read).length;

  if(!all.length){
    container.innerHTML = `<div class="nov-empty">
      <div class="nov-empty-ico">📡</div>
      <div class="nov-empty-txt">SIN CAMBIOS DETECTADOS AÚN<br><br>
      Los cambios aparecen aquí automáticamente<br>
      cada vez que el Excel se actualiza en GitHub.<br><br>
      La comparación ocurre en cada recarga del archivo<br>
      (automática cada 5 min o al cargar manualmente).</div>
    </div>`;
    return;
  }

  // Conteos por tipo para filtros
  const cnt = t => all.filter(c => c.type === t).length;
  const cntPre = cnt('PRECIO_UP') + cnt('PRECIO_DOWN');
  const cntCosto = cnt('COSTO_UP') + cnt('COSTO_DOWN');
  const cntStk = cnt('STOCK_UP') + cnt('STOCK_DOWN');
  const cntAg = cnt('AGOTADO') + cnt('AGOTADO_NEG');

  // Filtrar por categoría
  let filtered = _novFilter === 'TODOS'   ? all
    : _novFilter === 'NOLEIDOS' ? all.filter(c => !c.read)
    : _novFilter === 'PRECIO'   ? all.filter(c => c.type.startsWith('PRECIO'))
    : _novFilter === 'COSTO'    ? all.filter(c => c.type.startsWith('COSTO'))
    : _novFilter === 'AGOTADO'  ? all.filter(c => c.type==='AGOTADO'||c.type==='AGOTADO_NEG')
    : _novFilter === 'STOCK'    ? all.filter(c => c.type.startsWith('STOCK'))
    : _novFilter === 'NUEVO'    ? all.filter(c => c.type === 'NUEVO')
    : _novFilter === 'UBI'      ? all.filter(c => c.type === 'UBI')
    : _novFilter === 'REMOVIDO' ? all.filter(c => c.type === 'REMOVIDO')
    : all;
  // Buscador: por código o descripción, dentro de lo ya filtrado por categoría.
  if(_novSearch) filtered = filtered.filter(c =>
    String(c.cod||'').toUpperCase().includes(_novSearch) || String(c.desc||'').toUpperCase().includes(_novSearch)
  );

  // Antigüedad
  const lastTs = Math.max(...all.map(c => c.ts));
  const ageMin = Math.round((Date.now() - lastTs) / 60000);
  const ageStr = ageMin < 1 ? 'ahora mismo'
    : ageMin < 60 ? `hace ${ageMin} min`
    : `hace ${Math.floor(ageMin/60)}h ${ageMin%60}min`;

  // Mapa de tipos
  const TC = {
    PRECIO_UP:   { ico:'↑', cls:'ni-pu', lbl:'💰 Precios que subieron' },
    PRECIO_DOWN: { ico:'↓', cls:'ni-pd', lbl:'💰 Precios que bajaron' },
    COSTO_UP:    { ico:'↑', cls:'ni-cu', lbl:'🏷 Costo que subió (revisar margen)' },
    COSTO_DOWN:  { ico:'↓', cls:'ni-cd', lbl:'🏷 Costo que bajó' },
    AGOTADO:     { ico:'⚠', cls:'ni-ag', lbl:'⚠ Agotados' },
    AGOTADO_NEG: { ico:'⛔', cls:'ni-agn', lbl:'⛔ Stock negativo (revisar digitación)' },
    STOCK_UP:    { ico:'↑', cls:'ni-su', lbl:'📦 Stock que aumentó' },
    STOCK_DOWN:  { ico:'↓', cls:'ni-sd', lbl:'📦 Stock que bajó' },
    NUEVO:       { ico:'★', cls:'ni-nv', lbl:'🆕 Nuevas referencias' },
    UBI:         { ico:'⇄', cls:'ni-ub', lbl:'📍 Cambio de ubicación' },
    REMOVIDO:    { ico:'✗', cls:'ni-rm', lbl:'🗑 Removidos' },
  };
  const ORDER = ['AGOTADO_NEG','PRECIO_UP','PRECIO_DOWN','COSTO_UP','COSTO_DOWN','AGOTADO','NUEVO','STOCK_UP','STOCK_DOWN','UBI','REMOVIDO'];

  // Magnitud para ordenar cada grupo (lo más significativo primero, no
  // solo lo más reciente): % para precio/costo, |delta| para stock.
  const magnitude = c => c.pct!=null ? Math.abs(c.pct) : (c.delta!=null ? Math.abs(c.delta) : 0);

  function occBadge(c){
    if(!c.occurrences || c.occurrences<=1) return '';
    const firstStr = c.firstTs ? new Date(c.firstTs).toLocaleDateString('es-CO',{day:'2-digit',month:'short'}) : '';
    return `<span class="nov-occ" title="Ha cambiado ${c.occurrences} veces desde ${firstStr}">×${c.occurrences} desde ${firstStr}</span>`;
  }

  // ── Vista en tabla (compacta, igual al PDF) ───────────────────────
  function rowHtml(c, rowNum){
    const tc = TC[c.type] || { ico:'•', cls:'', lbl:'' };
    const unreadCls = c.read ? '' : ' nov-tr-unread';

    let antes='—', despues='—', delta='—', actsHtml='';

    if(c.type==='PRECIO_UP'||c.type==='PRECIO_DOWN'||c.type==='COSTO_UP'||c.type==='COSTO_DOWN'){
      const up=c.delta>0;
      const col=up?'var(--red)':'var(--green)';
      antes=`$${c.oldFmt}`;
      despues=`<span style="color:${col};font-weight:700">$${c.newFmt}</span>`;
      delta=`<span style="color:${col};font-weight:700">${up?'+':''}${c.pct}%</span>`;
      actsHtml=`<button class="nov-act" onclick="doBusFromNov('${jsAttrSafe(c.cod)}')">🔍</button>
                <button class="nov-act" onclick="goPrecio('${jsAttrSafe(c.cod)}')">💰</button>
                <button class="nov-act" onclick="event.stopPropagation();openRadarPriceHistory('${jsAttrSafe(c.cod)}')" title="Ver comparativa completa de esta referencia (guardada en este dispositivo)">📈</button>`;
    } else if(c.type==='AGOTADO'||c.type==='AGOTADO_NEG'){
      antes=String(c.oldStock??'—');
      despues=`<span style="color:var(--red);font-weight:700">${c.type==='AGOTADO_NEG'?c.newStock:'0'}</span>`;
      delta=c.type==='AGOTADO_NEG'?`<span style="color:var(--red)">⛔ neg</span>`:`<span style="color:var(--red)">⚠ 0</span>`;
      actsHtml=`<button class="nov-act" onclick="doBusFromNov('${jsAttrSafe(c.cod)}')">🔍</button>
                ${c.ubi&&c.ubi!=='Sin Ubicacion'?`<button class="nov-act" onclick="goBusUbi('${jsAttrSafe(c.ubi)}')">📍</button>`:''}`;
    } else if(c.type==='STOCK_UP'||c.type==='STOCK_DOWN'){
      const up=c.delta>0;
      const col=up?'var(--green)':'var(--amber)';
      antes=String(c.oldStock??'—');
      despues=`<span style="color:${col};font-weight:700">${c.newStock}</span>`;
      delta=`<span style="color:${col};font-weight:700">${up?'+':''}${c.delta}</span>`;
      actsHtml=`<button class="nov-act" onclick="doBusFromNov('${jsAttrSafe(c.cod)}')">🔍</button>`;
    } else if(c.type==='NUEVO'){
      despues=`<span style="color:var(--blue);font-weight:700">★ nuevo</span>`;
      delta=c.stock>0?`<span style="color:var(--green)">+${c.stock}</span>`:'—';
      actsHtml=`<button class="nov-act" onclick="doBusFromNov('${jsAttrSafe(c.cod)}')">🔍</button>
                <button class="nov-act" onclick="novAddToTray('${jsAttrSafe(c.cod)}')">＋Tray</button>`;
    } else if(c.type==='UBI'){
      antes=escHtml(c.oldUbi||'—');
      despues=`<span style="color:var(--cyan)">${escHtml(c.newUbi||'—')}</span>`;
      delta='⇄';
      actsHtml=`<button class="nov-act" onclick="doBusFromNov('${jsAttrSafe(c.cod)}')">🔍</button>
                <button class="nov-act" onclick="goBusUbi('${jsAttrSafe(c.newUbi)}')">📍</button>`;
    } else if(c.type==='REMOVIDO'){
      delta=`<span style="color:var(--text3)">✗</span>`;
      actsHtml=`<button class="nov-act" onclick="doBusFromNov('${jsAttrSafe(c.cod)}')">🔍</button>`;
    }

    const fecha=new Date(c.ts).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'});
    const occ=c.occurrences&&c.occurrences>1?`<span class="nov-occ">×${c.occurrences}</span>`:'—';

    return `<tr class="${unreadCls}" onclick="doBusFromNov('${jsAttrSafe(c.cod)}');markOneRead('${jsAttrSafe(c.cod)}')" style="cursor:pointer">
      <td class="nov-td nov-td-n">${rowNum}</td>
      <td class="nov-td"><span class="nov-card-ico ${tc.cls}" style="width:22px;height:22px;font-size:11px;border-radius:5px">${tc.ico}</span></td>
      <td class="nov-td nov-td-cod">${escHtml(c.cod)}</td>
      <td class="nov-td nov-td-desc" title="${escHtml(c.desc||'')}">${escHtml(c.desc||'—')}</td>
      <td class="nov-td nov-td-val">${antes}</td>
      <td class="nov-td nov-td-val">${despues}</td>
      <td class="nov-td nov-td-delta">${delta}</td>
      <td class="nov-td nov-td-occ">${occ}</td>
      <td class="nov-td nov-td-fecha">${fecha}</td>
      <td class="nov-td nov-td-acts" onclick="event.stopPropagation()">${actsHtml}</td>
    </tr>`;
  }

  // Agrupar, ordenar cada grupo por magnitud (lo más importante primero) y renderizar
  const grouped = {};
  for(const type of ORDER){
    const items = filtered.filter(c => c.type === type).sort((a,b)=>magnitude(b)-magnitude(a));
    if(items.length) grouped[type] = items;
  }

  const filterDefs = [
    { f:'TODOS',    l:`Todos (${all.length})` },
    { f:'NOLEIDOS', l:`🔵 No leídos (${unread})`,          show: unread > 0 },
    { f:'PRECIO',   l:`💰 Precios (${cntPre})`,            show: cntPre > 0 },
    { f:'COSTO',    l:`🏷 Costo (${cntCosto})`,             show: cntCosto > 0 },
    { f:'AGOTADO',  l:`⚠ Agotados (${cntAg})`,             show: cntAg > 0 },
    { f:'STOCK',    l:`📦 Stock (${cntStk})`,               show: cntStk > 0 },
    { f:'NUEVO',    l:`🆕 Nuevos (${cnt('NUEVO')})`,       show: cnt('NUEVO') > 0 },
    { f:'UBI',      l:`📍 Ubi (${cnt('UBI')})`,            show: cnt('UBI') > 0 },
    { f:'REMOVIDO', l:`🗑 Removidos (${cnt('REMOVIDO')})`, show: cnt('REMOVIDO') > 0 },
  ].filter(b => b.show !== false);

  // El buscador se reconstruye con el resto del panel en cada tecla (es
  // el mismo container.innerHTML de siempre) — sin restaurar el foco a
  // mano se perdería la posición del cursor a cada letra escrita, igual
  // que ya se cuidó en otros paneles de esta app.
  const searchHadFocus = document.activeElement && document.activeElement.id==='novSearchInput';
  const searchCaret = searchHadFocus ? document.activeElement.selectionStart : null;

  container.innerHTML = `
    <div class="nov-summary">
      <div>
        <div class="nov-summary-count">
          ${all.length} cambio${all.length !== 1 ? 's' : ''} registrado${all.length !== 1 ? 's' : ''}
          ${unread > 0 ? `<span class="tab-badge">${unread} sin leer</span>` : ''}
        </div>
        <div class="nov-summary-ts">Última actualización: ${ageStr}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${unread > 0 ? `<button class="nov-act" style="height:28px" onclick="markAllRead()">✓ Marcar leídos</button>` : ''}
        <button class="xbtn" style="font-size:9px;height:28px;padding:0 10px" onclick="exportXlsx('novedades')">📥 Excel</button>
        <button class="xbtn" style="font-size:9px;height:28px;padding:0 10px" onclick="exportPDF('novedades')">🖨 PDF</button>
        <button class="xbtn" style="font-size:9px;height:28px;padding:0 10px" onclick="clearAllChanges()">🗑 Limpiar</button>
      </div>
    </div>
    <input class="sinput" id="novSearchInput" placeholder="🔎 Buscar código o descripción dentro del radar…" value="${escHtml(_novSearch)}" oninput="setNovSearch(this.value)" style="width:100%;box-sizing:border-box;margin-bottom:10px">
    <div class="nov-filters">
      ${filterDefs.map(b => `<button class="nov-filter-btn${_novFilter===b.f?' on':''}" onclick="setNovFilter('${jsAttrSafe(b.f)}')">${b.l}</button>`).join('')}
    </div>
    ${filtered.length===0
      ? '<div class="nov-empty"><div class="nov-empty-ico">🔍</div><div class="nov-empty-txt">SIN CAMBIOS EN ESTA CATEGORÍA</div></div>'
      : `<div style="overflow-x:auto">
          <table class="nov-tbl">
            <thead><tr>
              <th class="nov-th nov-td-n">#</th>
              <th class="nov-th">TIPO</th>
              <th class="nov-th">CÓDIGO</th>
              <th class="nov-th nov-td-desc">DESCRIPCIÓN</th>
              <th class="nov-th nov-td-val">ANTES</th>
              <th class="nov-th nov-td-val">DESPUÉS</th>
              <th class="nov-th nov-td-delta">Δ</th>
              <th class="nov-th nov-td-occ">VECES</th>
              <th class="nov-th nov-td-fecha">FECHA</th>
              <th class="nov-th nov-td-acts"></th>
            </tr></thead>
            <tbody>
            ${Object.entries(grouped).map(([type,items])=>`
              <tr class="nov-group-tr">
                <td colspan="10" class="nov-group-td">
                  <span class="nov-card-ico ${TC[type].cls}" style="width:18px;height:18px;font-size:10px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;margin-right:6px">${TC[type].ico}</span>
                  ${TC[type].lbl} <span class="nov-group-count">${items.length}</span>
                </td>
              </tr>
              ${(()=>{let n=0;return items.map(c=>rowHtml(c,++n)).join('');})()}
            `).join('')}
            </tbody>
          </table>
        </div>`
    }
  `;
  if(searchHadFocus){
    const inp=document.getElementById('novSearchInput');
    if(inp){ inp.focus(); if(searchCaret!=null) inp.setSelectionRange(searchCaret,searchCaret); }
  }
}

// --- QR: robusto con polling — soporta ?ubi= (ubicación) y ?estante= (estante) ---
const _initialHref=window.location.href;
let _qrHandled=false;
let _qrGuestModalActive=false; // true mientras el modal QR se muestra sin sesión (vista rápida por snapshot)
function handleQRParam(){
  if(_qrHandled)return;
  const params=new URLSearchParams(window.location.search);
  const estante=params.get('estante');
  const ubi=params.get('ubi');
  const panorama=params.get('panorama');
  if(!estante&&!ubi&&!panorama)return;
  _qrHandled=true;

  // ── MODO PANORAMA GENERAL (nuevo) ────────────────────────────
  if(panorama){
    openPanoramaModal();
    setTimeout(()=>{
      if(CURRENT_USER){
        const tab=document.querySelector('.tab[data-tab="estantes"]');
        goTab('estantes',tab);
      }
    },50);
    const url=new URL(window.location.href);
    url.searchParams.delete('panorama');
    window.history.replaceState({},'',url.pathname+url.search+url.hash);
    return;
  }

  // ── MODO ESTANTE (nuevo) ─────────────────────────────────────
  if(estante){
    // openQRShelfModal() resuelve sus propios datos — memoria si ya hay
    // sesión, o el snapshot público de solo lectura si no la hay (p.ej.
    // iOS, que siempre abre el QR en una pestaña nueva de Safari sin
    // sesión guardada) — así que se llama de inmediato, sin esperar a que
    // cargue el inventario completo.
    openQRShelfModal(estante.toUpperCase());
    // Cambiar a la pestaña "estantes" en segundo plano, solo si hay sesión
    // activa (si no, appShell sigue oculto y no tiene sentido), para que
    // al cerrar el modal el usuario quede ahí.
    setTimeout(()=>{
      if(CURRENT_USER){
        const tab=document.querySelector('.tab[data-tab="estantes"]');
        goTab('estantes',tab);
      }
    },50);
    // Limpiar el parámetro de la URL para que recargas silenciosas no reabran el modal
    const url=new URL(window.location.href);
    url.searchParams.delete('estante');
    window.history.replaceState({},'',url.pathname+url.search+url.hash);
    return;
  }

  // ── MODO UBICACIÓN (legado) ──────────────────────────────────
  if(ubi){
    let tries=0;
    const poll=setInterval(()=>{
      tries++;
      if(UBI_TEO.length||INV.length||tries>30){
        clearInterval(poll);
        const tab=document.querySelector('.tab[data-tab="ubi"]');
        goTab('ubi',tab);
        document.getElementById('ubiQ').value=ubi;
        doUbi();
        setTimeout(()=>{
          const rows=document.querySelectorAll('#uBody tr[data-rowid="'+ubi+'"]');
          if(rows.length){rows[0].classList.add('highlight-row');rows[0].scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>rows[0].classList.add('fade'),2000);setTimeout(()=>{rows[0].classList.remove('highlight-row','fade');},2600);}
        },200);
        // Limpiar el parámetro de la URL para que recargas silenciosas no reabran/reseleccionen
        const url=new URL(window.location.href);
        url.searchParams.delete('ubi');
        window.history.replaceState({},'',url.pathname+url.search+url.hash);
      }
    },100);
  }
}

export { _initialHref, _qrGuestModalActive, _qrHandled, buildSnapshot, clearAllChanges, detectChanges, doBusFromNov, handleQRParam, loadChanges, markAllRead, markOneRead, novAddToTray, novFmtCOP, renderNovedades, saveChanges, setNovFilter, setNovSearch, updateNovBadge };
export const set__qrGuestModalActive = (v) => (_qrGuestModalActive = v);
export const set__qrHandled = (v) => (_qrHandled = v);
