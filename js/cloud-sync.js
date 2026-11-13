import { CURRENT_USER, _cloudSaveTimers, db } from './auth.js';
import { _relocUnsub, set__relocUnsub } from './session.js';
import { PICKLIST, PICKLIST_KEY, RELOC_KEY, RELOC_LIST, UF, set_PICKLIST, set_RELOC_LIST } from './state-globals.js';
import { doUbi, renderUbi } from './ubicaciones.js';
import { pickKeyFromItem, pickLoadLocal, renderPickUI } from './utils.js';
import { HIST_CACHE, loadHistLocal, set_HIST_CACHE } from './tema-historial.js';
import { CONTEO_KEY, CONTEO_STORE, loadConteoStoreLocal, set_CONTEO_STORE } from './conteo.js';
import { CRUCE_GUARDADOS, CRUCE_STORE_KEY, loadCrucesLocal, set_CRUCE_GUARDADOS } from './cruce-referencias.js';
// ═══ js/cloud-sync.js — extraído de index.html (líneas 6651–6755 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ═══════════════════════════════════════════════════════════════════
// SINCRONIZACIÓN EN LA NUBE — datos independientes por usuario
// (conteos, cruces, lista de picking/selección, historial de búsqueda)
// ═══════════════════════════════════════════════════════════════════
function cloudSave(key, data){
  if(!CURRENT_USER) return;
  clearTimeout(_cloudSaveTimers[key]);
  _cloudSaveTimers[key] = setTimeout(()=>{
    db.collection('usuarios').doc(CURRENT_USER.uid).collection('estado').doc(key)
      .set({data, ts:Date.now()})
      .catch(e=>console.warn('cloudSave falló:', key, e));
  }, 700);
}
async function cloudLoad(key){
  if(!CURRENT_USER) return null;
  try{
    // Sin esta carrera contra un timeout, un .get() de Firestore sin
    // conexión puede quedarse esperando al backend indefinidamente (no
    // rechaza solo porque no hay red) — y como hydrateUserCloudData()
    // espera los 4 cloudLoad() en paralelo, eso trabaría la app entera
    // en modo offline. A los 5s se trata como "no disponible" y se cae
    // al respaldo local (ver los .then/else de quien llama a esto).
    const snap = await Promise.race([
      db.collection('usuarios').doc(CURRENT_USER.uid).collection('estado').doc(key).get(),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout-cloudLoad-'+key)),5000))
    ]);
    return snap.exists ? snap.data().data : null;
  }catch(e){
    console.warn('cloudLoad falló:', key, e);
    return null;
  }
}
// Namespacing por uid para que dos usuarios en el mismo navegador nunca
// compartan caché local antes de que responda Firestore
function ukey(base){ return CURRENT_USER ? (base+'__'+CURRENT_USER.uid) : base; }

async function hydrateUserCloudData(){
  // Las 4 lecturas van en paralelo (antes eran secuenciales una tras otra,
  // lo que sumaba ~4 round-trips de red seguidos y retrasaba innecesariamente
  // todo lo que depende de terminar de autenticar, incluida la apertura
  // automática por QR de un estante/ubicación).
  const [cConteo, cCruce, cPick, cHist] = await Promise.all([
    cloudLoad('conteo'), cloudLoad('cruces'), cloudLoad('picklist'), cloudLoad('historial')
  ]);
  // CONTEO
  if(cConteo && typeof cConteo==='object'){ set_CONTEO_STORE( cConteo); try{localStorage.setItem(ukey(CONTEO_KEY),JSON.stringify(CONTEO_STORE));}catch(e){} }
  else { loadConteoStoreLocal(); if(Object.keys(CONTEO_STORE).length) cloudSave('conteo', CONTEO_STORE); }
  // CRUCES
  if(Array.isArray(cCruce)){ set_CRUCE_GUARDADOS( cCruce); try{localStorage.setItem(ukey(CRUCE_STORE_KEY),JSON.stringify(CRUCE_GUARDADOS));}catch(e){} }
  else { loadCrucesLocal(); if(CRUCE_GUARDADOS.length) cloudSave('cruces', CRUCE_GUARDADOS); }
  // PICKLIST / TRAY DE SELECCIÓN
  if(Array.isArray(cPick)){
    set_PICKLIST( new Map());
    cPick.forEach(it=>{ if(!it) return; const key=pickKeyFromItem(it); if(key) PICKLIST.set(key, it); });
    try{localStorage.setItem(ukey(PICKLIST_KEY),JSON.stringify([...PICKLIST.values()]));}catch(e){}
  } else { pickLoadLocal(); if(PICKLIST.size) cloudSave('picklist', [...PICKLIST.values()]); }
  // HISTORIAL DE BÚSQUEDA
  if(cHist && typeof cHist==='object'){ set_HIST_CACHE( cHist); try{localStorage.setItem(ukey('ctrl_hist_all'),JSON.stringify(HIST_CACHE));}catch(e){} }
  else { loadHistLocal(); if(Object.keys(HIST_CACHE).some(p=>(HIST_CACHE[p]||[]).length)) cloudSave('historial', HIST_CACHE); }
}

// ═══════════════════════════════════════════════════════════════════
// RELOC_LIST COMPARTIDO — cambios de ubicación y asignaciones de ref
// visibles para TODAS las cuentas en tiempo real (no es por usuario:
// si alguien mueve una ref, todo el equipo lo ve al instante).
// ═══════════════════════════════════════════════════════════════════
const SHARED_RELOC_DOC = 'equipo/reloc_list'; // doc compartido, mismo para todos los usuarios
let _relocSyncOk = null; // null=aún no se sabe, true=sincronizando, false=falló (revisar reglas de Firestore)
function setRelocSyncStatus(ok, err){
  _relocSyncOk = ok;
  const el = document.getElementById('relocSyncBadge');
  if(el){
    if(ok===true){ el.style.display='none'; }
    else if(ok===false){
      el.style.display='inline-flex';
      el.title = 'No se pudo sincronizar con el equipo — revisa que las reglas de Firestore incluyan "equipo/{docId}" y estén publicadas.'+(err?(' Detalle: '+err):'');
    }
  }
  if(ok===false) console.warn('⚠️ Reloc compartido sin sincronizar (revisa Firestore rules / equipo/reloc_list):', err);
}
function watchSharedReloc(){
  if(_relocUnsub){ _relocUnsub(); set__relocUnsub(null); }
  set__relocUnsub( db.doc(SHARED_RELOC_DOC).onSnapshot(snap=>{
    setRelocSyncStatus(true);
    const arr = snap.exists ? (snap.data().items||[]) : [];
    set_RELOC_LIST( new Map());
    arr.forEach(it=>{ if(!it?.cod) return; RELOC_LIST.set(it.cod+'||'+it.ubiVieja, it); });
    try{ localStorage.setItem(RELOC_KEY, JSON.stringify(arr)); }catch(e){}
    // Refrescar UI si ya está todo cargado (evita romper el primer render)
    if(typeof renderPickUI==='function' && document.getElementById('pickTrayBody')) renderPickUI();
    if(document.getElementById('uBody')){
      if(document.getElementById('ubiQ')?.value.trim()||document.getElementById('uEstante')?.value||UF!=='ALL') doUbi(); else renderUbi();
    }
  }, e=>setRelocSyncStatus(false, e?.message)));
}
let _relocSaveTimer=null;
function relocSaveCloud(){
  clearTimeout(_relocSaveTimer);
  _relocSaveTimer=setTimeout(()=>{
    db.doc(SHARED_RELOC_DOC).set({items:[...RELOC_LIST.values()], ts:Date.now(), por:CURRENT_USER?.nombre||CURRENT_USER?.email||''})
      .then(()=>setRelocSyncStatus(true))
      .catch(e=>setRelocSyncStatus(false, e?.message));
  }, 400);
}

export { cloudLoad, cloudSave, hydrateUserCloudData, relocSaveCloud, ukey, watchSharedReloc };
