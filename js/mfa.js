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
  const i = $('authMfaCode'); i.value = ''; i.focus();
}

/** Vuelve al formulario de correo/contraseña (también se llama al cerrar sesión). */
export function resetMfaChallenge() {
  _resolver = null;
  _hint = null;
  const f = $('authForm'); if (f) f.style.display = '';
  const m = $('authMfaForm'); if (m) m.style.display = 'none';
  const i = $('authMfaCode'); if (i) i.value = '';
  setMfaLoading(false);
}

export function cancelMfaChallenge() {
  resetMfaChallenge();
  clearAuthErr();
  fbAuth.signOut().catch(() => {}); // por si quedara algo a medias
}

async function doMfaChallenge() {
  clearAuthErr();
  const code = $('authMfaCode').value.trim();
  if (!sixDigits(code)) { showAuthErr('Escribe el código de 6 dígitos de la app.'); return; }
  if (!_resolver || !_hint) { resetMfaChallenge(); showAuthErr('La verificación expiró. Inicia sesión de nuevo.'); return; }
  setMfaLoading(true);
  try {
    const Totp = await loadTotp();
    await _resolver.resolveSignIn(Totp.assertionForSignIn(_hint.uid, code));
    // onAuthStateChanged (session.js) continúa y entra a la app.
  } catch (e) {
    setMfaLoading(false);
    showAuthErr(mapMfaError(e));
    const i = $('authMfaCode'); if (i) { i.value = ''; i.focus(); }
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

/** Marca el botón 🔐 del encabezado según el usuario tenga o no el factor activo. */
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
    '<div class="mfa-title" id="mfaTitle">🔐 Verificación en dos pasos</div>' +
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
      '<p class="mfa-p">Protege tu cuenta con un código de 6 dígitos que cambia cada 30 segundos, generado por <b>Google Authenticator</b> (o Microsoft Authenticator, Authy, 1Password…) en tu celular.</p>' +
      '<div class="mfa-badge off">No activada</div>' +
      '<div class="authlbl">Tu contraseña actual</div>' +
      '<input type="password" id="mfaPass" class="authinput" autocomplete="current-password" placeholder="••••••••">' +
      '<button type="button" class="authbtn" id="mfaStart"><span id="mfaStartTxt">Activar</span></button>' + MSGS);
    $('mfaStart').addEventListener('click', startEnroll);
    $('mfaPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') startEnroll(); });
    addForcedLogout();
    return;
  }
  setBody(
    '<div class="mfa-badge on">✅ Activa</div>' +
    '<p class="mfa-p">Factor: <b id="mfaFName"></b><br><span id="mfaFDate" class="mfa-muted"></span></p>' +
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
  setBody('<div class="mfa-ok on">✅ Verificación en dos pasos activada.</div>' +
    '<p class="mfa-p">Por seguridad debes iniciar sesión de nuevo; esta vez te pediremos el código de la app.</p>' +
    '<button type="button" class="authbtn" id="mfaReLogin"><span>Iniciar sesión</span></button>');
  const go = () => { _forced = false; closeMfaModal(); fbAuth.signOut(); };
  $('mfaReLogin').addEventListener('click', go);
  setTimeout(() => { if (_forced) go(); }, 6000);
}

function renderVerifyEmail(user) {
  setBody(
    '<p class="mfa-p">Para activar la verificación en dos pasos, Firebase exige que tu correo (<b id="mfaMail"></b>) esté verificado.</p>' +
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
  const key = String(secret.secretKey || '').replace(/(.{4})/g, '$1 ').trim();
  setBody(
    '<p class="mfa-p"><b>1.</b> En tu celular abre Google Authenticator → <b>＋</b> → <b>Escanear código QR</b>.</p>' +
    '<div class="mfa-qr" id="mfaQr"><span class="mfa-muted">Generando QR…</span></div>' +
    '<p class="mfa-p mfa-muted">¿No puedes escanear? Elige “Ingresar clave de configuración” y escribe esta clave (tipo: basada en tiempo):</p>' +
    '<code class="mfa-key" id="mfaSecret"></code>' +
    '<p class="mfa-p"><b>2.</b> Escribe el código de 6 dígitos que aparece en la app:</p>' +
    '<input type="text" id="mfaCode" class="authinput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">' +
    '<button type="button" class="authbtn" id="mfaConfirm"><span>Confirmar y activar</span></button>' +
    '<button type="button" class="authbtn mfa-ghost" id="mfaCancel"><span>Cancelar</span></button>' + MSGS);
  $('mfaSecret').textContent = key;
  loadQrLib().then((qrcode) => {
    const qr = qrcode(0, 'M'); qr.addData(uri); qr.make();
    const img = document.createElement('img');
    img.alt = 'Código QR para Google Authenticator';
    img.src = qr.createDataURL(5, 2);
    const box = $('mfaQr'); if (box) { box.textContent = ''; box.appendChild(img); }
  }).catch(() => {
    const box = $('mfaQr'); if (box) box.innerHTML = '<span class="mfa-muted">No se pudo generar el QR: usa la clave de abajo.</span>';
  });
  $('mfaCode').focus();
  $('mfaCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmEnroll(user, secret, Totp); });
  $('mfaConfirm').addEventListener('click', () => confirmEnroll(user, secret, Totp));
  $('mfaCancel').addEventListener('click', renderStatus);
}

async function confirmEnroll(user, secret, Totp) {
  const code = $('mfaCode').value.trim();
  if (!sixDigits(code)) { setMsg('err', 'Escribe el código de 6 dígitos de la app.'); return; }
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
  }
}
