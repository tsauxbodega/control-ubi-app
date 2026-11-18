/* Vigilante de arranque (script clásico, SIN imports: corre aunque el resto de la app no cargue).
 * Si la pantalla "Verificando sesión…" sigue ahí pasados ~9 s, algo del arranque quedó colgado (típico: la base local
 * de Firebase Auth en el navegador). Entonces: (1) la primera vez en esa pestaña se limpia sola la sesión local y se
 * recarga; (2) si vuelve a pasar, se muestran botones para reintentar o restablecer a mano.
 * Solo toca datos LOCALES del navegador (sesión de Firebase, service worker y cachés): nunca datos de la nube. */
(function () {
  'use strict';
  var WAIT_MS = 9000, FLAG = 'ubi_autoheal', stage = 'esperando a Firebase Auth';
  window.__bootMark = function (s) { stage = s; };

  function stuck() {
    var ov = document.getElementById('authOverlay'), ld = document.getElementById('authLoading');
    if (!ov || !ld) return false;
    return getComputedStyle(ov).display !== 'none' && getComputedStyle(ld).display !== 'none';
  }
  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(r, ms); })]); }
  function delDb(name) {
    return new Promise(function (res) {
      try { var q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = function () { res(); }; } catch (e) { res(); }
    });
  }
  function heal(deep) {
    var jobs = [];
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('firebase:') === 0) localStorage.removeItem(k); }); } catch (e) {}
    try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf('firebase:') === 0) sessionStorage.removeItem(k); }); } catch (e) {}
    jobs.push(delDb('firebaseLocalStorageDb'));
    if (deep && indexedDB.databases) jobs.push(indexedDB.databases().then(function (l) { return Promise.all(l.filter(function (d) { return /^firestore\//.test(d.name); }).map(function (d) { return delDb(d.name); })); }).catch(function () {}));
    if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }).catch(function () {}));
    if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }).catch(function () {}));
    return withTimeout(Promise.all(jobs), 4000).then(function () { location.reload(); });
  }
  function el(tag, css, txt) { var e = document.createElement(tag); e.style.cssText = css; if (txt) e.textContent = txt; return e; }
  function btn(txt, primary, fn) {
    var b = el('button', 'font:600 13px var(--sans,system-ui);padding:10px 16px;border-radius:10px;cursor:pointer;border:1px solid ' + (primary ? '#c0392b' : 'rgba(255,255,255,.25)') + ';background:' + (primary ? '#c0392b' : 'transparent') + ';color:#fff', txt);
    b.type = 'button'; b.addEventListener('click', fn); return b;
  }
  function showPanel() {
    var ld = document.getElementById('authLoading'); if (!ld || document.getElementById('bootGuardBox')) return;
    var box = el('div', 'display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:6px;max-width:300px;text-align:center'); box.id = 'bootGuardBox';
    box.appendChild(el('div', 'font:600 13px var(--sans,system-ui);color:var(--text,#fff)', 'Esto está tardando más de lo normal'));
    box.appendChild(el('div', 'font:12px var(--sans,system-ui);color:var(--text3,#aaa);line-height:1.4', 'Se quedó en: ' + stage + '. Tus datos en la nube no se tocan; solo se limpia la sesión guardada en este navegador.'));
    var row = el('div', 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:4px');
    row.appendChild(btn('Reintentar', false, function () { location.reload(); }));
    row.appendChild(btn('Restablecer sesión local', true, function () { heal(true); }));
    box.appendChild(row); ld.appendChild(box);
  }
  function check() {
    if (!stuck()) return;
    var done = false; try { done = sessionStorage.getItem(FLAG) === '1'; } catch (e) {}
    if (!done) { try { sessionStorage.setItem(FLAG, '1'); } catch (e) {} heal(false); return; }
    showPanel();
  }
  function arm() { setTimeout(check, WAIT_MS); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm); else arm();
  // Un arranque sano limpia la marca para que la próxima vez vuelva a haber un auto-arreglo.
  window.addEventListener('load', function () { setTimeout(function () { if (!stuck()) { try { sessionStorage.removeItem(FLAG); } catch (e) {} } }, WAIT_MS + 3000); });
})();
