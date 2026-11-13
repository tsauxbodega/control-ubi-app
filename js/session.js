import { ACTIVE_BODEGA, BODEGAS, BODEGA_DEFAULT, INV_RAW_BY_BODEGA, set_ACTIVE_BODEGA } from './config.js';
import { CURRENT_USER, ROLES, ROLE_LABEL, TAB_PERMISSIONS, _authResolved, cacheUserProfile, db, doLogout, fbAuth, getCachedUserProfile, setAuthBtnLoading, set_CURRENT_USER, set__authResolved, showAuthErr, showOfflineBadge } from './auth.js';
import { hydrateUserCloudData, watchSharedReloc } from './cloud-sync.js';
import { renderUsersTable } from './admin-usuarios.js';
import { setActiveBodega } from './inventario-sql.js';
import { goTab } from './ui-header-tabs.js';
import { _qrGuestModalActive } from './radar-cambios.js';
import { initAppData } from './init.js';
// ═══ js/session.js — extraído de index.html (líneas 6363–6650 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════
// TIMEOUT DE SESIÓN POR INACTIVIDAD
// ══════════════════════════════════════════════════════════════════
// Configuración: 30 min de inactividad → aviso de 2 min → cierre
// automático. El aviso permite al usuario extender la sesión con
// un clic. Se reinicia ante cualquier interacción del usuario.
//
// Los timeouts se leen de localStorage para que el admin los pueda
// ajustar sin tocar el código:
//   ctrl_idle_warn_ms  (default: 28 min)
//   ctrl_idle_out_ms   (default: 30 min)
// ══════════════════════════════════════════════════════════════════
const IDLE_WARN_DEFAULT = 28 * 60 * 1000;  // 28 min → muestra aviso
const IDLE_OUT_DEFAULT  = 30 * 60 * 1000;  // 30 min → cierra sesión

let _idleWarnTimer  = null;
let _idleOutTimer   = null;
let _idleWarnShown  = false;
const IDLE_EVENTS = ['mousemove','keydown','mousedown','touchstart','scroll','click'];

function getIdleMs(key, def){
  try{ const v=parseInt(localStorage.getItem(key)||''); return isNaN(v)||v<60000?def:v; }
  catch(e){ return def; }
}

function resetIdleTimer(){
  if(!CURRENT_USER) return;           // sin sesión no hay nada que proteger
  clearTimeout(_idleWarnTimer);
  clearTimeout(_idleOutTimer);
  if(_idleWarnShown) hideIdleWarn();

  const warnMs = getIdleMs('ctrl_idle_warn_ms', IDLE_WARN_DEFAULT);
  const outMs  = getIdleMs('ctrl_idle_out_ms',  IDLE_OUT_DEFAULT);

  _idleWarnTimer = setTimeout(showIdleWarn, warnMs);
  _idleOutTimer  = setTimeout(()=>{
    hideIdleWarn();
    doLogout();
    // Mostrar un mensaje breve antes de que el listener de auth oculte la pantalla
    setTimeout(()=>{
      const f=document.getElementById('loginForm');
      if(f) f.querySelector?.('.autherr')?.textContent
        && (document.getElementById('loginErr').textContent='');
      const err=document.getElementById('loginErr');
      if(err){ err.textContent='Sesión cerrada por inactividad.'; err.style.display='block'; }
    }, 400);
  }, outMs);
}

function stopIdleTimer(){
  clearTimeout(_idleWarnTimer);
  clearTimeout(_idleOutTimer);
  IDLE_EVENTS.forEach(ev=>document.removeEventListener(ev, resetIdleTimer, {passive:true}));
  hideIdleWarn();
}

function startIdleTimer(){
  IDLE_EVENTS.forEach(ev=>document.addEventListener(ev, resetIdleTimer, {passive:true}));
  resetIdleTimer();
}

function showIdleWarn(){
  _idleWarnShown = true;
  let el = document.getElementById('idleWarnBanner');
  if(!el){
    el = document.createElement('div');
    el.id = 'idleWarnBanner';
    el.style.cssText = [
      'position:fixed','bottom:80px','left:50%','transform:translateX(-50%)',
      'z-index:9999','background:var(--amber,#e8a020)','color:#1a1a1a',
      'border-radius:12px','padding:14px 20px','display:flex',
      'align-items:center','gap:12px','box-shadow:0 4px 24px rgba(0,0,0,.45)',
      'font-size:13px','max-width:360px','width:calc(100% - 32px)'
    ].join(';');
    document.body.appendChild(el);
  }
  const outMs  = getIdleMs('ctrl_idle_out_ms',  IDLE_OUT_DEFAULT);
  const warnMs = getIdleMs('ctrl_idle_warn_ms', IDLE_WARN_DEFAULT);
  const secsLeft = Math.round((outMs - warnMs) / 1000);
  el.innerHTML = `
    <span style="font-size:20px">⏱</span>
    <div style="flex:1">
      <div style="font-weight:700">Sesión por cerrar</div>
      <div style="font-size:11px;opacity:.85">Sin actividad detectada — la sesión se cerrará en ~${secsLeft}s</div>
    </div>
    <button onclick="resetIdleTimer()" style="background:#1a1a1a;color:#fff;border:0;border-radius:8px;padding:7px 13px;font-size:12px;cursor:pointer;white-space:nowrap;font-weight:600">
      Seguir aquí
    </button>`;
  el.style.display='flex';
}

function hideIdleWarn(){
  _idleWarnShown = false;
  const el=document.getElementById('idleWarnBanner');
  if(el) el.style.display='none';
}


// ── Listener principal de autenticación ─────────────────────────────
let _userDocUnsub = null;
let _relocUnsub = null;
function watchOwnUserDoc(){
  if(_userDocUnsub){ _userDocUnsub(); _userDocUnsub=null; }
  _userDocUnsub = db.collection('usuarios').doc(CURRENT_USER.uid).onSnapshot(snap=>{
    if(!snap.exists || !CURRENT_USER) return;
    const data = snap.data();
    if(data.activo===false){
      alert('Tu cuenta fue desactivada por un administrador.');
      fbAuth.signOut();
      return;
    }
    const newRol = ROLES.includes(data.rol) ? data.rol : 'operador';
    if(newRol !== CURRENT_USER.rol){
      CURRENT_USER.rol = newRol;
      const rEl = document.getElementById('ubadgeRole');
      rEl.textContent = ROLE_LABEL[CURRENT_USER.rol];
      rEl.className = 'ubadge-role role-'+CURRENT_USER.rol;
      applyRolePermissions();
    }
    // Si un admin cambia la sede de este usuario desde otro dispositivo
    // mientras la sesión sigue abierta aquí, se refleja sin recargar.
    const newSede = BODEGAS[Number(data.sede)] ? Number(data.sede) : BODEGA_DEFAULT;
    if(newSede !== CURRENT_USER.sede){
      CURRENT_USER.sede = newSede;
      cacheUserProfile(CURRENT_USER);
      if(INV_RAW_BY_BODEGA[newSede]) setActiveBodega(newSede);
    }
  });
}
fbAuth.onAuthStateChanged(async (user)=>{
  if(!user){
    set__authResolved(true);
    set_CURRENT_USER( null);
    stopIdleTimer();   // ← detener timer al cerrar sesión
    if(_userDocUnsub){ _userDocUnsub(); _userDocUnsub=null; }
    if(_relocUnsub){ _relocUnsub(); _relocUnsub=null; }
    // Confirmado: no hay sesión guardada. Preparamos el formulario real
    // (reemplaza el spinner "Verificando sesión…") pero si el modal QR está
    // mostrando la vista rápida de invitado, no lo tapamos con la pantalla
    // de login — se muestra solo si el usuario cierra el modal o pide
    // iniciar sesión explícitamente.
    const loading=document.getElementById('authLoading'); if(loading) loading.style.display='none';
    const card=document.getElementById('authCard'); if(card) card.style.display='block';
    if(!_qrGuestModalActive){
      document.getElementById('appShell').style.display='none';
      document.getElementById('authOverlay').style.display='flex';
    }
    setAuthBtnLoading(false);
    const f = document.getElementById('authForm'); if(f) f.reset();
    return;
  }
  // OJO: aquí todavía NO fijamos _authResolved=true — hay una sesión de
  // Firebase Auth (token) pero aún falta confirmar el documento en
  // 'usuarios' (rol, si está activo, etc). Hasta que eso no responda,
  // CURRENT_USER sigue siendo null y NO es un dato confiable todavía.
  try{
    // Atajo: si el navegador YA sabe que no hay red, no tiene sentido
    // esperar 8s a que Firestore lo confirme por las malas — se salta
    // directo al timeout para caer al modo offline (ver catch abajo) más
    // rápido. navigator.onLine puede dar falsos positivos (dice "true"
    // conectado a un wifi sin salida a internet real), por eso NO se usa
    // para saltarse el intento por completo — solo para no hacer esperar
    // de más cuando ya se sabe con certeza que no hay conexión.
    const timeoutMs = navigator.onLine===false ? 300 : 8000;
    // Timeout defensivo: si esta lectura se queda colgada (red intermitente,
    // el propio Service Worker interfiriendo, cold-start de Firestore), no
    // queremos dejar la app trabada en pantalla negra para siempre esperando
    // una promesa que quizás nunca resuelva. A los 8s, se trata como fallo
    // de red (sin forzar signOut — la sesión sigue siendo válida, solo no
    // pudimos confirmarla ahora) y se libera _authResolved para que el resto
    // de la app (p.ej. el modal QR) deje de esperar y siga su propio camino.
    const snap = await Promise.race([
      db.collection('usuarios').doc(user.uid).get(),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout-usuarios-doc')),timeoutMs))
    ]);
    if(!snap.exists){
      set__authResolved(true);
      showAuthErr('Tu cuenta no está registrada en la app. Contacta a un administrador.');
      setAuthBtnLoading(false);
      await fbAuth.signOut();
      return;
    }
    const data = snap.data();
    if(data.activo===false){
      set__authResolved(true);
      showAuthErr('Tu cuenta fue desactivada. Contacta a un administrador.');
      setAuthBtnLoading(false);
      await fbAuth.signOut();
      return;
    }
    const sedeUsr = BODEGAS[Number(data.sede)] ? Number(data.sede) : BODEGA_DEFAULT;
    set_CURRENT_USER( {uid:user.uid, email:user.email, nombre:data.nombre||user.email, rol:ROLES.includes(data.rol)?data.rol:'operador', sede:sedeUsr});
    // La sede del perfil manda al iniciar sesión: quien es de Sur entra
    // directo a Sur, sin elegir nada. Un cambio manual del selector dura
    // solo la sesión — no reescribe este valor guardado en Firestore.
    set_ACTIVE_BODEGA( sedeUsr);
    set__authResolved(true); // AHORA sí: CURRENT_USER ya quedó fijado de verdad
    cacheUserProfile(CURRENT_USER); // para poder entrar en modo offline la próxima vez
    document.getElementById('ubadgeName').textContent = CURRENT_USER.nombre;
    const rEl = document.getElementById('ubadgeRole');
    rEl.textContent = ROLE_LABEL[CURRENT_USER.rol];
    rEl.className = 'ubadge-role role-'+CURRENT_USER.rol;
    applyRolePermissions();
    document.getElementById('authOverlay').style.display='none';
    document.getElementById('appShell').style.display='block';
    setAuthBtnLoading(false);
    showOfflineBadge(false);
    watchOwnUserDoc();
    watchSharedReloc();
    startIdleTimer();  // ← inactividad
    await hydrateUserCloudData();
    initAppData();
  }catch(e){
    console.error('[Auth] No se pudo confirmar la sesión:', e && e.message || e);
    set__authResolved(true); // liberamos la espera aunque haya fallado — ver comentario arriba

    // ── MODO OFFLINE ──────────────────────────────────────────────────
    // Firebase Auth SÍ pudo confirmar localmente que hay una sesión válida
    // (por eso 'user' no es null y llegamos hasta este try/catch) — lo que
    // falló fue la LECTURA del rol en Firestore, típicamente por falta de
    // internet. Si este dispositivo ya inició sesión con éxito antes,
    // usamos ese último rol conocido en vez de dejar a la persona sin
    // poder entrar. No es un login nuevo (eso sí necesita red) — es
    // reanudar la sesión que ya tenía abierta.
    const cached=getCachedUserProfile(user.uid);
    if(cached){
      set_CURRENT_USER(cached);
      // Usuarios cacheados antes de este cambio no tienen `sede` guardada
      // — se asume Sur (comportamiento previo) hasta que vuelvan a entrar
      // con red y el perfil real de Firestore la traiga.
      set_ACTIVE_BODEGA( BODEGAS[Number(cached.sede)] ? Number(cached.sede) : BODEGA_DEFAULT);
      document.getElementById('ubadgeName').textContent=CURRENT_USER.nombre;
      const rEl=document.getElementById('ubadgeRole');
      rEl.textContent=ROLE_LABEL[CURRENT_USER.rol];
      rEl.className='ubadge-role role-'+CURRENT_USER.rol;
      applyRolePermissions();
      document.getElementById('authOverlay').style.display='none';
      document.getElementById('appShell').style.display='block';
      setAuthBtnLoading(false);
      showOfflineBadge(true);
      // watchOwnUserDoc()/watchSharedReloc() usan onSnapshot: no bloquean
      // (no se esperan con await) y el propio SDK de Firestore los deja
      // conectados solos en cuanto vuelva la red, sin que haga falta nada
      // más acá.
      watchOwnUserDoc();
      watchSharedReloc();
      startIdleTimer();  // ← inactividad
      await hydrateUserCloudData(); // cloudLoad() ya tiene su propio timeout y cae a localStorage si falla
      initAppData(); // ya lee de localStorage primero — ver loadFromStorage() dentro
      return;
    }

    // Sin caché de este usuario en este dispositivo (primer login desde
    // acá, o nunca se completó uno con éxito): no hay forma segura de
    // saber su rol/permisos sin red, así que sí hace falta iniciar sesión
    // de nuevo — no se puede evitar la primera vez.
    const loading=document.getElementById('authLoading'); if(loading) loading.style.display='none';
    const card=document.getElementById('authCard'); if(card) card.style.display='block';
    if(!_qrGuestModalActive){
      document.getElementById('appShell').style.display='none';
      document.getElementById('authOverlay').style.display='flex';
    }
    showAuthErr('No se pudo confirmar tu sesión (tiempo de espera agotado o sin conexión). Intenta iniciar sesión de nuevo.');
    setAuthBtnLoading(false);
  }
});

function applyRolePermissions(){
  if(!CURRENT_USER) return;
  const allowed = TAB_PERMISSIONS[CURRENT_USER.rol] || [];
  document.querySelectorAll('.tabbar .tab[data-tab]').forEach(tab=>{
    const id = tab.dataset.tab;
    if(id==='nostock') return; // visibilidad gestionada por lógica propia de datos
    tab.style.display = allowed.includes(id) ? '' : 'none';
  });
  const active = document.querySelector('.panel.active');
  if(active){
    const activeId = active.id.replace('panel-','');
    if(!allowed.includes(activeId)){
      const busTab = document.querySelector('.tabbar .tab[data-tab="bus"]');
      if(busTab) goTab('bus', busTab);
    }
  }
  if(CURRENT_USER.rol==='admin' && document.getElementById('panel-usuarios')?.classList.contains('active')){
    renderUsersTable();
  }
}

export { _relocUnsub, resetIdleTimer, stopIdleTimer };
export const set__relocUnsub = (v) => (_relocUnsub = v);
