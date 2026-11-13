import { stopIdleTimer } from './session.js';
import { ESTANTES, INV, UBI_TEO } from './state-globals.js';
import { handleQRParam } from './radar-cambios.js';
// ═══ js/auth.js — extraído de index.html (líneas 6193–6362 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ═══════════════════════════════════════════════════════════════════
// FIREBASE · AUTENTICACIÓN · ROLES · SESIONES POR USUARIO (NUBE)
// ═══════════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyC313LQ2gWQ9bJwBSerstpO3pYHEZRvZes",
  authDomain: "tcutoyotanys.firebaseapp.com",
  projectId: "tcutoyotanys",
  storageBucket: "tcutoyotanys.firebasestorage.app",
  messagingSenderId: "1082853811304",
  appId: "1:1082853811304:web:5bd1be73be88ea1f2a47dd"
};
firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const db = firebase.firestore();
// Persistencia offline (IndexedDB): evita relecturas completas de las
// colecciones en cada recarga/reconexión — los onSnapshot() reutilizan la
// caché local y solo piden los deltas al servidor. Reduce drásticamente el
// consumo de lecturas del plan gratuito (ver diagnóstico de cuota excedida).
db.enablePersistence({synchronizeTabs:true}).catch(err=>{
  if(err.code==='failed-precondition'){
    console.warn('[Firestore] Persistencia offline no activa: hay otra pestaña abierta sin sincronización compatible.');
  } else if(err.code==='unimplemented'){
    console.warn('[Firestore] Este navegador no soporta persistencia offline; seguirá funcionando, solo sin la caché.');
  }
});

// Roles soportados y qué pestañas puede ver cada uno.
// admin      → acceso total, incluida la gestión de usuarios
// supervisor → todo el acceso operativo, SIN gestión de usuarios
// operador   → todo excepto Diagnóstico, Exportar y Usuarios
const ROLES = ['admin','supervisor','operador'];
const ROLE_LABEL = {admin:'Admin',supervisor:'Supervisor',operador:'Operador'};
const TAB_PERMISSIONS = {
  admin:      ['bus','ubi','prec','estantes','sugerir','diagnostico','nostock','exportar','novedades','conteo','mant','usuarios','etiquetas'],
  supervisor: ['bus','ubi','prec','estantes','sugerir','diagnostico','nostock','exportar','novedades','conteo','mant','etiquetas'],
  operador:   ['bus','ubi','prec','estantes','sugerir','nostock','novedades','conteo','mant','etiquetas']
};

let CURRENT_USER = null; // {uid, email, nombre, rol}

// Última sesión confirmada con éxito contra Firestore, guardada en este
// dispositivo. Es lo que permite entrar en MODO OFFLINE: si Firebase Auth
// confirma localmente que el token de sesión es válido (funciona sin red)
// pero no se puede leer el rol desde Firestore (sin internet), se usa este
// último rol conocido en vez de bloquear el acceso — ver el catch() de
// fbAuth.onAuthStateChanged más abajo.
const USER_CACHE_KEY='ctrl_user_cache';
function cacheUserProfile(u){ try{ localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u)); }catch(e){} }
function getCachedUserProfile(uid){
  try{
    const raw=localStorage.getItem(USER_CACHE_KEY);
    if(!raw) return null;
    const u=JSON.parse(raw);
    return (u && u.uid===uid) ? u : null;
  }catch(e){ return null; }
}
function showOfflineBadge(on){
  const el=document.getElementById('offlineBadge');
  if(el) el.style.display=on?'inline-block':'none';
}

// true en cuanto fbAuth.onAuthStateChanged dispara por primera vez (con o sin
// sesión). Antes de eso, CURRENT_USER===null NO significa "no hay sesión" —
// solo significa "todavía no sabemos". El modal QR (ver openQRShelfModal)
// puede abrirse antes de que esto resuelva, así que lo usa para no mostrar
// un falso "sin conexión / sin sesión" a un usuario que sí está logueado.
let _authResolved=false;
function waitForAuthResolved(maxMs){
  return new Promise(resolve=>{
    if(_authResolved) return resolve();
    const start=Date.now();
    const iv=setInterval(()=>{
      if(_authResolved || Date.now()-start>maxMs){ clearInterval(iv); resolve(); }
    },150);
  });
}

// _authResolved===true solo confirma que CURRENT_USER ya es un dato
// confiable (ver onAuthStateChanged) — NO significa que los datos
// (ESTANTES/UBI_TEO/INV) ya llegaron: eso pasa después, vía
// hydrateUserCloudData()+initAppData(), que tardan un poco más. Si se abre
// el modal de panorama justo tras loguearse desde un QR, sin esto se veía
// "los datos aún no están cargados" y ahí se quedaba, sin reintentar.
function waitForAppData(maxMs){
  return new Promise(resolve=>{
    if(ESTANTES.length||UBI_TEO.length||INV.length) return resolve();
    const start=Date.now();
    const iv=setInterval(()=>{
      if(ESTANTES.length||UBI_TEO.length||INV.length||Date.now()-start>maxMs){
        clearInterval(iv); resolve();
      }
    },150);
  });
}

// Si la URL trae un deep-link de QR (pegatina física de estante/ubicación),
// avisar en la propia pantalla de login que, al iniciar sesión, la app va a
// abrir directo ese estante — así el paso de login no se siente como que
// "rompió" el escaneo, sino como parte esperada del flujo.
(function showQrHintOnLogin(){
  try{
    const params=new URLSearchParams(window.location.search);
    const estante=params.get('estante'), ubi=params.get('ubi'), panorama=params.get('panorama');
    if(!estante&&!ubi&&!panorama) return;
    const hint=document.getElementById('authQrHint');
    if(!hint) return;
    hint.textContent='📍 Detectamos un código QR de '+(estante?('estante '+estante.toUpperCase()):ubi?('ubicación '+ubi.toUpperCase()):'panorama general')+'. Inicia sesión y te llevamos directo ahí.';
    hint.style.display='block';
  }catch(e){}
})();

// Camino rápido del QR de estante: se intenta apenas termina de cargar el
// script, en paralelo con la resolución de sesión de Firebase Auth (no
// espera por ella) — openQRShelfModal() sabe resolver sus propios datos
// (memoria si hay sesión, snapshot público de solo lectura si no la hay).
// Se difiere con setTimeout(0) únicamente para dejar que el resto de
// variables globales declaradas más abajo en el script (ESTANTES, etc.)
// terminen de inicializarse antes de referenciarlas.
setTimeout(()=>{ try{ handleQRParam(); }catch(e){} }, 0);

let _cloudSaveTimers = {};

function canAccessTab(tabId){
  if(!CURRENT_USER) return false;
  const allowed = TAB_PERMISSIONS[CURRENT_USER.rol] || [];
  return allowed.includes(tabId);
}

// ── Login / Logout ──────────────────────────────────────────────────
function setAuthBtnLoading(loading){
  document.getElementById('authBtn').disabled = loading;
  document.getElementById('authSpin').classList.toggle('on', loading);
  document.getElementById('authBtnTxt').textContent = loading ? 'Ingresando…' : 'Iniciar sesión';
}
function showAuthErr(msg){
  const el = document.getElementById('authErr');
  el.textContent = msg;
  el.classList.add('on');
}
function clearAuthErr(){
  const el = document.getElementById('authErr');
  el.classList.remove('on'); el.textContent='';
}
function handleLoginSubmit(ev){
  ev.preventDefault();
  clearAuthErr();
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value;
  if(!email || !pass) return false;
  setAuthBtnLoading(true);
  fbAuth.signInWithEmailAndPassword(email, pass).catch(err=>{
    setAuthBtnLoading(false);
    showAuthErr(mapAuthError(err));
  });
  return false;
}
function mapAuthError(err){
  const c = err && err.code || '';
  if(c==='auth/invalid-email') return 'Correo inválido.';
  if(c==='auth/user-disabled') return 'Esta cuenta fue deshabilitada.';
  if(c==='auth/user-not-found'||c==='auth/wrong-password'||c==='auth/invalid-credential') return 'Correo o contraseña incorrectos.';
  if(c==='auth/too-many-requests') return 'Demasiados intentos. Espera unos minutos.';
  if(c==='auth/network-request-failed') return 'Sin conexión. Verifica tu internet.';
  return 'No se pudo iniciar sesión (' + (c||'error') + ').';
}
function doLogout(){
  stopIdleTimer();
  fbAuth.signOut();
}

export { CURRENT_USER, ROLES, ROLE_LABEL, TAB_PERMISSIONS, _authResolved, _cloudSaveTimers, cacheUserProfile, canAccessTab, db, doLogout, fbAuth, firebaseConfig, getCachedUserProfile, handleLoginSubmit, setAuthBtnLoading, showAuthErr, showOfflineBadge, waitForAppData, waitForAuthResolved };
export const set_CURRENT_USER = (v) => (CURRENT_USER = v);
export const set__authResolved = (v) => (_authResolved = v);
