// Sirve el Excel desde un repositorio PRIVADO de GitHub. El token de GitHub vive solo como secreto del Worker.
// GET devuelve el archivo; HEAD solo cabeceras (la app las usa para saber si cambió: ETag / Last-Modified / tamaño).
export async function excelFromGithub(request, env, extraHeaders = {}) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO || !env.GITHUB_FILE) return new Response(JSON.stringify({ error: 'Excel no configurado' }), { status: 500, headers: { 'Content-Type': 'application/json', ...extraHeaders } });
  const head = request.method === 'HEAD';
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${env.GITHUB_FILE}?ref=${encodeURIComponent(env.GITHUB_REF || 'main')}`;
  let r;
  try {
    r = await fetch(url, {
      method: head ? 'HEAD' : 'GET',
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'tcu-api-proxy', 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch { return new Response(JSON.stringify({ error: 'GitHub no disponible' }), { status: 502, headers: { 'Content-Type': 'application/json', ...extraHeaders } }); }
  const h = new Headers({ 'Cache-Control': 'no-store', ...extraHeaders });
  for (const k of ['etag', 'last-modified', 'content-length']) { const v = r.headers.get(k); if (v) h.set(k, v); }
  if (!r.ok) { h.set('Content-Type', 'application/json'); return new Response(head ? null : JSON.stringify({ error: r.status === 404 ? 'Archivo no encontrado' : 'Error al leer el Excel' }), { status: r.status === 404 ? 404 : 502, headers: h }); }
  h.set('Content-Type', 'application/octet-stream');
  return new Response(head ? null : r.body, { status: 200, headers: h });
}
