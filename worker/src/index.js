import { authorize } from './firebase-auth.js';
import { excelFromGithub } from './excel.js';

const BACKEND_TIMEOUT_MS = 12_000;
const API_PATH = /^\/api\//;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const headers = {
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-token',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'ETag, Last-Modified, Content-Length',
    'Vary': 'Origin',
  };

  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function jsonError(message, status, cors) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors,
    },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const isExcel = url.pathname === '/api/excel';

    // El navegador debe provenir de un origen explícitamente autorizado.
    const allowedOrigins = String(env.ALLOWED_ORIGINS || '')
      .split(',').map((value) => value.trim()).filter(Boolean);
    if (origin && !allowedOrigins.includes(origin)) {
      return jsonError('Origen no permitido', 403, cors);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const methodAllowed = request.method === 'GET'
      || request.method === 'POST'
      || (isExcel && request.method === 'HEAD');
    if (!methodAllowed) {
      return jsonError('Método no permitido', 405, cors);
    }

    if (!API_PATH.test(url.pathname)) {
      return jsonError('Ruta no encontrada', 404, cors);
    }

    let auth;
    try {
      auth = await authorize(request, env);
    } catch (error) {
      // No convertir una caída temporal de Google/Firestore en un permiso implícito.
      return jsonError('No se pudo validar la sesión. Intenta nuevamente.', 503, cors);
    }

    if (!auth.ok) {
      return jsonError(auth.error, auth.status, cors);
    }

    if (isExcel && (request.method === 'GET' || request.method === 'HEAD')) {
      return excelFromGithub(request, env, cors);
    }

    if (!env.API_TOKEN) {
      return jsonError('Falta configurar el secreto API_TOKEN del servicio interno', 500, cors);
    }
    if (!env.PRIVATE_API || typeof env.PRIVATE_API.fetch !== 'function') {
      return jsonError('Falta configurar el binding PRIVATE_API', 500, cors);
    }

    // Se conserva el VPC Service actual. El navegador nunca envía API_TOKEN al ERP;
    // el Worker lo agrega únicamente en el salto privado hacia localhost:3500.
    const targetUrl = `http://localhost:3500${url.pathname}${url.search}`;
    const outHeaders = new Headers({ Authorization: `Bearer ${env.API_TOKEN}` });
    const contentType = request.headers.get('Content-Type');
    if (contentType) outHeaders.set('Content-Type', contentType);

    const init = {
      method: request.method,
      headers: outHeaders,
      body: request.method === 'POST' ? request.body : undefined,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

    try {
      const upstream = await env.PRIVATE_API.fetch(targetUrl, {
        ...init,
        signal: controller.signal,
      });
      const response = new Response(upstream.body, upstream);
      for (const [key, value] of Object.entries(cors)) {
        response.headers.set(key, value);
      }
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (error) {
      if (error?.name === 'AbortError') {
        return jsonError(
          'El servicio interno no respondió a tiempo. Verifica el servicio puente y el túnel.',
          504,
          cors,
        );
      }
      return jsonError('No se pudo contactar el servicio interno.', 502, cors);
    } finally {
      clearTimeout(timer);
    }
  },
};
