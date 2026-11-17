// Verificación de ID tokens de Firebase + rol desde Firestore. Sin dependencias (WebCrypto de Workers).
// Los "secretos" NO viven aquí: el token hacia el ERP va en variables/secretos del Worker (ver README).

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const dec = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));

let jwks = { keys: null, exp: 0 };
export async function googleKeys(fetchFn = fetch) {
  if (jwks.keys && Date.now() < jwks.exp) return jwks.keys;
  const r = await fetchFn(JWKS_URL);
  if (!r.ok) throw new Error('No se pudieron obtener las llaves de Google');
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  jwks = { keys: (await r.json()).keys, exp: Date.now() + (m ? Number(m[1]) : 3600) * 1000 };
  return jwks.keys;
}

/** Devuelve el payload del token ({sub: uid, email, ...}) o lanza Error. */
export async function verifyIdToken(token, { projectId, keys, now = Math.floor(Date.now() / 1000) }) {
  const p = String(token || '').split('.');
  if (p.length !== 3) throw new Error('formato');
  const header = dec(p[0]), payload = dec(p[1]);
  if (header.alg !== 'RS256') throw new Error('algoritmo');
  const jwk = (keys || (await googleKeys())).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('llave desconocida');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(p[2]), new TextEncoder().encode(`${p[0]}.${p[1]}`));
  if (!ok) throw new Error('firma inválida');
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('proyecto');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('sin sub');
  if (!(payload.exp > now)) throw new Error('vencido');
  if (payload.iat > now + 300) throw new Error('emitido en el futuro');
  return payload;
}

const roles = new Map();
/** Rol del usuario leyendo usuarios/{uid} con SU propio token (las reglas de Firestore deciden). null = sin acceso. */
export async function getRole(uid, idToken, { projectId, fetchFn = fetch, ttlMs = 60_000 }) {
  const hit = roles.get(uid);
  if (hit && hit.exp > Date.now()) return hit.rol;
  const r = await fetchFn(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/usuarios/${uid}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  let rol = null;
  if (r.ok) {
    const f = (await r.json()).fields || {};
    if (f.activo?.booleanValue !== false) rol = f.rol?.stringValue || null;
  }
  roles.set(uid, { rol, exp: Date.now() + ttlMs });
  return rol;
}

// Quién puede qué (la UI ya lo oculta, pero aquí se HACE CUMPLIR). La primera regla que coincide gana.
export const POLICY = [
  { re: /^\/api\/sync-kaizen/, roles: ['admin'] }, // dispara SP_TCU en el ERP
  { re: /^\/api\//, roles: ['admin', 'supervisor', 'operador'] },
];

/** ¿Este rol debe haber entrado con segundo factor? OBLIGATORIO por defecto (falla cerrado).
 *  env.REQUIRE_MFA: vacío/true/all = todos; false = apagado (solo para pruebas); o lista de roles ("admin,supervisor"). */
export function mfaRequired(env, rol) {
  const v = String(env.REQUIRE_MFA ?? '').trim().toLowerCase();
  if (v === 'false') return false;
  if (!v || v === 'true' || v === 'all') return true;
  return v.split(',').map((x) => x.trim()).includes(String(rol).toLowerCase());
}

/** Punto de entrada: {ok:true, uid, rol} | {ok:false, status, error}. `env.LEGACY_TOKEN` = puente temporal. */
export async function authorize(request, env, fetchFn = fetch) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const path = new URL(request.url).pathname;
  // Compatibilidad transitoria: permite que la app anterior siga funcionando mientras
  // los usuarios pasan a Firebase ID tokens. Desactivar ALLOW_LEGACY_API_TOKEN al terminar.
  const legacyToken = env.LEGACY_TOKEN || (env.ALLOW_LEGACY_API_TOKEN === 'true' ? env.API_TOKEN : '');
  if (legacyToken && token === legacyToken && path.startsWith('/api/')) {
    return { ok: true, uid: 'legacy', rol: 'legacy' };
  }
  let payload;
  try { payload = await verifyIdToken(token, { projectId: env.FIREBASE_PROJECT_ID }); } catch { return { ok: false, status: 401, error: 'No autenticado' }; }
  const rol = await getRole(payload.sub, token, { projectId: env.FIREBASE_PROJECT_ID, fetchFn });
  const rule = POLICY.find((r) => r.re.test(path));
  if (!rol || !rule || !rule.roles.includes(rol)) return { ok: false, status: 403, error: 'Sin permiso' };
  // Verificación en dos pasos: Firebase marca en el token cómo se entró (firebase.sign_in_second_factor = 'totp').
  if (mfaRequired(env, rol) && payload.firebase?.sign_in_second_factor !== 'totp') return { ok: false, status: 403, error: 'Se requiere verificación en dos pasos' };
  return { ok: true, uid: payload.sub, rol };
}
