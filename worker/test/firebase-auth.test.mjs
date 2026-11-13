import assert from 'node:assert/strict';
import { verifyIdToken, authorize } from '../src/firebase-auth.js';
import { excelFromGithub } from '../src/excel.js';

const P = 'tcutoyotanys', now = Math.floor(Date.now() / 1000);
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
const b64 = (b) => Buffer.from(b).toString('base64url');
async function mk(over = {}, alg = 'RS256') {
  const h = b64(JSON.stringify({ alg, kid: 'k1', typ: 'JWT' }));
  const p = b64(JSON.stringify({ aud: P, iss: `https://securetoken.google.com/${P}`, sub: 'uid1', iat: now - 10, exp: now + 3600, email: 'a@b.co', ...over }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(sig)}`;
}
const ok = (t) => verifyIdToken(t, { projectId: P, keys: [jwk] });
const falla = async (t, _motivo) => assert.rejects(ok(t));

assert.equal((await ok(await mk())).sub, 'uid1');
await falla(await mk({ exp: now - 1 }), 'vencido');
await falla(await mk({ aud: 'otro' }), 'otro proyecto');
await falla(await mk({ iss: 'https://evil.com' }), 'iss falso');
await falla(await mk({ sub: '' }), 'sin sub');
await falla(await mk({}, 'none'), 'alg none');
const t = await mk(); await falla(t.slice(0, -4) + 'AAAA', 'firma alterada');
await falla(t.split('.').slice(0, 2).join('.') + '.', 'sin firma');
await falla('basura', 'formato');

// authorize(): roles + política (Google y Firestore simulados)
const roles = { adm: { rol: 'admin' }, ope: { rol: 'operador' }, off: { rol: 'admin', activo: false }, sup: { rol: 'supervisor' } };
globalThis.fetch = async (url) => {
  if (String(url).includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=300' } });
  const uid = String(url).split('/usuarios/')[1];
  const r = roles[uid];
  if (!r) return new Response('{}', { status: 404 });
  const f = { rol: { stringValue: r.rol } }; if (r.activo === false) f.activo = { booleanValue: false };
  return new Response(JSON.stringify({ fields: f }));
};
const env = { FIREBASE_PROJECT_ID: P };
const req = (path, token) => new Request('https://x.dev' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
const as = async (uid, path) => authorize(req(path, await mk({ sub: uid })), env);

assert.equal((await authorize(req('/api/kaizen'), env)).status, 401, 'sin token');
assert.equal((await authorize(req('/api/kaizen', 'x.y.z'), env)).status, 401, 'token basura');
assert.equal((await as('ope', '/api/kaizen')).ok, true, 'operador lee inventario');
assert.equal((await as('ope', '/api/sync-kaizen')).status, 403, 'operador NO sincroniza');
assert.equal((await as('sup', '/api/sync-kaizen/status')).status, 403, 'supervisor NO sincroniza');
assert.equal((await as('adm', '/api/sync-kaizen')).ok, true, 'admin sincroniza');
assert.equal((await as('off', '/api/kaizen')).status, 403, 'usuario desactivado');
assert.equal((await as('fantasma', '/api/kaizen')).status, 403, 'sin documento en usuarios');
assert.equal((await as('adm', '/otra-cosa')).status, 403, 'ruta fuera de la política');
assert.equal((await authorize(req('/api/kaizen', 'viejo'), { ...env, LEGACY_TOKEN: 'viejo' })).ok, true, 'puente legacy');
assert.equal((await authorize(req('/api/kaizen', 'otro'), { ...env, LEGACY_TOKEN: 'viejo' })).status, 401, 'legacy no abre otros');
// /api/excel: usa el token de GitHub, no lo filtra, y HEAD no trae cuerpo
let visto;
globalThis.fetch = async (url, o) => { visto = { url: String(url), ...o };
  return new Response(o.method === 'HEAD' ? null : 'XLSXDATA', { status: 200, headers: { etag: 'W/"abc"', 'content-length': '8', 'x-secreto': 'no' } }); };
const envX = { GITHUB_TOKEN: 'ghp_SECRETO', GITHUB_REPO: 'o/r', GITHUB_FILE: 'f.xlsx' };
let rx = await excelFromGithub(new Request('https://x.dev/api/excel'), envX);
assert.equal(await rx.text(), 'XLSXDATA'); assert.equal(rx.headers.get('etag'), 'W/"abc"');
assert.equal(visto.headers.Authorization, 'Bearer ghp_SECRETO'); assert.ok(visto.url.includes('/repos/o/r/contents/f.xlsx?ref=main'));
assert.ok(![...rx.headers.values()].some((v) => v.includes('SECRETO')), 'el token no debe salir en la respuesta');
assert.equal(rx.headers.get('x-secreto'), null, 'solo se reenvían cabeceras permitidas');
rx = await excelFromGithub(new Request('https://x.dev/api/excel', { method: 'HEAD' }), envX);
assert.equal(visto.method, 'HEAD'); assert.equal(rx.body, null); assert.equal(rx.headers.get('content-length'), '8');
globalThis.fetch = async () => new Response('x', { status: 404 });
assert.equal((await excelFromGithub(new Request('https://x.dev/api/excel'), envX)).status, 404);
assert.equal((await excelFromGithub(new Request('https://x.dev/api/excel'), {})).status, 500, 'sin configurar');
console.log('OK');
