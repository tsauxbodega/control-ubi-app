// Pruebas de seguridad "de regresión": fallan si alguien vuelve a introducir algo que ya se corrigió.
// Uso: node tests/security.test.mjs   (también corre dentro de `npm test`)
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import assert from 'node:assert/strict'; import { execFileSync } from 'child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const walk = (d, out = []) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
  if (['node_modules', 'dist', '.git', '.wrangler'].includes(e.name)) continue;
  const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; };
const files = walk('.');
const text = files.filter((f) => /\.(js|mjs|html|css|json|toml|md|rules)$/.test(f) && !f.startsWith('vendor' + path.sep) && !f.startsWith('tests' + path.sep) && f !== 'package-lock.json');
let n = 0; const ok = (m) => { n++; };

// 1) Sin terceros en el cliente: nada de CDN, generadores de QR ajenos, Google Fonts ni dominios antiguos del puente.
for (const f of ['index.html', 'sw.js', 'css/app.css', ...text.filter((f) => f.startsWith('js' + path.sep))]) {
  const s = rd(f);
  for (const bad of ['unpkg.com', 'cdnjs.cloudflare.com', 'api.qrserver.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'dns.army', 'jsdelivr'])
    assert.ok(!s.includes(bad), `${f} referencia ${bad} (usar vendor/ o código propio)`);
} ok();
// 2) Solo Google carga scripts externos, y con versión fija.
const ext = [...rd('index.html').matchAll(/<script[^>]+src="(https?:[^"]+)"/g)].map((m) => m[1]);
for (const u of ext) assert.match(u, /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.13\.2\//, 'script externo no permitido: ' + u); ok();
// 3) Sin scripts inline (ni en el HTML ni en las ventanas de impresión): la CSP no permite <script> en línea.
assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(rd('index.html')), 'index.html tiene un <script> en línea');
for (const f of text.filter((f) => f.startsWith('js' + path.sep))) assert.ok(!/<script[\s>]/i.test(rd(f)), `${f} genera un <script> en línea`); ok();
// 4) El tiempo de sesión no se puede alargar desde el navegador.
for (const f of text.filter((f) => f.startsWith('js' + path.sep))) assert.ok(!/ctrl_idle/.test(rd(f).replace(/\/\/.*$/gm, '')), `${f} lee tiempos de sesión de localStorage`); ok();
// 5) Sin secretos pegados en el código (la apiKey de Firebase es pública por diseño y se permite).
for (const f of text) { const s = rd(f);
  assert.ok(!/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9]{32,}/.test(s), `posible secreto en ${f}`); } ok();
// 6) Cabeceras: CSP estricta.
const hdr = rd('_headers'); const csp = /Content-Security-Policy:\s*(.+)/.exec(hdr)[1];
const dir = Object.fromEntries(csp.split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const [k, ...v] = x.split(/\s+/); return [k, v]; }));
assert.deepEqual(dir['default-src'], ["'none'"]); assert.ok(!csp.includes("'unsafe-eval'"), 'CSP permite eval');
assert.ok(!dir['script-src'].includes("'unsafe-inline'"), "script-src no debe llevar 'unsafe-inline'");
assert.deepEqual(dir['object-src'], ["'none'"]); assert.deepEqual(dir['frame-ancestors'], ["'none'"]); assert.deepEqual(dir['base-uri'], ["'none'"]);
assert.ok(dir['script-src'].every((x) => ["'self'", 'https://www.gstatic.com'].includes(x)), 'script-src solo propio + gstatic');
const api = new URL(/API_URL\s*=\s*"([^"]+)"/.exec(rd('js/config.js'))[1]).origin; assert.ok(dir['connect-src'].includes(api), 'connect-src debe incluir el Worker ' + api);
for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'Referrer-Policy', 'Permissions-Policy', 'X-Frame-Options: DENY']) assert.ok(hdr.includes(h), 'falta cabecera ' + h); ok();
// 7) Worker: sin puente del token antiguo y MFA obligatorio.
const toml = rd('worker/wrangler.toml');
assert.match(toml, /ALLOW_LEGACY_API_TOKEN\s*=\s*"false"/); assert.match(toml, /REQUIRE_MFA\s*=\s*"true"/);
assert.ok(!/\bx-api-token\b/i.test(rd('worker/src/index.js')), 'el Worker no debe aceptar la cabecera x-api-token');
assert.ok(!/ALLOWED_ORIGINS\s*=\s*"[^"]*\*/.test(toml), 'ALLOWED_ORIGINS no puede llevar *'); ok();
// 8) Reglas de Firestore: segundo factor + denegar por defecto.
const rules = rd('firestore.rules'); assert.ok(rules.includes("sign_in_second_factor == 'totp'")); assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write:\s*if false;/);
assert.ok(!/allow [^;]*:\s*if true/.test(rules.replace(/\/\/.*$/gm, '')), 'las reglas no deben tener "if true"'); ok();
// 9) Librerías locales íntegras (firmas SHA-256).
for (const l of rd('vendor/SHA256SUMS').trim().split('\n')) { const [h, f] = l.split(/\s+/); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'vendor', f))).digest('hex'), h, 'vendor/' + f + ' fue modificado'); } ok();
// 10) Build de producción: sin console.*, sin mapas de código, con cabeceras y vendor.
execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'ignore' });
const app = fs.readFileSync(path.join(root, 'dist/js/app.js'), 'utf8');
assert.ok(!/console\.(log|warn|error|info|debug)/.test(app), 'el build de producción aún trae console.*');
assert.ok(!/sourceMappingURL/.test(app) && !fs.readdirSync(path.join(root, 'dist/js')).some((f) => f.endsWith('.map')), 'no se publican mapas de código');
for (const f of ['_headers', 'vendor/xlsx.full.min.js', 'vendor/qrcode.js', 'vendor/fonts/ibm-plex-sans-latin-400-normal.woff2']) assert.ok(fs.existsSync(path.join(root, 'dist', f)), 'dist sin ' + f);
const dist = walk('dist'); assert.ok(!dist.some((f) => /\.(md|mjs|toml|rules)$/.test(f) || f.includes('worker') || f.includes('docs') || f.includes('tests')), 'dist publica archivos internos'); ok();
console.log(`OK seguridad (${n} grupos de comprobaciones)`);
