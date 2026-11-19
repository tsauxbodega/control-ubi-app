import { ACTIVE_BODEGA, BODEGAS, INV_RAW_BY_BODEGA, set_INV_RAW_BY_BODEGA } from './config.js';
import { ESTANTES, INV, NOSTOCK_UBI, PRICES, PRICE_IDX, PRICE_TYPES, SHELF_PROFILES, SM_MAP, UBI_PERFIL_MAP, UBI_TEO, cleanNumber, normPriceKey, saveShelfProfiles, saveToStorage, set_ESTANTES, set_PRICES, set_PRICE_IDX, set_PRICE_TYPES, set_SM_MAP, set_UBI_PERFIL_MAP, set_UBI_TEO, updateProfileBadge } from './state-globals.js';
import { buildPriceIndex, normCode, prog } from './file-upload.js';
import { EXCEL_FALLBACK_BODEGA, flatRowsFromData } from './excel-parse.js';
import { parseExcelBuffer } from './excel-worker-client.js';
import { applyPriceDivisors, syncShelfSnapshots } from './precios-divisor.js';
import { loadInvFromSQL, recomputeEstantesLibres, recomputeUbiTeoOcupacion, setActiveBodega } from './inventario-sql.js';
import { updateUI } from './ui-header-tabs.js';
import { _lastExcelModified, _reloadTimer } from './autoload-excel.js';
import { syncRadarPriceCloud } from './radar-precios.js';
import { buildSnapshot, detectChanges, saveChanges } from './radar-cambios.js';
import { closeOptionsMenu } from './pwa-ui.js';
// ═══ js/excel-respaldo.js — extraído de index.html (líneas 8328–8736 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════
// MODO RESPALDO EXCEL — inventario desde el libro CONTROL_UBI_cache.xlsx
// Se activa solo cuando el servidor SQL no responde (caída del servidor
// corporativo, app desplegada fuera de la red, etc.). Convierte las hojas
// KAIZEN / Stock_Ubi / Stock_NoUbi / NoStock_Ubi al MISMO formato de fila
// plana que entrega el SQL y la pasa por processFlatInvRows(): no hay un
// segundo motor, así que todas las vistas funcionan igual.
// Limitaciones (el Excel no trae esos datos): SubGrupo3/categoría DPOK (GA
// queda en REVISAR), Stock_Min/Max/Seguridad, O/O y B/O, costo de inventario
// (el costo unitario sigue saliendo de PRECIOS_DATA) y la bodega Norte.
// ══════════════════════════════════════════════════════════════════
const MANUAL_EXCEL_KEY = 'ctrl_manual_excel';
let MANUAL_EXCEL_MODE = (()=>{ try{ return localStorage.getItem(MANUAL_EXCEL_KEY)==='1'; }catch(e){ return false; } })();
let INV_SOURCE = 'sql';            // 'sql' | 'cache' | 'excel'
let _wantExcelInv = false;         // true = el próximo processExcel debe construir inventario
let _skipRadarOnce = false;        // evita falsos "cambios" al cambiar de fuente
const FALLBACK_CACHE_MAX_H = 12;   // caché SQL más viejo que esto → se prefiere el Excel
const SQL_FETCH_TIMEOUT_MS = 20000;

// ── Aviso visible mientras la app no usa datos del SQL ───────────
function showFallbackBanner(kind, extra){
  let bar = document.getElementById('fallbackBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'fallbackBar';
    bar.style.cssText = 'background:#fff3cd;color:#664d03;border-bottom:2px solid #e0a800;padding:7px 14px;font-size:13px;line-height:1.35;display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:relative;z-index:50';
    const hdr = document.querySelector('.hdr');
    if(hdr && hdr.parentNode) hdr.parentNode.insertBefore(bar, hdr.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
  }
  let msg;
  if(kind==='excel' && MANUAL_EXCEL_MODE){
    const mod = _lastExcelModified ? ' (archivo del '+new Date(_lastExcelModified).toLocaleDateString('es-CO')+')' : '';
    msg = '📴 <b>Modo Excel activado manualmente</b> — no se consulta el SQL. Inventario del Excel'+mod+', solo sede <b>Sur</b>; sin costos de inventario, mín/máx, O/O, B/O ni categoría GA.'
        + (ACTIVE_BODEGA!==EXCEL_FALLBACK_BODEGA ? ' <b>⚠ Norte no está disponible en este modo.</b>' : '');
  } else if(kind==='excel'){
    const mod = _lastExcelModified ? ' (archivo del '+new Date(_lastExcelModified).toLocaleDateString('es-CO')+')' : '';
    msg = '📴 <b>Modo respaldo Excel</b> — el servidor SQL no responde. Inventario tomado del Excel'+mod+', solo sede <b>Sur</b>. No hay costos de inventario, mín/máx, O/O, B/O ni categoría GA; los datos pueden estar desfasados. Se reintenta SQL cada 5 min.'
        + (ACTIVE_BODEGA!==EXCEL_FALLBACK_BODEGA ? ' <b>⚠ Norte no está disponible en este modo.</b>' : '');
  } else if(kind==='cache'){
    msg = '📴 <b>Sin conexión con SQL</b> — mostrando el último inventario guardado en este dispositivo'+(extra?' ('+extra+')':'')+'. Se reintenta cada 5 min.';
  } else {
    msg = '📴 <b>Sin conexión con SQL ni con el Excel</b> — se muestran los últimos datos guardados en este dispositivo, que pueden estar desactualizados.';
  }
  bar.innerHTML = '<span style="flex:1;min-width:220px">'+msg+'</span>'
    + (MANUAL_EXCEL_MODE
        ? '<button onclick="toggleManualExcelMode()" style="background:#664d03;color:#fff;border:0;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer">Volver a SQL</button>'
        : '<button onclick="retrySQLNow(this)" style="background:#664d03;color:#fff;border:0;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer">Reintentar SQL ahora</button>');
  bar.style.display = 'flex';
}
function hideFallbackBanner(){
  const bar = document.getElementById('fallbackBar');
  if(bar) bar.style.display = 'none';
}
function updateManualExcelMenu(){
  const t=document.getElementById('optManualExcelTxt');
  if(t) t.textContent = MANUAL_EXCEL_MODE ? 'Desactivar modo Excel (volver a SQL)' : 'Activar modo Excel (sin SQL)';
}
function toggleManualExcelMode(){
  MANUAL_EXCEL_MODE = !MANUAL_EXCEL_MODE;
  try{ localStorage.setItem(MANUAL_EXCEL_KEY, MANUAL_EXCEL_MODE?'1':'0'); }catch(e){}
  updateManualExcelMenu();
  try{ closeOptionsMenu(); }catch(e){}
  if(MANUAL_EXCEL_MODE){
    _wantExcelInv = true;
    if(INV_SOURCE==='excel') showFallbackBanner('excel');   // ya estaba en respaldo: solo cambia el aviso
  } else {
    hideFallbackBanner();
  }
  clearTimeout(_reloadTimer);
  loadInvFromSQL(false);
}
function retrySQLNow(btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Reintentando…'; }
  clearTimeout(_reloadTimer);
  loadInvFromSQL(false).finally(()=>{ if(btn){ btn.disabled=false; btn.textContent='Reintentar SQL ahora'; } });
}

// Aplica un objeto de datos (de parseWorkbook, o del JSON que genera GitHub Actions) a la app.
// Es la parte que toca la pantalla y las variables globales; la lectura del Excel vive en excel-parse.js.
function applyExcelData(data, fname, isSilent = false, meta = {}) {
  try{
    prog(10);
    // ── Radar de Cambios: capturar snapshot ANTES de limpiar datos ──
    const _radSnap = INV.length ? buildSnapshot() : null;
    set_PRICES({});set_PRICE_IDX({});set_PRICE_TYPES([]);set_UBI_TEO([]);set_ESTANTES([]);
    // NOTA: con SQL, el inventario viene de processFlatInvRows()/loadInvFromSQL(); sin SQL (modo Excel) se arma
    // más abajo desde las hojas de stock. Aquí siempre se actualizan precios, ubicaciones teóricas, estantes y perfiles.
    prog(60);
    // PRICES[ref] sigue siendo el array de siempre [mostrador, accesorios, desc, costo]; los demás tipos de precio
    // quedan en row.byType. Los tipos se detectan solos del encabezado (ver parseWorkbook).
    const pts = data.priceTypes || [];
    set_PRICE_TYPES(pts.map(t=>({key:t.key, label:t.label})));
    const P = {}, IDX = {};
    for(const p of (data.prices || [])){
      const byType = {};
      pts.forEach((t,i)=>{ byType[t.key] = p[3+i]; });
      const row = [ pts[0]?(byType[pts[0].key]||0):0, pts[1]?(byType[pts[1].key]||0):0, p[1], p[2] ];
      row.byType = byType;
      P[p[0]] = row; IDX[normCode(p[0])] = row;
    }
    set_PRICES(P); set_PRICE_IDX(IDX);
    prog(78);
    set_UBI_TEO(data.ubiTeo || []);
    // ── MODO RESPALDO: construir el inventario desde las hojas del Excel ──
    if(_wantExcelInv){
      const _fb = flatRowsFromData(data);
      if(_fb.length){
        _skipRadarOnce = (INV_SOURCE!=='excel');
        set_INV_RAW_BY_BODEGA( {}); for(const id of Object.keys(BODEGAS)) INV_RAW_BY_BODEGA[id] = [];
        INV_RAW_BY_BODEGA[EXCEL_FALLBACK_BODEGA] = _fb;
        INV_SOURCE = 'excel';
        setActiveBodega(ACTIVE_BODEGA, {silent:true, skipReload:true});
        showFallbackBanner('excel');
        console.warn('[Respaldo Excel] inventario reconstruido desde el libro:', _fb.length, 'filas');
      }
    }
    // Recalcula Ocupada/Libre (y qué referencia hay en cada ubicación) contra el inventario recién cargado,
    // en vez de confiar en la fórmula de Excel.
    recomputeUbiTeoOcupacion();
    prog(88);
    set_ESTANTES(data.estantes || []);
    // Recalcula Total/Ocupadas/Libres/% Libre contra las ubicaciones teóricas recién actualizadas.
    recomputeEstantesLibres();
    prog(94);
    // --- SM (Stock Muerto) y perfiles de estantes ---
    set_SM_MAP(data.smMap || {});
    set_UBI_PERFIL_MAP(data.perfilMap || {});
    if(Object.keys(data.shelfProfiles || {}).length){ Object.assign(SHELF_PROFILES, data.shelfProfiles); saveShelfProfiles(); }
    if(data.perfilesFromFile>0 || data.perfilMap) updateProfileBadge();
    prog(100);
    buildPriceIndex();
    applyPriceDivisors(); // antes de guardar y de comparar cambios (Radar/Novedades)
    const saved=saveToStorage(INV,PRICES,UBI_TEO,ESTANTES,NOSTOCK_UBI);
    updateUI();
    // Publicar snapshots livianos de estantes (solo lectura pública) para que
    // el modal QR pueda mostrarse rápido sin sesión ni descarga completa del
    // Excel. No bloquea nada: se dispara en segundo plano y falla en silencio
    // si aún no existen las reglas de Firestore para 'estante_snapshots'.
    syncShelfSnapshots(meta.version);
    // ── Radar de Cambios: detectar y guardar cambios ──
    const _afterSnap = buildSnapshot();
    if(_radSnap && !_skipRadarOnce){
      const _changes=detectChanges(_radSnap,_afterSnap);
      if(_changes.length) saveChanges(_changes);
    }
    _skipRadarOnce=false;
    // ── Radar de PRECIOS en la nube: compara contra la última base
    //    conocida en Firestore (compartida entre dispositivos/sesiones,
    //    no solo esta pestaña — ver módulo arriba). Corre en segundo
    //    plano, no bloquea la carga.
    syncRadarPriceCloud(_afterSnap.prices);
    setTimeout(()=>{
      document.getElementById('prog').style.display='none';
      document.getElementById('progfill').style.width='0%';
      
      if(!isSilent){
        const sm=saved===true?' · Datos guardados en caché':(saved==='noprice'?' · Guardado sin precios':' · Caché no disponible');
        const pfMsg=data.perfilesFromFile>0?'\n• Perfiles estantes: '+data.perfilesFromFile+' cargados desde hoja':'';
        const smCount=Object.keys(SM_MAP).length;
        const invMsg=INV.length+' refs (sin cambios — el inventario viene de SQL)';
alert('✅ '+fname+' cargado!\n\n• Inventario: '+invMsg+'\n• Precios: '+Object.keys(PRICES).length.toLocaleString('es-CO')+' refs\n• Ubicaciones teóricas: '+UBI_TEO.length+'\n• Estantes: '+ESTANTES.length+'\n• Stock=0 con ubi: '+NOSTOCK_UBI.length+(smCount?'\n• Stock Muerto (SM): '+smCount+' refs':'')+pfMsg+sm);
      }
    },300);
    return true;
  }catch(err){
    document.getElementById('prog').style.display='none';
    alert('❌ Error al procesar: '+err.message);
    console.error(err);
    return false;
  }
}

// Lee un .xlsx (en un Web Worker si se puede: la pantalla no se congela) y lo aplica.
async function processExcel(buf, fname, isSilent = false, meta = {}) {
  try{
    prog(5);
    const data = await parseExcelBuffer(buf, {wantFlat:_wantExcelInv});
    return applyExcelData(data, fname, isSilent, meta);
  }catch(err){
    document.getElementById('prog').style.display='none';
    alert('❌ Error al procesar: '+err.message);
    console.error(err);
    return false;
  }
}

export { applyExcelData, FALLBACK_CACHE_MAX_H, INV_SOURCE, MANUAL_EXCEL_MODE, SQL_FETCH_TIMEOUT_MS, _skipRadarOnce, _wantExcelInv, hideFallbackBanner, processExcel, retrySQLNow, showFallbackBanner, toggleManualExcelMode, updateManualExcelMenu };
export const set_INV_SOURCE = (v) => (INV_SOURCE = v);
export const set__skipRadarOnce = (v) => (_skipRadarOnce = v);
export const set__wantExcelInv = (v) => (_wantExcelInv = v);
