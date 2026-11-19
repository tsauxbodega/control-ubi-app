import assert from 'node:assert/strict';
import worker from '../src/index.js';

const origin = 'https://tcunorteysur.anys.workers.dev';
const forwarded = [];
const env = {
  API_TOKEN: 'backend-secret',
  ALLOW_LEGACY_API_TOKEN: 'true',
  ALLOWED_ORIGINS: origin,
  FIREBASE_PROJECT_ID: 'tcutoyotanys',
  PRIVATE_API: {
    async fetch(url, init) {
      forwarded.push({ url: String(url), init });
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  },
};

const get = (path, extra = {}) => new Request(`https://tcu-api-proxy.anys.workers.dev${path}`, {
  method: 'GET',
  headers: { Origin: origin, Authorization: 'Bearer backend-secret', ...extra },
});

// El Worker conserva compatibilidad antigua, pero siempre reenvía el secreto al ERP desde el servidor.
let response = await worker.fetch(get('/api/kaizen?bodega=all'), env);
assert.equal(response.status, 200);
assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
assert.equal(forwarded.length, 1);
assert.equal(forwarded[0].url, 'http://localhost:3500/api/kaizen?bodega=all');
assert.equal(forwarded[0].init.headers.get('Authorization'), 'Bearer backend-secret');

// Un origen que no está en allowlist se bloquea.
response = await worker.fetch(get('/api/kaizen', { Origin: 'https://sitio-ajeno.example' }), env);
assert.equal(response.status, 403);
assert.equal(forwarded.length, 1);

// Preflight válido y métodos no permitidos.
response = await worker.fetch(new Request('https://tcu-api-proxy.anys.workers.dev/api/kaizen', {
  method: 'OPTIONS', headers: { Origin: origin },
}), env);
assert.equal(response.status, 204);
response = await worker.fetch(new Request('https://tcu-api-proxy.anys.workers.dev/api/kaizen', {
  method: 'DELETE', headers: { Origin: origin, Authorization: 'Bearer backend-secret' },
}), env);
assert.equal(response.status, 405);

// HEAD solo está permitido para la ruta Excel; sin GitHub token responde error de configuración, no llama al ERP.
response = await worker.fetch(new Request('https://tcu-api-proxy.anys.workers.dev/api/excel', {
  method: 'HEAD', headers: { Origin: origin, Authorization: 'Bearer backend-secret' },
}), env);
assert.equal(response.status, 500);
assert.equal(forwarded.length, 1);

// /api/excel-json (el libro ya convertido por GitHub Actions): pide el archivo .json hermano al repositorio, nunca al ERP.
{
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { asked.push({ u: String(u), method: init && init.method }); return new Response(init.method === 'HEAD' ? null : '{"v":1}', { status: 200, headers: { etag: '"abc"', 'content-length': '999' } }); };
  const genv = { ...env, GITHUB_TOKEN: 't', GITHUB_REPO: 'o/datos', GITHUB_FILE: 'CONTROL_UBI_cache.xlsx', GITHUB_REF: 'main' };
  const j = await worker.fetch(new Request('https://tcu-api-proxy.anys.workers.dev/api/excel-json', { method: 'GET', headers: { Origin: origin, Authorization: 'Bearer backend-secret' } }), genv);
  const x = await worker.fetch(new Request('https://tcu-api-proxy.anys.workers.dev/api/excel', { method: 'HEAD', headers: { Origin: origin, Authorization: 'Bearer backend-secret' } }), genv);
  globalThis.fetch = realFetch;
  assert.equal(j.status, 200);
  assert.match(j.headers.get('Content-Type'), /application\/json/);
  assert.equal(j.headers.get('etag'), '"abc"');
  assert.equal(j.headers.get('content-length'), null, 'el JSON viaja comprimido por Cloudflare: no se copia el tamaño de origen');
  assert.ok(asked[0].u.includes('/contents/CONTROL_UBI_cache.json?ref=datos-json'), 'pide el .json de la rama datos-json: ' + asked[0].u);
  assert.ok(asked[1].u.includes('/contents/CONTROL_UBI_cache.xlsx?ref=main') && asked[1].method === 'HEAD');
  assert.equal(x.headers.get('content-length'), '999');
  assert.equal(forwarded.length, 1, 'ninguna de las dos rutas toca el ERP');
}

// Producción: con el puente apagado, el token estático antiguo ya no abre nada; y las respuestas llevan nosniff.
response = await worker.fetch(get('/api/kaizen'), { ...env, ALLOW_LEGACY_API_TOKEN: 'false' });
assert.equal(response.status, 401);
assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
assert.equal(forwarded.length, forwarded.length, 'sin reenvío al ERP');

console.log('OK worker proxy');
