#!/usr/bin/env node
// Convierte CONTROL_UBI_cache.xlsx → CONTROL_UBI_cache.json con la MISMA lógica que usa la app (js/excel-parse.js).
// Corre en GitHub Actions (ver docs/github-actions/excel-a-json.yml); no necesita instalar nada: solo Node 18+.
//   uso:  node tools/excel-a-json.mjs <entrada.xlsx> <salida.json>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseWorkbook, EXCEL_DATA_VERSION } from '../js/excel-parse.js';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) { console.error('uso: node tools/excel-a-json.mjs <entrada.xlsx> <salida.json>'); process.exit(2); }
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// SheetJS vendorizado: se comprueba su SHA-256 contra vendor/SHA256SUMS antes de ejecutarlo.
const libPath = path.join(root, 'vendor', 'xlsx.full.min.js');
const code = fs.readFileSync(libPath, 'utf8');
const sums = fs.readFileSync(path.join(root, 'vendor', 'SHA256SUMS'), 'utf8');
const want = (sums.split('\n').map(l => l.trim().split(/\s+/)).find(p => p[1] && p[1].replace(/^\*?(\.\/)?/, '').endsWith('xlsx.full.min.js')) || [])[0];
const got = crypto.createHash('sha256').update(code).digest('hex');
if (!want || want !== got) { console.error('✖ vendor/xlsx.full.min.js no coincide con vendor/SHA256SUMS; se aborta.'); process.exit(1); }
const XLSX = new Function('var module=undefined,exports=undefined,define=undefined;' + code + ';return XLSX;')();

const buf = fs.readFileSync(inFile);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const t0 = Date.now();
const data = parseWorkbook(XLSX, ab, { wantFlat: true });

// Red de seguridad: no sobrescribir un JSON bueno con uno vacío si el libro llegó roto o cambió de estructura.
const problems = [];
if (!data.prices.length) problems.push('la hoja de precios salió vacía');
if (!data.ubiTeo.length) problems.push('la hoja de ubicaciones teóricas salió vacía');
if (!data.estantes.length) problems.push('la hoja de estantes salió vacía');
if (problems.length) { console.error('✖ ' + problems.join('; ') + '. No se escribe el JSON.'); process.exit(1); }

// Huella del libro de origen = hash de blob de git (el mismo "sha" que muestra la API de GitHub para el archivo).
const blobSha = crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
data.src = { name: path.basename(inFile), bytes: buf.length, sha: blobSha };
data.generado = new Date().toISOString();
fs.writeFileSync(outFile, JSON.stringify(data));
console.log(`✔ ${outFile}: ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB · v${EXCEL_DATA_VERSION} · ${data.prices.length} precios, ${data.ubiTeo.length} ubicaciones, ${data.estantes.length} estantes, ${data.flat.length} filas de inventario · ${Date.now() - t0} ms`);
