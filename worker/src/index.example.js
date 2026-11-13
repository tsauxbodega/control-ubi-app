// EJEMPLO de integración. Tu Worker "tcu-api-proxy" ya reenvía al túnel/ERP: conserva ESA parte y
// sustituye únicamente la comprobación del token estático por authorize().
import { authorize } from './firebase-auth.js';
import { excelFromGithub } from './excel.js';

const cors = (req, env) => {
  const origin = req.headers.get('Origin') || '';
  const permitidos = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return permitidos.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS', 'Access-Control-Expose-Headers': 'ETag, Last-Modified, Content-Length', Vary: 'Origin' }
    : {};
};

export default {
  async fetch(request, env) {
    const h = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const a = await authorize(request, env);
    if (!a.ok) return new Response(JSON.stringify({ error: a.error }), { status: a.status, headers: { 'Content-Type': 'application/json', ...h } });

    const url = new URL(request.url);
    if (url.pathname === '/api/excel' && ['GET', 'HEAD'].includes(request.method)) return excelFromGithub(request, env, h);

    // ── TU LÓGICA ACTUAL: reenviar al ERP/túnel. El token hacia el ERP sale de un SECRETO del Worker. ──
    const up = await fetch(env.UPSTREAM_URL + url.pathname + url.search, {
      method: request.method,
      headers: { Authorization: `Bearer ${env.UPSTREAM_TOKEN}` },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });
    return new Response(up.body, { status: up.status, headers: { 'Content-Type': up.headers.get('Content-Type') || 'application/json', ...h } });
  },
};
