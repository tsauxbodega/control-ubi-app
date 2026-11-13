import { ACTIVE_BODEGA, bodegaName } from './config.js';
import { CURRENT_USER, canAccessTab } from './auth.js';
import { updateManualExcelMenu } from './excel-respaldo.js';
import { escHtml } from './utils.js';
import { _initialHref, _qrHandled, handleQRParam, set__qrHandled } from './radar-cambios.js';
// ═══ js/pwa-ui.js — extraído de index.html (líneas 18568–19071 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  PWA — Progressive Web App                                              ║
// ║                                                                          ║
// ║  Estrategia de un solo archivo:                                          ║
// ║  • Manifest → Blob URL generado en runtime (sin archivo externo)         ║
// ║    Chrome/Android lo acepta para el install prompt.                      ║
// ║  • Apple meta tags → "Agregar a inicio" en iOS con icono + standalone.   ║
// ║  • Icono → SVG inline codificado en data URI (vector, sin PNG externos). ║
// ║  • Service Worker → intenta registrar ./sw.js; si no existe (Netlify     ║
// ║    sin el archivo), falla silenciosamente. El botón "Descargar sw.js"    ║
// ║    genera el archivo listo para subir junto al HTML.                     ║
// ║  • beforeinstallprompt → botón "Instalar" en header (Chrome/Android).   ║
// ║  • iOS → toast de instrucciones la primera vez (sin beforeinstallprompt).║
// ╚══════════════════════════════════════════════════════════════════════════╝

// El Service Worker ahora es un archivo real del proyecto: ./sw.js (antes se generaba desde un texto en este script).

// ── Helpers ───────────────────────────────────────────────────────────────
function _isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function _isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

// ── Evento guardado del install prompt (Chrome/Android) ───────────────────
let _pwaInstallPrompt = null;

// ── Inicialización principal ───────────────────────────────────────────────
// ── Tabbar fade indicator ─────────────────────────────────────────────────
// Muestra u oculta el fade derecho según si el tabbar tiene más contenido.
// En desktop con tabs visibles el fade desaparece; en móvil permanece
// hasta que el usuario llega al final del scroll.
function initTabbarFade(){
  const tabbar = document.getElementById('tabbar');
  const wrap   = document.getElementById('tabbarWrap');
  if(!tabbar || !wrap) return;

  function update(){
    const atEnd = tabbar.scrollLeft + tabbar.clientWidth >= tabbar.scrollWidth - 4;
    wrap.classList.toggle('no-overflow', atEnd);
    wrap.classList.toggle('at-start', tabbar.scrollLeft <= 4);
  }

  tabbar.addEventListener('scroll', update, {passive:true});
  window.addEventListener('resize', update, {passive:true});

  // PC: el mouse solo emite scroll vertical (deltaY). Sin esto, el tabbar
  // con overflow-x:auto es inalcanzable en desktop (no hay scrollbar visible
  // -scrollbar-width:none- ni gesto táctil). Lo convertimos a scroll horizontal.
  tabbar.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // ya es horizontal (trackpad/shift)
    e.preventDefault();
    tabbar.scrollLeft += e.deltaY;
  }, {passive:false});

  update(); // estado inicial
}
// ── Navegación fija: alto del header, auto-ocultar en móvil, pestañas ─────
function centerActiveTab(){
  const bar=document.getElementById('tabbar');
  const t=bar&&bar.querySelector('.tab.active');
  if(!t||bar.scrollWidth<=bar.clientWidth)return;
  bar.scrollTo({left:t.offsetLeft-(bar.clientWidth-t.offsetWidth)/2,behavior:'smooth'});
}
(function initStickyNav(){
  const hdr=document.querySelector('.hdr');
  const bar=document.getElementById('tabbar');
  if(!hdr||!bar)return;
  const root=document.documentElement;
  const setH=()=>{const h=hdr.offsetHeight;if(h>0)root.style.setProperty('--hdr-h',h+'px');};
  setH();
  if(window.ResizeObserver)new ResizeObserver(setH).observe(hdr);
  window.addEventListener('resize',setH,{passive:true});

  // Al tocar una pestaña se arranca desde arriba del contenido (no en la mitad de otra vista)
  bar.addEventListener('click',e=>{
    const t=e.target.closest('.tab[data-tab]');
    if(!t||t.dataset.tab==='mant')return;
    window.scrollTo({top:0,behavior:'auto'});
    document.body.classList.remove('nav-hidden');
  });

  // Auto-ocultar (solo ≤820px): baja → esconde; sube → muestra
  const mq=window.matchMedia('(max-width:820px)');
  let lastY=window.scrollY,lastH=window.innerHeight,acc=0,ticking=false;
  const show=()=>document.body.classList.remove('nav-hidden');
  const hide=()=>document.body.classList.add('nav-hidden');
  function onScroll(){
    ticking=false;
    const y=window.scrollY;
    if(!mq.matches){show();lastY=y;return;}
    if(window.innerHeight!==lastH){lastH=window.innerHeight;lastY=y;acc=0;return;} // teclado / barra del navegador
    const menu=document.getElementById('optionsMenu');
    if(y<90||(menu&&menu.classList.contains('open')||menu&&menu.classList.contains('on'))){show();lastY=y;acc=0;return;}
    if(y<0||y+window.innerHeight>=document.documentElement.scrollHeight-2){lastY=y;return;} // rebote iOS
    const d=y-lastY;lastY=y;
    if(d*acc<0)acc=0;
    acc+=d;
    if(acc>14)hide();else if(acc<-8)show();
  }
  window.addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(onScroll);}},{passive:true});
  mq.addEventListener&&mq.addEventListener('change',show);
})();

// ── Scroll-to-top button ─────────────────────────────────────────────────
// (vivía por accidente adentro de initTabbarFade() — funcionaba igual
// porque es una IIFE que corre apenas se ejecuta, pero quedaba enterrada
// dentro de una función que no tiene nada que ver, lo cual es engañoso al
// leer/mantener el código. Se separa como su propio bloque.)
(function(){
  const btn=document.getElementById('scrollTopBtn');
  if(!btn)return;
  window.addEventListener('scroll',function(){
    const half=(document.documentElement.scrollHeight-window.innerHeight)/2;
    btn.classList.toggle('visible', window.scrollY>half);
  },{passive:true});
})();

function initPWA() {

  // 0. Launch Handler (Chromium/Android): si el navegador reutiliza esta
  // misma ventana para un nuevo escaneo de QR (en vez de abrir una pestaña
  // nueva), aquí se recibe la URL nueva y se procesa in-place — sin repetir
  // login ni recarga de datos. En navegadores sin soporte, este bloque
  // simplemente no hace nada (no rompe nada, no se ejecuta).
  if('launchQueue' in window){
    try{
      window.launchQueue.setConsumer(launchParams=>{
        if(!launchParams||!launchParams.targetURL) return;
        if(launchParams.targetURL===_initialHref) return; // eco del primer arranque, ya se manejó
        try{
          const url=new URL(launchParams.targetURL);
          const estante=url.searchParams.get('estante');
          const ubi=url.searchParams.get('ubi');
          if(!estante&&!ubi) return;
          window.history.replaceState({},'',url.pathname+url.search+url.hash);
          set__qrHandled(false); // permite procesar este nuevo escaneo aunque uno anterior ya se haya atendido
          handleQRParam();
        }catch(e){}
      });
    }catch(e){}
  }

  // 2. Manifest: ahora se sirve como archivo estático manifest.json (ver
  // <link rel="manifest" href="manifest.json"> en el <head>), YA NO como
  // Blob URL generado aquí en runtime.
  //
  // Por qué importa: en Android, para que una PWA quede "instalada" de
  // verdad (WebAPK completo, no un simple acceso directo), el servicio de
  // Google que empaqueta el WebAPK necesita poder DESCARGAR el manifest.json
  // desde sus propios servidores. Una blob: URL solo existe en la memoria
  // de esta pestaña — Google no puede alcanzarla — así que la instalación
  // se degradaba silenciosamente a un modo "atajo" liviano sin WebAPK real.
  // Y sin WebAPK real, `launch_handler:{client_mode:'navigate-existing'}`
  // (ver arriba, sección 0 — Launch Handler) NO se respeta: cada nuevo
  // escaneo de QR sigue abriendo una pestaña/instancia nueva del navegador
  // en vez de reutilizar la ventana de la app ya abierta. Esta es la causa
  // real reportada — no solo un supuesto, se confirma por cómo funciona el
  // proceso de minting de WebAPK de Chrome/Android.
  //
  // IMPORTANTE — para que esto tenga efecto:
  //  1. manifest.json debe subirse al hosting junto al HTML (misma carpeta).
  //  2. Los usuarios deben DESINSTALAR el ícono actual de "Agregar a
  //     pantalla de inicio" y volver a instalarlo — el WebAPK se genera al
  //     momento de instalar, no se actualiza solo para instalaciones viejas.
  //  3. Esto es exclusivo de Android/Chrome. En iOS, Safari no implementa
  //     la Launch Handler API en absoluto — ahí cada escaneo de QR SIEMPRE
  //     abrirá una pestaña nueva de Safari, sin importar el manifest. No
  //     hay forma de evitar esto con tecnología web estándar en iPhone.

  // 1. Icono — Badge TCU (Toyota Control UBI). Ya no se genera aquí en
  // runtime: es un PNG real (icon-192.png / icon-512.png) referenciado
  // directo tanto en <link rel="apple-touch-icon"> (ver <head>) como en
  // manifest.json. Motivo: iOS Safari no acepta SVG de forma confiable
  // para apple-touch-icon, y en Android un ícono SVG-only en el manifiesto
  // es causa documentada de que la instalación de WebAPK falle y caiga a
  // modo "acceso directo" en vez de instalarse como app real. Igual de
  // importante: un href inyectado por JS después del parseo inicial del
  // HTML corre el mismo riesgo de timing que tuvimos con el manifest
  // Blob URL — mejor que estas dos referencias vivan como HTML estático
  // desde el primer byte de la página.

  // manifest ya no se genera aquí — se sirve estático como manifest.json (ver <head>)

  // 3. beforeinstallprompt — Android/Chrome: mostrar botón "Instalar"
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _pwaInstallPrompt = e;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.classList.add('visible');
  });

  // Cuando se instala → ocultar botón
  window.addEventListener('appinstalled', () => {
    _pwaInstallPrompt = null;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.classList.remove('visible');
  });

  // 4. iOS: hint de "Compartir → Agregar a pantalla de inicio" (1 sola vez)
  if (_isIOS() && !_isStandalone() && !sessionStorage.getItem('pwa-hint-shown')) {
    sessionStorage.setItem('pwa-hint-shown', '1');
    setTimeout(_showIOSHint, 4000); // esperar a que el usuario se oriente
  }

  // 5. Service Worker — intentar registrar ./sw.js (falla silenciosamente
  //    si el archivo no existe; no afecta nada en la app)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => {
        console.info('[PWA] Service Worker activo. Scope:', reg.scope);
        // Ofrecer descarga de sw.js solo si el registro de SW falló antes
        // (es decir, ahora acaba de instalarse con éxito por primera vez)
      })
      .catch(() => {
        // sw.js no disponible — la app funciona normalmente sin él.
        // Para habilitar el modo offline: descarga sw.js con downloadSW()
        // y súbelo junto al HTML en Netlify.
        console.info('[PWA] sw.js no encontrado — modo offline no disponible.');
      });
  }
}

// ── Trigger del install prompt (botón header) ──────────────────────────────
function pwaTriggerInstall() {
  if (_pwaInstallPrompt) {
    _pwaInstallPrompt.prompt();
    _pwaInstallPrompt.userChoice.then(choice => {
      _pwaInstallPrompt = null;
      if (choice.outcome === 'accepted') {
        const btn = document.getElementById('pwaInstallBtn');
        if (btn) btn.classList.remove('visible');
      }
    });
  }
}

// ── iOS hint toast ─────────────────────────────────────────────────────────
function _showIOSHint() {
  let toast = document.getElementById('pwaToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pwaToast';
    toast.innerHTML = '📲 Para instalar como app:<br>toca <strong>Compartir</strong> → <strong>Agregar a pantalla de inicio</strong>';
    toast.onclick   = () => toast.classList.remove('show');
    document.body.appendChild(toast);
  }
  requestAnimationFrame(() => {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 6000);
  });
}

// ── Descarga sw.js (para Netlify u otro hosting estático) ─────────────────
// Llamar desde consola: downloadSW()  — o conectar a un botón si se quiere.
// Menú "⚙️ Opciones" del header: agrupa Excel, combinaciones, equipo y
// acciones de la app en un solo lugar. Las secciones de combinaciones/
// equipo se ocultan solas si el rol del usuario no tiene acceso, para no
// mostrar un ítem que al tocarlo no haría nada.
function toggleOptionsMenu(){
  try{ updateManualExcelMenu(); }catch(e){}
  const m = document.getElementById('optionsMenu');
  if(!m) return;
  const willOpen = !m.classList.contains('on');
  if(willOpen){
    const canMant = typeof canAccessTab==='function' && canAccessTab('mant');
    const canUsuarios = typeof canAccessTab==='function' && canAccessTab('usuarios');
    const mantBtn = document.getElementById('optMenuMant');
    if(mantBtn) mantBtn.style.display = canMant ? '' : 'none';
    const eqSec = document.getElementById('optMenuEquipoSection');
    if(eqSec) eqSec.style.display = canUsuarios ? '' : 'none';
    const adminSec = document.getElementById('optMenuAdminSection');
    if(adminSec) adminSec.style.display = (CURRENT_USER && CURRENT_USER.rol==='admin') ? '' : 'none';

    // En móvil: mover el menú al body para que su z-index:9000 sea efectivo
    // en el stacking context raíz y no quede atrapado dentro de .hdr (z-index:200).
    // Sin esto el backdrop (z-index:8999 en body) tapa el sheet y bloquea los taps.
    if(window.innerWidth <= 640){
      if(m.parentElement !== document.body){
        // Guardar referencia al contenedor original para poder recolocarlo al salir
        m._originalParent = m.parentElement;
        document.body.appendChild(m);
      }
      // Header de usuario (solo se crea una vez)
      if(!document.getElementById('optMenuUserHdr') && CURRENT_USER){
        const uHdr = document.createElement('div');
        uHdr.id = 'optMenuUserHdr';
        uHdr.style.cssText = 'padding:14px 16px 10px;border-bottom:1px solid var(--border2);display:flex;align-items:center;gap:12px;flex-shrink:0';
        const initial = (CURRENT_USER.nombre||CURRENT_USER.email||'?')[0].toUpperCase();
        uHdr.innerHTML = `
          <div style="width:38px;height:38px;border-radius:50%;background:var(--red);color:#fff;
                      display:flex;align-items:center;justify-content:center;font-weight:700;
                      font-size:16px;flex-shrink:0">${initial}</div>
          <div style="min-width:0;flex:1">
            <div style="font-weight:600;font-size:13px;color:var(--text);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${escHtml(CURRENT_USER.nombre||CURRENT_USER.email||'Usuario')}</div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--text3);
                        letter-spacing:.1em;text-transform:uppercase;margin-top:1px">
              ${CURRENT_USER.rol||''} · ${bodegaName(ACTIVE_BODEGA)}</div>
          </div>
          <button onclick="closeOptionsMenu();doLogout()"
                  style="background:var(--red2);border:1px solid rgba(192,57,43,.3);
                         color:var(--red);border-radius:8px;padding:6px 10px;cursor:pointer;
                         font-size:11px;white-space:nowrap;flex-shrink:0">
            ⏻ Salir</button>`;
        m.insertBefore(uHdr, m.firstChild);
      }
      // Tema toggle en el sheet (solo se crea una vez)
      if(!document.getElementById('optMenuThemeRow')){
        const thRow = document.createElement('div');
        thRow.id = 'optMenuThemeRow';
        thRow.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--border2);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0';
        thRow.innerHTML = `
          <span style="font-size:12px;color:var(--text2)">🌙 Tema oscuro / claro</span>
          <button onclick="toggleTheme()" style="background:var(--bg3);border:1px solid var(--border2);
                  border-radius:8px;padding:6px 12px;cursor:pointer;font-size:11px;color:var(--text2)">
            Cambiar</button>`;
        // Insertarlo después del header de usuario
        const uHdr = document.getElementById('optMenuUserHdr');
        if(uHdr) uHdr.insertAdjacentElement('afterend', thRow);
        else m.insertBefore(thRow, m.firstChild);
      }
      // Backdrop
      let bd = document.getElementById('optMenuBackdrop');
      if(!bd){
        bd = document.createElement('div');
        bd.id = 'optMenuBackdrop';
        bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:8999;';
        bd.onclick = closeOptionsMenu;
        document.body.appendChild(bd);
      }
      bd.style.display = 'block';
    }
  }
  m.classList.toggle('on', willOpen);
  if(!willOpen) _closeOptBackdrop();
  if(willOpen) fitOptionsMenu();
}
// Ajusta la altura máxima del menú al espacio que realmente queda bajo el
// botón (el header puede tener 1 o 2 filas según el ancho). En móvil el menú
// es un bottom sheet con su propio límite en CSS, ahí no se toca.
function fitOptionsMenu(){
  const m = document.getElementById('optionsMenu');
  if(!m || !m.classList.contains('on')) return;
  if(window.innerWidth <= 640){ m.style.maxHeight=''; return; }
  const top = m.getBoundingClientRect().top;
  const vh  = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  m.style.maxHeight = Math.max(160, Math.floor(vh - top - 12)) + 'px';
}
window.addEventListener('resize', fitOptionsMenu);
function _closeOptBackdrop(){
  const bd = document.getElementById('optMenuBackdrop');
  if(bd) bd.style.display = 'none';
}
function closeOptionsMenu(){
  const m = document.getElementById('optionsMenu');
  if(!m) return;
  m.classList.remove('on');
  // Si el menú fue movido al body (móvil), devolverlo a su lugar original
  // para que el layout de escritorio siga funcionando correctamente.
  if(m._originalParent && m.parentElement === document.body){
    m._originalParent.appendChild(m);
    delete m._originalParent;
  }
  _closeOptBackdrop();
}
document.addEventListener('click', e=>{
  const wrap = document.getElementById('optionsMenuWrap');
  if(wrap && !wrap.contains(e.target) && e.target.id !== 'optMenuBackdrop') closeOptionsMenu();
});

// Fuerza que este dispositivo deje de usar el Service Worker/caché viejos y
// vuelva a registrar desde cero — soluciona el caso de "en el celular se ve
// una versión vieja" sin tener que enseñarle a cada quien a borrar datos de
// sitio en el navegador. Botón "🔄 Actualizar app" en el header.
async function forceAppUpdate(btn){
  if(btn){ btn.disabled=true; btn.textContent='⟳ Actualizando…'; }
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if(window.caches){
      const keys = await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(e){
    console.warn('[Actualizar app] No se pudo limpiar por completo, recargando de todas formas:', e);
  }
  location.reload();
}

function downloadSW() {
  const url  = 'sw.js'; // archivo real del proyecto
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'sw.js';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  console.info('[PWA] sw.js descargado — súbelo junto al HTML en Netlify para activar modo offline.');
}

export { centerActiveTab, closeOptionsMenu, downloadSW, forceAppUpdate, initPWA, initTabbarFade, pwaTriggerInstall, toggleOptionsMenu };
