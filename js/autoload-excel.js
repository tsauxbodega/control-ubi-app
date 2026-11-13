import { apiFetch } from './api.js';
import { INV, PRICES } from './state-globals.js';
import { loadInvFromSQL } from './inventario-sql.js';
import { INV_SOURCE, _wantExcelInv, processExcel, showFallbackBanner } from './excel-respaldo.js';
import { handleQRParam } from './radar-cambios.js';
import { closeOptionsMenu } from './pwa-ui.js';
// ═══ js/autoload-excel.js — extraído de index.html (líneas 10981–11198 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== AUTO-LOAD & FRESCURA =====================
// El Excel ya NO se baja directo de GitHub: lo sirve el Worker (autenticado) desde un repositorio privado.
const EXCEL_PATH='/api/excel';
const RELOAD_INTERVAL=5*60*1000; // comprueba cambios cada 5 min
const EXCEL_META_KEY='ctrl_ubi_excel_meta'; // persiste ETag/Last-Modified/tamaño ENTRE pestañas
let _lastExcelSize=0;
const EXCEL_MAX_STALE_H = 2;   // horas máx. sin procesar un Excel completo antes de forzar la descarga
let _lastExcelOkTs = 0;        // último momento en que un Excel se procesó con éxito
let _lastExcelETag='';        // ETag del último fetch (más fiable que content-length)
let _lastExcelModified='';    // Last-Modified como segundo método de detección
let _reloadTimer=null;
let _freshTimer=null;
let _dataTs=0;
let _lastVerifiedTs=0;        // última vez que el HEAD confirmó "sin cambios"

// Cargar metadatos persistidos del último Excel verificado. Sin esto,
// _lastExcelETag/Modified/Size vivían solo en memoria y cada pestaña NUEVA
// (p.ej. cada escaneo de un QR físico de estante, que siempre abre una
// pestaña desde cero) arrancaba sin nada contra qué comparar — así que el
// chequeo HEAD nunca podía confirmar "sin cambios" en una carga inicial y
// se forzaba la descarga completa del Excel (7+ MB) en cada apertura.
(function loadExcelMeta(){
  try{
    const raw=localStorage.getItem(EXCEL_META_KEY);
    if(!raw)return;
    const m=JSON.parse(raw);
    _lastExcelETag     = m.etag||'';
    _lastExcelOkTs     = m.okTs||0;
    _lastExcelModified = m.modified||'';
    _lastExcelSize      = m.size||0;
    _lastVerifiedTs     = m.verifiedTs||0;
  }catch(e){}
})();
function saveExcelMeta(){
  try{
    localStorage.setItem(EXCEL_META_KEY, JSON.stringify({
      etag:_lastExcelETag, modified:_lastExcelModified, size:_lastExcelSize, verifiedTs:_lastVerifiedTs, okTs:_lastExcelOkTs
    }));
  }catch(e){}
}

// --- Barra de progreso inferior (carga silenciosa) ---
function autobar(pct){
  const el=document.getElementById('autobarFill');
  if(el)el.style.width=pct+'%';
}

// --- Badge de frescura ---
function updateFreshBadge(ts){
  _dataTs=ts||_dataTs;
  const badge=document.getElementById('freshBadge');
  if(!badge||!_dataTs)return;
  const ageMin=Math.round((Date.now()-_dataTs)/60000);
  // Checkmark de verificación: si se chequeó en los últimos 6 min (dentro del ciclo de 5min)
  const recentlyVerified=_lastVerifiedTs&&(Date.now()-_lastVerifiedTs)<6*60*1000;
  let text,cls;
  if(ageMin<60){text='🟢 '+ageMin+'min'+(recentlyVerified?' ✓':'');cls='fresh';}
  else if(ageMin<240){text='🟡 '+(Math.floor(ageMin/60))+'h '+(ageMin%60)+'min'+(recentlyVerified?' ✓':'');cls='warn';}
  else{text='🔴 '+(Math.round(ageMin/60))+'h';cls='stale';}
  badge.textContent=text;
  badge.className='fbadge on '+cls;
  const verStr=_lastVerifiedTs?' · Verificado: '+new Date(_lastVerifiedTs).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}):'';
  badge.title='Última actualización: '+new Date(_dataTs).toLocaleString('es-CO')+verStr+' · Toca para forzar actualización';
}

// Toca el badge para forzar actualización inmediata — primero SQL
// (inventario), con caída automática a Excel si el servicio no responde
// (ya integrada dentro de loadInvFromSQL). Antes esto llamaba directo a
// autoLoadExcel(), que ya no toca el inventario para nada — el botón
// "actualizaba" precios/estantes pero el inventario ni se enteraba.
function forceReload(badge){
  if(badge){badge.textContent='⟳ Actualizando…';badge.style.opacity='.6';}
  clearTimeout(_reloadTimer);
  loadInvFromSQL(false).finally(()=>{if(badge){badge.style.opacity='';}});
}

// Actualiza el badge cada minuto para que el tiempo sea real
function startFreshTicker(){
  clearInterval(_freshTimer);
  _freshTimer=setInterval(()=>updateFreshBadge(null),60000);
}

// --- Auto-carga principal ---
async function autoLoadExcel(silent=false){
  // Metadatos previos: si la descarga o el procesamiento fallan, se restauran
  // para que el siguiente ciclo (5 min) vuelva a intentarlo. Antes se
  // guardaban ANTES de descargar, así que un fallo a medias dejaba la app
  // convencida de que ya tenía la versión nueva y no volvía a bajarla.
  const _prevMeta = {etag:_lastExcelETag, modified:_lastExcelModified, size:_lastExcelSize, ok:_lastExcelOkTs};
  const _restoreMeta = ()=>{ _lastExcelETag=_prevMeta.etag; _lastExcelModified=_prevMeta.modified; _lastExcelSize=_prevMeta.size; _lastExcelOkTs=_prevMeta.ok; saveExcelMeta(); };
  try{
    // 1. HEAD: detectar cambios.
    //    Antes esto SOLO corría si silent===true (el ciclo automático cada
    //    5 min); la carga inicial de cada pestaña se saltaba el chequeo y
    //    bajaba el Excel completo sí o sí. Como cada escaneo de QR físico
    //    abre una pestaña nueva desde cero, eso significaba re-descargar
    //    7+ MB en cada escaneo aunque el archivo no hubiera cambiado.
    //    Ahora corre siempre que tengamos algún metadato previo (persistido
    //    en localStorage, ver loadExcelMeta arriba) — si es la primerísima
    //    carga del dispositivo y no hay nada persistido, nos saltamos el
    //    HEAD y vamos directo a la descarga (no hay nada que comparar).
    //    Lógica AND: solo saltar si NINGÚN indicador disponible reporta cambio.
    //    Bug anterior: OR hacía que un solo indicador "igual" cancelara la descarga
    //    aunque otros indicadores dijeran "distinto".
    const hasPrevMeta = !!(_lastExcelETag || _lastExcelModified || _lastExcelSize>0);
    if(hasPrevMeta){
      try{
        const head=await apiFetch(EXCEL_PATH+'?_='+Date.now(),{method:'HEAD'});
        const etag    =head.headers.get('etag')||'';
        const modified=head.headers.get('last-modified')||'';
        const size    =parseInt(head.headers.get('content-length')||'0');

        // Un indicador "disponible" = el servidor LO envía Y ya teníamos valor previo
        const etagAvail = !!(etag && _lastExcelETag);
        const modAvail  = !!(modified && _lastExcelModified);
        const sizeAvail = !!(size>0 && _lastExcelSize>0);

        const etagSame = etagAvail && etag     === _lastExcelETag;
        const modSame  = modAvail  && modified === _lastExcelModified;
        const sizeSame = sizeAvail && size     === _lastExcelSize;

        // Hay cambio si cualquier indicador disponible lo detecta
        const anyChanged = (etagAvail&&!etagSame)||(modAvail&&!modSame)||(sizeAvail&&!sizeSame);
        // Sin cambio confirmado: al menos un indicador disponible, ninguno reporta
        // diff, Y ya tenemos inventario cargado en memoria (INV.length) como red
        // de seguridad — si los metadatos sobrevivieron pero el inventario real no,
        // igual forzamos la descarga en vez de dejar la app sin datos.
        // PRICES.length se suma a la red de seguridad: si los metadatos de un
        // usuario anterior en el mismo navegador hacen que el HEAD diga "sin cambios"
        // pero PRICES está vacío (sesión nueva, otro usuario), forzar la descarga.
        const confirmedUnchanged = (etagAvail||modAvail||sizeAvail) && !anyChanged
                                   && INV.length>0 && Object.keys(PRICES).length>0
                                   && !(_wantExcelInv && INV_SOURCE!=='excel')
                                   // Red de seguridad: si hace más de EXCEL_MAX_STALE_H horas que no se
                                   // procesa un Excel completo, se vuelve a bajar aunque el HEAD diga igual.
                                   && _lastExcelOkTs>0 && (Date.now()-_lastExcelOkTs) < EXCEL_MAX_STALE_H*3600000;

        if(confirmedUnchanged){
          // Registrar que se verificó y actualizar badge para mostrar ✓
          _lastVerifiedTs=Date.now();
          saveExcelMeta();
          updateFreshBadge(null);
          // Como no pasamos por processExcel esta vez, hay que atender el QR
          // aquí mismo con los datos que ya están en memoria/caché local —
          // si no, un escaneo con "datos sin cambios" no abriría el modal.
          handleQRParam();
          scheduleReload();
          return;
        }
        // Hubo cambio (o no hay indicadores) → actualizar referencias y descargar
        if(etag)     _lastExcelETag     = etag;
        if(modified) _lastExcelModified = modified;
        if(size>0)   _lastExcelSize     = size;
      }catch(_){}
      // Si el HEAD lanzó error → caemos al GET completo (comportamiento correcto)
    }

    // 2. Descarga completa con cache-busting
    if(!silent){autobar(15);}
    const resp=await apiFetch(EXCEL_PATH+'?v='+Date.now());
    if(!resp.ok)throw new Error('HTTP '+resp.status);

    // Guardar headers del GET para el siguiente ciclo silent
    // Usamos content-length del GET (no buf.byteLength) para que sea comparable al HEAD
    const etag    =resp.headers.get('etag')||'';
    const modified=resp.headers.get('last-modified')||'';
    const cl      =parseInt(resp.headers.get('content-length')||'0');
    if(etag)     _lastExcelETag     = etag;
    if(modified) _lastExcelModified = modified;

    if(!silent){autobar(50);}
    const buf=await resp.arrayBuffer();
    // Preferir content-length del header (comparable con HEAD); si no viene, usar byteLength
    _lastExcelSize = cl>0 ? cl : buf.byteLength;
    if(!silent){autobar(80);}
    _lastVerifiedTs=Date.now();
    const _okExcel = processExcel(buf,'CONTROL_UBI_AUTO', true);
    if(_okExcel){ _lastExcelOkTs=Date.now(); saveExcelMeta(); }
    else { _restoreMeta(); console.warn('[Excel] no se pudo procesar; se reintentará en el próximo ciclo'); }
    if(!silent){setTimeout(()=>autobar(0),600);}

    // 3. Manejar parámetro QR después de que los datos estén listos
    handleQRParam();

  }catch(err){
    autobar(0);
    _restoreMeta();
    console.warn('autoLoadExcel:',err.message);
    if(!silent){
      if(_wantExcelInv && INV_SOURCE!=='excel' && INV.length) showFallbackBanner('offline');
      if(!INV.length){
        document.getElementById('hstattext').textContent='Servidor no disponible · usa 📤 Cargar Excel';
      }
    }
  }
  scheduleReload();
}

function scheduleReload(){
  clearTimeout(_reloadTimer);
  _reloadTimer=setTimeout(()=>loadInvFromSQL(true),RELOAD_INTERVAL); // refresco silencioso desde SQL
}

// Descarga el Excel desde GitHub forzando la comparación de metadatos.
// Distinto al botón "↑ CARGAR EXCEL" del header que abre el selector de
// archivo local: este baja directamente del repositorio sin intervención
// del usuario, exactamente igual a la autocarga inicial pero sin silencio.
function forceLoadExcelFromGitHub(){
  closeOptionsMenu();
  // Limpiar metadatos cached para que confirmedUnchanged no cortocircuite
  // la descarga aunque el archivo no haya cambiado desde la última vez.
  _lastExcelETag      = '';
  _lastExcelModified  = '';
  _lastExcelSize      = 0;
  saveExcelMeta();
  autoLoadExcel(false); // silent=false → barra de progreso visible
}

export { _lastExcelModified, _reloadTimer, autoLoadExcel, autobar, forceLoadExcelFromGitHub, forceReload, scheduleReload, startFreshTicker, updateFreshBadge };
