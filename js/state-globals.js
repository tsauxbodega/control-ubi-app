import { pricesRawForStorage } from './precios-divisor.js';
import { updateBinCounter } from './sugerir.js';
// ═══ js/state-globals.js — extraído de index.html (líneas 6891–7065 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== FUNCIÓN LIMPIEZA NUMÉRICA =====================
function cleanNumber(v){
  if(v===null||v===undefined||v==='')return 0;
  if(typeof v==='number')return v;
  let s=String(v).replace(/[^0-9.,\-]/g,'').trim();
  if(!s)return 0;
  const hasComma=s.includes(','),hasDot=s.includes('.');
  if(hasComma&&hasDot){const lc=s.lastIndexOf(','),ld=s.lastIndexOf('.');if(lc>ld){s=s.replace(/\./g,'').replace(',','.');}else{s=s.replace(/,/g,'');}}
  else if(hasComma){if(/,\d{3}$/.test(s)&&s.indexOf(',')===s.lastIndexOf(','))s=s.replace(',','');else s=s.replace(',','.');}
  else if(hasDot){const wd=s.replace('.','');if(/\.\d{3}$/.test(s)&&parseFloat(wd)>=1000)s=s.replace('.','')}
  const n=parseFloat(s);return isNaN(n)?0:n;
}

// ===================== DATA =====================
let INV=[],PRICES={},PRICE_IDX={},UBI_TEO=[],ESTANTES=[],NOSTOCK_UBI=[];
// Tipos de precio detectados dinámicamente de la hoja PRECIOS_DATA del
// Excel: [{key, label}]. Hoy típicamente son 2 (Mostrador/Accesorios),
// pero la hoja se va a ampliar con más columnas de precio — en vez de
// tener el número de tipos "quemado" en el código, se detectan solos del
// encabezado de la hoja en cada carga (ver processExcel). Todo lo que ya
// existía (Reporte, Radar, Precios, exportaciones) sigue funcionando
// igual porque PRICES[cod] se sigue llenando como el array de siempre
// [mostrador, accesorios, desc, costo] — los tipos adicionales quedan
// disponibles aparte en PRICES[cod].byType para el selector nuevo.
let PRICE_TYPES=[];
function normPriceKey(label){
  return String(label||'').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'precio';
}
let SM_MAP={}; // Stock Muerto: { codigo: {desc, ubi, stock, ult_compra, ult_vt} }
let KAIZEN_EXT={}; // { cod: {meses:[m1..m6], oo:n, bo:n, mad:n} } — para cálculo MAX-MAX
let UBI2_MAP={};  // { cod: ubi2 } — segunda ubicación cuando KAIZEN tiene "UBI1 UBI2" en la celda

// ===================== GLOBALS =====================
let BM='PAR',PM='PAR',UF='ALL';
let busRes=[],precRes=[],uRes=[],nsRes=[];
let PREC_CURRENT=null;   // {cod,desc} del único resultado mostrado en la tarjeta de Precios — lo usa el botón "Ver imágenes" de esa tarjeta
let busP=1,precP=1,uP=1,nsP=1;
let busSC=-1,busAsc=true,precSC=-1,precAsc=true,uSC=-1,uAsc=true,nsSC=-1,nsAsc=true;
const PG=50;
let _dupUbisCache=null;
let INV_IDX=new Map();
let navHistory=[];
let _navigatingBack=false; // guard: evita que goTab re-empuje al historial durante goBack
let diagABC='ALL'; // fijo en 'ALL': se quitó el selector de clase ABC del Diagnóstico
let _diagSinTeo=[]; // ubicaciones del SQL ausentes en UBITEORICAS (para Diagnóstico)

const PICKLIST_KEY='ctrl_ubi_picklist_v1';
const PICK_MAX_ITEMS = 150;         // máximo de ítems en la lista
const PICK_MAX_BYTES = 100*1024;    // 100 KB tope de almacenamiento
const PICK_MAX_AGE_MS = 30*24*60*60*1000; // purgar ítems de más de 30 días
let PICKLIST=new Map();
let PICK_TRAY_OPEN=false;

// Cambios de ubicación
const RELOC_KEY='ctrl_ubi_reloc_v1';
let RELOC_LIST=new Map(); // key=cod+'||'+ubiVieja → {cod,desc,ubiVieja,ubiNueva,stock,ts}
let _relocTarget=null;   // ref activa en el modal de cambio (modo individual)
let _relocBulkCods=null; // array de códigos en modo lote, o null si es individual
function hasPendingReloc(cod,ubi){return RELOC_LIST.has(cod+'||'+(ubi||'Sin Ubicacion'));}
function pendingRelocBadge(cod,ubi){return hasPendingReloc(cod,ubi)?'<span style="font-family:var(--mono);font-size:8px;font-weight:700;color:var(--cyan);background:rgba(34,212,212,.12);border:1px solid rgba(34,212,212,.3);border-radius:3px;padding:1px 5px;margin-left:4px;vertical-align:middle" title="Ya tiene un cambio de ubicación pendiente en la lista">🔀 PEND</span>':'';}
// Retorna {out:[...], in:[...]} — cambios pendientes que afectan una ubicación concreta
function getUbiPendingChanges(ubi){
  if(!RELOC_LIST.size||!ubi)return null;
  const u=ubi.toUpperCase();
  const out=[],inn=[];
  for(const it of RELOC_LIST.values()){
    if((it.ubiVieja||'').toUpperCase()===u) out.push(it);
    if((it.ubiNueva||'').toUpperCase()===u) inn.push(it);
  }
  return(out.length||inn.length)?{out,in:inn}:null;
}
// QR grid selection
let QR_SEL_MODE=false;
const QR_SELECTED=new Set();

// ===================== SUGERIR GLOBALS =====================
let SHELF_PROFILES={};
const SHELF_PROFILES_KEY='ctrl_ubi_shelf_profiles';
let sugSelSize='';
let sugSelABC='';
let sugSelBin=''; // CODIGO_SUGERENCIA del Excel: XS-C, XS-L, S-L, M-E, M-L, L-B, L-A, XL-E, IRR, VC, XXL
let UBI_PERFIL_MAP={}; // {ubicacion: {cat,dim,tipo_bin,abc,rot,zona,altura,codigo}}
let pendingSuggestRef=null;
let cfgGrpTam=new Set();
let cfgGrpABC=new Set();
let cfgIndTam=new Set();
let cfgIndABC=new Set();

// ===================== STORAGE =====================
const STORE_KEY='ctrl_ubi_data';

function saveToStorage(inv,prices,ubi,estantes,nostock){
  prices=pricesRawForStorage(prices); // con divisores activos, guardar el original (nunca el ya dividido)
  // INV NO se guarda aquí: viene del SQL y siempre se recarga al abrir.
  // Guardarlo duplicaría el storage (ya está en INV_RAW_BY_BODEGA vía
  // saveBodegaCache) y sería la causa de que en móvil la cuota se agote y
  // se pierdan los PRECIOS, que son los que sí hay que preservar.
  // Orden de prioridad si la cuota se agota: prices > ubi > estantes > nostock.
  try{
    const d={prices,ubi,estantes,nostock,perfilMap:UBI_PERFIL_MAP,smMap:SM_MAP,kaizenExt:KAIZEN_EXT,ubi2map:UBI2_MAP,ts:Date.now()};
    localStorage.setItem(STORE_KEY,JSON.stringify(d));return true;
  }catch(e){
    // Cuota excedida: intentar sin los mapas derivados (se reconstruyen de SQL/Excel)
    try{
      const d={prices,ubi,estantes,nostock,smMap:SM_MAP,ts:Date.now()};
      localStorage.setItem(STORE_KEY,JSON.stringify(d));return 'partial';
    }catch(e2){
      // Último recurso: solo precios y ubicaciones teóricas
      try{
        localStorage.setItem(STORE_KEY,JSON.stringify({prices,ubi,ts:Date.now()}));
        return 'minimo';
      }catch(e3){ return false; }
    }
  }
}
function loadFromStorage(){
  try{const raw=localStorage.getItem(STORE_KEY);if(!raw)return null;return JSON.parse(raw);}catch(e){return null;}
}

// ===================== SHELF PROFILES STORAGE =====================
function saveShelfProfiles(){
  try{localStorage.setItem(SHELF_PROFILES_KEY,JSON.stringify(SHELF_PROFILES));}catch(e){}
}
function loadShelfProfiles(){
  try{const r=localStorage.getItem(SHELF_PROFILES_KEY);return r?JSON.parse(r):{};} catch(e){return{};}
}
function getShelfProfile(ubicacion){
  if(!ubicacion)return null;
  const u=ubicacion.toUpperCase();
  if(SHELF_PROFILES[u])return SHELF_PROFILES[u];
  // Cascade: 4→3→2→1 char prefix
  for(let len=Math.min(u.length,5);len>=1;len--){
    const k='_p_'+u.slice(0,len);
    if(SHELF_PROFILES[k])return SHELF_PROFILES[k];
  }
  return null;
}
let _estSortRef=null,_estSortLen=-1,_estSortCache=null;
function getEstantesSorted(){
  if(_estSortRef!==ESTANTES||_estSortLen!==ESTANTES.length){
    _estSortCache=ESTANTES.slice().sort((a,b)=>b[0].length-a[0].length);
    _estSortRef=ESTANTES;_estSortLen=ESTANTES.length;
  }
  return _estSortCache;
}
function getEstanteForLocation(loc){
  if(!loc||!ESTANTES.length)return null;
  return getEstantesSorted().find(e=>loc.toUpperCase().startsWith(e[0].toUpperCase()))||null;
}
function updateProfileBadge(){
  const mapCount=Object.keys(UBI_PERFIL_MAP).length;
  const legacyCount=Object.keys(SHELF_PROFILES).length;
  const badge=document.getElementById('profileBadge');
  if(!badge)return;
  if(mapCount>0){
    badge.textContent='✓ '+mapCount+' ubi. · Modo Preciso activo';
    badge.className='profbadge';
    badge.style.background='rgba(77,171,100,.15)';
    badge.style.color='var(--green)';
    badge.style.borderColor='rgba(77,171,100,.3)';
  } else if(legacyCount>0){
    badge.textContent=legacyCount+' perfil'+(legacyCount>1?'es':'');
    badge.className='profbadge';
    badge.style.background='';badge.style.color='';badge.style.borderColor='';
  } else {
    badge.textContent='Sin datos — carga el Excel';
    badge.className='profbadge empty';
    badge.style.background='';badge.style.color='';badge.style.borderColor='';
  }
  // Also update the bin counter display
  updateBinCounter();
}

export { BM, ESTANTES, INV, INV_IDX, KAIZEN_EXT, NOSTOCK_UBI, PG, PICKLIST, PICKLIST_KEY, PICK_MAX_AGE_MS, PICK_MAX_BYTES, PICK_MAX_ITEMS, PICK_TRAY_OPEN, PM, PREC_CURRENT, PRICES, PRICE_IDX, PRICE_TYPES, QR_SELECTED, QR_SEL_MODE, RELOC_KEY, RELOC_LIST, SHELF_PROFILES, SM_MAP, UBI2_MAP, UBI_PERFIL_MAP, UBI_TEO, UF, _diagSinTeo, _dupUbisCache, _navigatingBack, _relocBulkCods, _relocTarget, busAsc, busP, busRes, busSC, cfgGrpABC, cfgGrpTam, cfgIndABC, cfgIndTam, cleanNumber, diagABC, getEstanteForLocation, getShelfProfile, getUbiPendingChanges, hasPendingReloc, loadFromStorage, loadShelfProfiles, navHistory, normPriceKey, nsAsc, nsP, nsRes, nsSC, pendingRelocBadge, pendingSuggestRef, precAsc, precP, precRes, precSC, saveShelfProfiles, saveToStorage, sugSelABC, sugSelBin, sugSelSize, uAsc, uP, uRes, uSC, updateProfileBadge };
export const set_BM = (v) => (BM = v);
export const set_ESTANTES = (v) => (ESTANTES = v);
export const set_INV = (v) => (INV = v);
export const set_INV_IDX = (v) => (INV_IDX = v);
export const set_KAIZEN_EXT = (v) => (KAIZEN_EXT = v);
export const set_NOSTOCK_UBI = (v) => (NOSTOCK_UBI = v);
export const set_PICKLIST = (v) => (PICKLIST = v);
export const set_PICK_TRAY_OPEN = (v) => (PICK_TRAY_OPEN = v);
export const set_PM = (v) => (PM = v);
export const set_PREC_CURRENT = (v) => (PREC_CURRENT = v);
export const set_PRICES = (v) => (PRICES = v);
export const set_PRICE_IDX = (v) => (PRICE_IDX = v);
export const set_PRICE_TYPES = (v) => (PRICE_TYPES = v);
export const set_QR_SEL_MODE = (v) => (QR_SEL_MODE = v);
export const set_RELOC_LIST = (v) => (RELOC_LIST = v);
export const set_SHELF_PROFILES = (v) => (SHELF_PROFILES = v);
export const set_SM_MAP = (v) => (SM_MAP = v);
export const set_UBI2_MAP = (v) => (UBI2_MAP = v);
export const set_UBI_PERFIL_MAP = (v) => (UBI_PERFIL_MAP = v);
export const set_UBI_TEO = (v) => (UBI_TEO = v);
export const set_UF = (v) => (UF = v);
export const set__diagSinTeo = (v) => (_diagSinTeo = v);
export const set__dupUbisCache = (v) => (_dupUbisCache = v);
export const set__navigatingBack = (v) => (_navigatingBack = v);
export const set__relocBulkCods = (v) => (_relocBulkCods = v);
export const set__relocTarget = (v) => (_relocTarget = v);
export const set_busAsc = (v) => (busAsc = v);
export const set_busP = (v) => (busP = v);
export const set_busRes = (v) => (busRes = v);
export const set_busSC = (v) => (busSC = v);
export const set_nsAsc = (v) => (nsAsc = v);
export const set_nsP = (v) => (nsP = v);
export const set_nsRes = (v) => (nsRes = v);
export const set_nsSC = (v) => (nsSC = v);
export const set_pendingSuggestRef = (v) => (pendingSuggestRef = v);
export const set_precAsc = (v) => (precAsc = v);
export const set_precP = (v) => (precP = v);
export const set_precRes = (v) => (precRes = v);
export const set_precSC = (v) => (precSC = v);
export const set_sugSelABC = (v) => (sugSelABC = v);
export const set_sugSelBin = (v) => (sugSelBin = v);
export const set_sugSelSize = (v) => (sugSelSize = v);
export const set_uAsc = (v) => (uAsc = v);
export const set_uP = (v) => (uP = v);
export const set_uRes = (v) => (uRes = v);
export const set_uSC = (v) => (uSC = v);
