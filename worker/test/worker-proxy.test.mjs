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

console.log('OK worker proxy');
