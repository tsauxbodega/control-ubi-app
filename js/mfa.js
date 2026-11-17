// ═══ js/mfa.js — Verificación en dos pasos (TOTP · Google Authenticator) sobre Firebase Auth ═══
// La app usa el SDK "compat" de Firebase (10.13.2), que NO incluye TOTP. Solo esa pieza se carga del SDK
// modular oficial (misma versión, mismo CDN) con import() dinámico: el resto del login no cambia, y como
// nada se importa al arrancar, la app sigue abriendo sin conexión.
//   · El compat ya expone user.multiFactor y el resolver de error (err.resolver) con el mismo motor interno,
//     por eso las aserciones TOTP del SDK modular se pasan tal cual a enroll() / resolveSignIn().
//   · Requisito en Firebase: Authentication con Identity Platform + TOTP activado (ver docs/SEGURIDAD.md).
import { clearAuthErr, fbAuth, setAuthBtnLoading, showAuthErr } from './auth.js';

const FIREBASE_VERSION = '10.13.2'; // mantener IGUAL a las etiquetas script firebase-*-compat de index.html
const ESM_AUTH_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`;
const MFA_ISSUER = 'Toyota Control UBI';
const FACTOR_NAME = 'Google Authenticator';

const $ = (id) => document.getElementById(id);

// ── Carga perezosa de las piezas externas ───────────────────────────
let _totpPromise = null;
function loadTotp() {
  if (!_totpPromise) {
    _totpPromise = import(ESM_AUTH_URL)
      .then((m) => m.TotpMultiFactorGenerator)
      .catch(() => {
        _totpPromise = null;
        throw Object.assign(new Error('sdk'), { code: 'mfa/sdk-load' });
      });
  }
  return _totpPromise;
}
function loadQrLib() {
  // vendor/qrcode.js (local, lo carga index.html): sin CDN.
  return window.qrcode ? Promise.resolve(window.qrcode) : Promise.reject(new Error('qr'));
}

function mapMfaError(err) {
  const c = (err && err.code) || '';
  switch (c) {
    case 'auth/invalid-verification-code': return 'Código incorrecto. Revisa que la hora de tu celular esté en automático e inténtalo de nuevo.';
    case 'auth/code-expired': return 'El código venció. Escribe el código nuevo que muestra la app.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Contraseña incorrecta.';
    case 'auth/too-many-requests': return 'Demasiados intentos. Espera unos minutos.';
    case 'auth/network-request-failed': return 'Sin conexión. Verifica tu internet.';
    case 'auth/unverified-email': return 'Debes verificar tu correo antes de activar la verificación en dos pasos.';
    case 'auth/requires-recent-login': return 'Por seguridad, cierra sesión, vuelve a entrar e inténtalo de nuevo.';
    case 'auth/operation-not-allowed': return 'La verificación en dos pasos (TOTP) no está habilitada en el proyecto de Firebase. Avisa a un administrador.';
    case 'auth/second-factor-already-in-use': return 'Esa cuenta ya tiene este segundo factor activado.';
    case 'mfa/sdk-load': return 'No se pudo cargar el componente de verificación. Revisa tu conexión e inténtalo de nuevo.';
    default: return 'No se pudo completar la operación (' + (c || (err && err.message) || 'error') + ').';
  }
}

const sixDigits = (v) => /^\d{6}$/.test(String(v || '').trim());

// ── Piezas visuales reutilizables ───────────────────────────────────
const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>';
const ICON_CHECK = '<svg class="mfa-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg>';

/** Campo de código de 6 casillas: un <input> real (transparente, recibe teclado, pegado y autocompletado) sobre 6 casillas que lo reflejan. */
function otpHtml(id) {
  return '<div class="otp"><div class="otp-cells" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b><b></b></div>' +
    '<input type="text" id="' + id + '" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" aria-label="Código de 6 dígitos"></div>';
}
function bindOtp(input, onComplete) {
  if (!input || input._otp) return;
  input._otp = true;
  const wrap = input.closest('.otp');
  const cells = Array.from(wrap.querySelectorAll('.otp-cells b'));
  const paint = () => {
    const v = input.value, focused = document.activeElement === input;
    cells.forEach((c, i) => {
      c.textContent = v[i] || '';
      c.classList.toggle('fill', !!v[i]);
      c.classList.toggle('on', focused && i === Math.min(v.length, cells.length - 1));
    });
  };
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value !== d) input.value = d;
    wrap.classList.remove('err');
    paint();
    if (d.length === 6 && onComplete) onComplete();   // al completar el 6.º dígito se envía solo
  });
  ['focus', 'blur', 'keyup', 'click'].forEach((e) => input.addEventListener(e, paint));
  wrap.addEventListener('click', () => input.focus());
  input._paint = paint;
  paint();
}
function setOtp(input, v) { if (!input) return; input.value = v; if (input._paint) input._paint(); }
function failOtp(input) {
  const wrap = input && input.closest('.otp'); if (!wrap) return;
  wrap.classList.add('err', 'shake');
  setTimeout(() => wrap.classList.remove('shake'), 450);
}

// ═══════════════════════════════════════════════════════════════════
// 1) LOGIN: segundo paso cuando la cuenta ya tiene el factor activado
// ═══════════════════════════════════════════════════════════════════
let _resolver = null;
let _hint = null;

function setMfaLoading(on) {
  const b = $('authMfaBtn'); if (b) b.disabled = on;
  const sp = $('authMfaSpin'); if (sp) sp.classList.toggle('on', on);
  const t = $('authMfaBtnTxt'); if (t) t.textContent = on ? 'Verificando…' : 'Verificar';
}

/** Se llama desde auth.js cuando signInWithEmailAndPassword responde auth/multi-factor-auth-required. */
export function startMfaChallenge(err) {
  setAuthBtnLoading(false);
  const resolver = err && err.resolver;
  const hint = resolver && (resolver.hints || []).find((h) => h.factorId === 'totp');
  if (!hint) {
    showAuthErr('Tu cuenta usa un segundo factor que esta app no soporta. Contacta a un administrador.');
    return;
  }
  _resolver = resolver;
  _hint = hint;
  clearAuthErr();
  $('authForm').style.display = 'none';
  $('authMfaForm').style.display = 'block';
  const i = $('authMfaCode'); setOtp(i, ''); i.focus();
}

/** Vuelve al formulario de correo/contraseña (también se llama al cerrar sesión). */
export function resetMfaChallenge() {
  _resolver = null;
  _hint = null;
  const f = $('authForm'); if (f) f.style.display = '';
  const m = $('authMfaForm'); if (m) m.style.display = 'none';
  setOtp($('authMfaCode'), '');
  setMfaLoading(false);
}

export function cancelMfaChallenge() {
  resetMfaChallenge();
  clearAuthErr();
  fbAuth.signOut().catch(() => {}); // por si quedara algo a medias
}

async function doMfaChallenge() {
  const btn = $('authMfaBtn'); if (btn && btn.disabled) return;   // ya hay una verificación en curso
  clearAuthErr();
  const code = $('authMfaCode').value.trim();
  if (!sixDigits(code)) { showAuthErr('Escribe el código de 6 dígitos de la app.'); failOtp($('authMfaCode')); return; }
  if (!_resolver || !_hint) { resetMfaChallenge(); showAuthErr('La verificación expiró. Inicia sesión de nuevo.'); return; }
  setMfaLoading(true);
  try {
    const Totp = await loadTotp();
    await _resolver.resolveSignIn(Totp.assertionForSignIn(_hint.uid, code));
    // onAuthStateChanged (session.js) continúa y entra a la app.
  } catch (e) {
    setMfaLoading(false);
    showAuthErr(mapMfaError(e));
    const i = $('authMfaCode'); if (i) { setOtp(i, ''); failOtp(i); i.focus(); }
  }
}
export function submitMfaChallenge(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  doMfaChallenge();
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// 2) INSCRIPCIÓN / ESTADO: ventana "Verificación en dos pasos"
// ═══════════════════════════════════════════════════════════════════
const enrolledTotp = (user) => ((user && user.multiFactor && user.multiFactor.enrolledFactors) || []).filter((f) => f.factorId === 'totp');
/** ¿La cuenta ya tiene Google Authenticator (TOTP) activado? */
export const userHasTotp = (user) => enrolledTotp(user).length > 0;

// Modo obligatorio: la ventana no se puede cerrar y al terminar se vuelve a iniciar sesión.
let _forced = false;

/** Marca el botón del escudo en el encabezado según el usuario tenga o no el factor activo. */
export function refreshMfaBadge() {
  try {
    const btn = $('mfaBtn'); if (!btn) return;
    const on = enrolledTotp(fbAuth.currentUser).length > 0;
    btn.classList.toggle('on', on);
    btn.title = on ? 'Verificación en dos pasos: ACTIVA' : 'Verificación en dos pasos: no activada';
  } catch (e) { /* sin multiFactor (p. ej. sesión sin conexión): se ignora */ }
}

function ensureModal() {
  let bg = $('mfaModalBg');
  if (bg) return bg;
  bg = document.createElement('div');
  bg.id = 'mfaModalBg';
  bg.className = 'mfa-bg';
  bg.innerHTML =
    '<div class="mfa-card" role="dialog" aria-modal="true" aria-labelledby="mfaTitle">' +
    '<button type="button" class="mfa-x" id="mfaClose" aria-label="Cerrar">✕</button>' +
    '<div class="mfa-title" id="mfaTitle"><span class="mfa-title-ico">' + ICON_SHIELD + '</span>Verificación en dos pasos</div>' +
    '<div id="mfaBody"></div></div>';
  document.body.appendChild(bg);
  bg.addEventListener('click', (e) => { if (e.target === bg && !_forced) closeMfaModal(); });
  $('mfaClose').addEventListener('click', () => { if (!_forced) closeMfaModal(); });
  return bg;
}
export function closeMfaModal() {
  const bg = $('mfaModalBg'); if (bg) bg.classList.remove('on');
  refreshMfaBadge();
}

/** Bloquea la app hasta que el usuario active el segundo factor (lo llama session.js). */
export function enforceMfaEnrollment(user) {
  _forced = true;
  const bg = ensureModal();
  bg.classList.add('on', 'forced');
  renderStatus();
}
export function openMfaModal() {
  if (!fbAuth.currentUser) return;
  ensureModal().classList.add('on');
  renderStatus();
}

function setBody(html) { $('mfaBody').innerHTML = html; }
function setMsg(kind, text) {
  const e = $('mfaErr'), o = $('mfaOk');
  if (e) { e.classList.remove('on'); e.textContent = ''; }
  if (o) { o.classList.remove('on'); o.textContent = ''; }
  const t = kind === 'ok' ? o : e;
  if (t && text) { t.textContent = text; t.classList.add('on'); }
}
function busy(on, btnId) {
  const b = $(btnId); if (b) b.disabled = on;
  document.querySelectorAll('#mfaBody input').forEach((i) => { i.disabled = on; });
}
const MSGS = '<div class="autherr" id="mfaErr"></div><div class="mfa-ok" id="mfaOk"></div>';

async function reauth(user, pass) {
  const cred = firebase.auth.EmailAuthProvider.credential(user.email, pass);
  await user.reauthenticateWithCredential(cred);
}

function renderStatus() {
  const user = fbAuth.currentUser;
  const f = enrolledTotp(user)[0];
  if (!f) {
    setBody(
      (_forced ? '<div class="mfa-force"><b>La verificación en dos pasos es obligatoria.</b> Actívala para poder usar la app.</div>' : '') +
      '<div class="mfa-hero"><div class="mfa-hero-ico">' + ICON_SHIELD + '</div>' +
      '<div class="mfa-hero-t">Protege tu cuenta</div>' +
      '<div class="mfa-hero-s">Un código de 6 dígitos que cambia cada 30 segundos, generado en tu celular por <b>Google Authenticator</b> (o Microsoft Authenticator, Authy, 1Password…).</div></div>' +
      '<ol class="mfa-how"><li><span>Instala <b>Google Authenticator</b> en tu celular</span></li><li><span>Escanea el QR que te mostraremos</span></li><li><span>Escribe el primer código y listo</span></li></ol>' +
      '<div class="authlbl">Tu contraseña actual</div>' +
      '<input type="password" id="mfaPass" class="authinput" autocomplete="current-password" placeholder="••••••••">' +
      '<button type="button" class="authbtn" id="mfaStart"><span id="mfaStartTxt">Activar verificación</span></button>' + MSGS);
    $('mfaStart').addEventListener('click', startEnroll);
    $('mfaPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') startEnroll(); });
    addForcedLogout();
    return;
  }
  setBody(
    '<div class="mfa-hero ok"><div class="mfa-hero-ico">' + ICON_SHIELD + '</div>' +
    '<div class="mfa-hero-t">Cuenta protegida</div>' +
    '<div class="mfa-hero-s">Factor: <b id="mfaFName"></b><br><span id="mfaFDate" class="mfa-muted"></span></div></div>' +
    '<p class="mfa-p mfa-muted">La verificación en dos pasos es obligatoria en esta app y no se puede desactivar. Si cambiaste de celular o perdiste el acceso, pide a un administrador que la restablezca.</p>' + MSGS);
  $('mfaFName').textContent = f.displayName || FACTOR_NAME;
  $('mfaFDate').textContent = f.enrollmentTime ? 'Activada el ' + new Date(f.enrollmentTime).toLocaleDateString() : '';
}

function addForcedLogout() {
  if (!_forced) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'authbtn mfa-ghost'; b.id = 'mfaForcedOut';
  b.innerHTML = '<span>Cerrar sesión</span>';
  b.addEventListener('click', () => { _forced = false; closeMfaModal(); fbAuth.signOut(); });
  $('mfaBody').appendChild(b);
}

/** Tras activar el factor en modo obligatorio: volver a entrar con el código (así el token trae el segundo factor). */
function finishForcedEnrollment() {
  setBody('<div class="mfa-done">' + ICON_CHECK +
    '<div class="mfa-hero-t">¡Verificación activada!</div>' +
    '<div class="mfa-hero-s">Por seguridad debes iniciar sesión de nuevo; esta vez te pediremos el código de la app.</div></div>' +
    '<button type="button" class="authbtn" id="mfaReLogin"><span>Iniciar sesión</span></button>' +
    '<div class="mfa-count" aria-hidden="true"><i></i></div>');
  const go = () => { _forced = false; closeMfaModal(); fbAuth.signOut(); };
  $('mfaReLogin').addEventListener('click', go);
  setTimeout(() => { if (_forced) go(); }, 6000);
}

function renderVerifyEmail(user) {
  setBody(
    '<div class="mfa-hero"><div class="mfa-hero-ico">' + ICON_SHIELD + '</div>' +
    '<div class="mfa-hero-t">Verifica tu correo</div>' +
    '<div class="mfa-hero-s">Para activar la verificación en dos pasos, Firebase exige que tu correo (<b id="mfaMail"></b>) esté verificado.</div></div>' +
    '<button type="button" class="authbtn" id="mfaSendMail"><span>Enviarme el correo de verificación</span></button>' +
    '<button type="button" class="authbtn mfa-ghost" id="mfaMailDone"><span>Ya lo verifiqué</span></button>' + MSGS);
  $('mfaMail').textContent = user.email;
  $('mfaSendMail').addEventListener('click', async () => {
    busy(true, 'mfaSendMail');
    try { await user.sendEmailVerification(); setMsg('ok', 'Listo: revisa tu bandeja (y el spam) y abre el enlace.'); }
    catch (e) { setMsg('err', mapMfaError(e)); }
    busy(false, 'mfaSendMail');
  });
  $('mfaMailDone').addEventListener('click', renderStatus);
  addForcedLogout();
}

async function startEnroll() {
  const user = fbAuth.currentUser;
  const pass = $('mfaPass').value;
  if (!pass) { setMsg('err', 'Escribe tu contraseña actual.'); return; }
  busy(true, 'mfaStart'); setMsg('err', '');
  try {
    await user.reload();
    if (!user.emailVerified) { renderVerifyEmail(user); return; }
    await reauth(user, pass);
    const Totp = await loadTotp();
    const session = await user.multiFactor.getSession();
    const secret = await Totp.generateSecret(session);
    renderEnrollStep(user, secret, Totp);
  } catch (e) {
    if ($('mfaStart')) { busy(false, 'mfaStart'); setMsg('err', mapMfaError(e)); }
  }
}

function renderEnrollStep(user, secret, Totp) {
  const uri = secret.generateQrCodeUrl(user.email, MFA_ISSUER);
  const rawKey = String(secret.secretKey || '');
  const key = rawKey.replace(/(.{4})/g, '$1 ').trim();
  setBody(
    '<div class="mfa-step"><span class="mfa-n">1</span><div class="mfa-step-b">' +
      '<div class="mfa-step-t">Escanea el QR</div>' +
      '<div class="mfa-step-s">En Google Authenticator toca <b>＋</b> y luego <b>Escanear código QR</b>.</div>' +
      '<div class="mfa-qrbox"><div class="mfa-qr" id="mfaQr"><span class="mfa-muted">Generando QR…</span></div></div>' +
      '<details class="mfa-manual"><summary>¿No puedes escanear?</summary>' +
        '<p class="mfa-step-s">Elige “Ingresar clave de configuración” y escribe esta clave (tipo: basada en tiempo):</p>' +
        '<div class="mfa-keyrow"><code class="mfa-key" id="mfaSecret"></code><button type="button" class="mfa-copy" id="mfaCopy">Copiar</button></div>' +
      '</details>' +
    '</div></div>' +
    '<div class="mfa-step"><span class="mfa-n">2</span><div class="mfa-step-b">' +
      '<div class="mfa-step-t">Escribe el código</div>' +
      '<div class="mfa-step-s">Son 6 dígitos y cambian cada 30 segundos.</div>' +
      otpHtml('mfaCode') +
    '</div></div>' +
    '<button type="button" class="authbtn" id="mfaConfirm"><span>Confirmar y activar</span></button>' +
    '<button type="button" class="authbtn mfa-ghost" id="mfaCancel"><span>Cancelar</span></button>' + MSGS);
  $('mfaSecret').textContent = key;
  $('mfaCopy').addEventListener('click', async () => {
    const b = $('mfaCopy');
    try { await navigator.clipboard.writeText(rawKey); b.textContent = 'Copiado ✓'; b.classList.add('done'); }
    catch (e) { b.textContent = 'Selecciónala y copia'; }
    setTimeout(() => { if ($('mfaCopy')) { b.textContent = 'Copiar'; b.classList.remove('done'); } }, 1800);
  });
  loadQrLib().then((qrcode) => {
    const qr = qrcode(0, 'M'); qr.addData(uri); qr.make();
    const img = document.createElement('img');
    img.alt = 'Código QR para Google Authenticator';
    img.src = qr.createDataURL(6, 0);
    const box = $('mfaQr'); if (box) { box.textContent = ''; box.appendChild(img); }
  }).catch(() => {
    const box = $('mfaQr'); if (box) box.innerHTML = '<span class="mfa-muted">No se pudo generar el QR: usa la clave de abajo.</span>';
    const d = document.querySelector('.mfa-manual'); if (d) d.open = true;
  });
  const input = $('mfaCode');
  bindOtp(input, () => confirmEnroll(user, secret, Totp));   // se confirma solo al escribir el 6.º dígito
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmEnroll(user, secret, Totp); });
  $('mfaConfirm').addEventListener('click', () => confirmEnroll(user, secret, Totp));
  $('mfaCancel').addEventListener('click', renderStatus);
}

async function confirmEnroll(user, secret, Totp) {
  const btn = $('mfaConfirm'); if (!btn || btn.disabled) return;   // ya se está confirmando
  const code = $('mfaCode').value.trim();
  if (!sixDigits(code)) { setMsg('err', 'Escribe el código de 6 dígitos de la app.'); failOtp($('mfaCode')); return; }
  busy(true, 'mfaConfirm'); setMsg('err', '');
  try {
    await user.multiFactor.enroll(Totp.assertionForEnrollment(secret, code), FACTOR_NAME);
    refreshMfaBadge();
    if (_forced) { finishForcedEnrollment(); return; }
    renderStatus();
    setMsg('ok', 'Verificación en dos pasos activada. Desde ahora, al iniciar sesión te pediremos el código.');
  } catch (e) {
    busy(false, 'mfaConfirm');
    setMsg('err', mapMfaError(e));
    const i = $('mfaCode'); if (i) { setOtp(i, ''); failOtp(i); i.focus(); }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3) Detalles del formulario de acceso (se enlazan al cargar la página)
// ═══════════════════════════════════════════════════════════════════
function initAuthUi() {
  bindOtp($('authMfaCode'), () => doMfaChallenge());      // paso del código: casillas + envío automático
  const t = $('authPassToggle'), p = $('authPass');        // ojo para ver/ocultar la contraseña
  if (t && p) t.addEventListener('click', () => {
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    t.classList.toggle('on', show);
    t.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    p.focus();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuthUi);
else initAuthUi();
