// Construcción para PRODUCCIÓN: un solo js/app.js minificado + css minificado + sw.js a medida.  Uso: npm run build  ->  dist/
// (El desarrollo no lo necesita: la carpeta raíz funciona tal cual, con módulos ES nativos.)
import { build } from 'esbuild'; import fs from 'fs';
const D = 'dist';
fs.rmSync(D, { recursive: true, force: true }); fs.mkdirSync(`${D}/js`, { recursive: true }); fs.mkdirSync(`${D}/css`, { recursive: true });
await build({ entryPoints: ['js/main.js'], bundle: true, minify: true, format: 'esm', target: 'es2020', outfile: `${D}/js/app.js`, legalComments: 'none', drop: ['console', 'debugger'], logLevel: 'info' }); // producción: sin console.* (no filtra mensajes internos al inspector)
await build({ entryPoints: ['css/app.css'], minify: true, outfile: `${D}/css/app.css`, logLevel: 'warning' });
fs.writeFileSync(`${D}/index.html`, fs.readFileSync('index.html', 'utf8').replace('src="js/main.js"', 'src="js/app.js"'));
let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace(/^\s*'js\/[\w-]+\.js',\n/gm, '').replace("  'css/app.css',\n", "  'css/app.css',\n  'js/app.js',\n");
fs.writeFileSync(`${D}/sw.js`, sw);
for (const f of ['manifest.json', 'icon-192.png', 'icon-512.png', '_headers']) fs.copyFileSync(f, `${D}/${f}`);
fs.cpSync('vendor', `${D}/vendor`, { recursive: true, filter: (src) => !/(README\.md|SHA256SUMS)$/.test(src) }); // solo lo que la app usa
console.log(`\nListo: ${D}/  (sube el CONTENIDO de esa carpeta al hosting)`);
