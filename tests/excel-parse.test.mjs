// Pruebas del lector puro del Excel (js/excel-parse.js) y del conversor a JSON (tools/excel-a-json.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseWorkbook, flatRowsFromData, readWorkbook, EXCEL_DATA_VERSION } from '../js/excel-parse.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const XLSX = new Function('var module=undefined,exports=undefined,define=undefined;' + fs.readFileSync(path.join(root, 'vendor/xlsx.full.min.js'), 'utf8') + ';return XLSX;')();

// ── libro de prueba con la estructura real (hojas usadas + hojas heredadas) ──
const aoa = (r) => XLSX.utils.aoa_to_sheet(r);
const wb = XLSX.utils.book_new();
const add = (n, rows) => XLSX.utils.book_append_sheet(wb, aoa(rows), n);
add('PRECIOS_DATA', [['Código', 'Descripción', 'Mostrador', 'Accesorios', 'Mostrador sin Dcto', 'Costo'], ['0888-1', 'FILTRO ACEITE', '1.234,5', 2000, 3000, 500], ['0888-2', 'PASTILLA', 10000, 0, 12000, 700], [null, 'sin código', 1, 2, 3, 4]]);
add('UBITEORICAS', [['REPORTE'], ['UBICACIÓN', 'ESTADO', 'REF', 'STOCK', 'TIPO'], ['A1-1-1', 'Libre', '', 0, 'bin'], ['A1-1-2', 'Ocupada', '0888-1', 3, 'caja']]);
add('DASH_ESTANTES', [['ESTANTE', 'TOTAL', 'OCUPADAS', 'LIBRES', '% LIBRE', 'NOTA'], ['A1', 30, 10, 20, 66.6, 'ok'], ['📊 total', 1, 1, 1, 1, '']]);
add('SM', [['CODIGO', 'DESC', 'UBI', 'STOCK', 'ULT COMPRA', 'ULT VT'], ['0888-9', 'VIEJO', 'Z9-1', '4,5', '2020-01-01', '2021-02-02']]);
add('PERFILES_ESTANTES', [['UBICACION', '', '', 'ZONA', 'ALTURA', 'CATEGORIA', 'DIM', 'TIPO_BIN', 'ABC', 'ROT', 'CODIGO'], ['A1-1-1', '', '', 'frontal', 'bajo', 'FILTROS', 'S', 'BIN', 'A', 'ALTA', 'X1']]);
add('KAIZEN', [['Código', 'Descripción', 'Stock', 'ABC', 'Ubicación', 'M1', 'Fecha Entrada'], ['0888-1', 'FILTRO ACEITE', 7, 'A', 'A1-1-2', 3, '15/mar/2024'], ['0888-3', 'OTRO', 2, 'B', '', 1, '']]);
add('STOCK_UBI', [['Código', 'Descripción', 'Stock', 'Ubicación'], ['0888-3', 'OTRO', 2, 'A1-1-3']]);
add('STOCK_NOUBI', [['Código', 'Descripción', 'x', 'Stock'], ['0888-4', 'SIN UBI', 0, 5]]);
add('NOSTOCK_UBI', [['Código', 'Descripción', 'Ubicación'], ['0888-5', 'SIN STOCK', 'A1-1-4']]);
add('HOJA_INUTIL', [['x'], ['y']]);
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const ab = buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;

let n = 0; const ok = () => { n++; };

// 1) Contenido
{
  const d = parseWorkbook(XLSX, ab, { wantFlat: true });
  assert.equal(d.v, EXCEL_DATA_VERSION);
  assert.deepEqual(d.priceTypes.map(t => t.key), ['mostrador', 'accesorios', 'mostrador_sin_dcto']);
  assert.equal(d.prices.length, 2, 'la fila sin código se ignora');
  assert.deepEqual(d.prices[0], ['0888-1', 'FILTRO ACEITE', 500, 1234.5, 2000, 3000]);
  assert.deepEqual(d.ubiTeo[1], ['A1-1-2', 'Ocupada', '0888-1', 3, 'CAJA']);
  assert.equal(d.estantes.length, 1, 'filas de resumen (📊) fuera');
  assert.deepEqual(d.estantes[0].slice(0, 4), ['A1', 30, 10, 20]); assert.ok(Math.abs(d.estantes[0][4] - 0.666) < 1e-9); assert.equal(d.estantes[0][5], 'ok');
  assert.equal(d.smMap['0888-9'.toUpperCase()].stock, 4.5);
  assert.equal(d.perfilMap['A1-1-1'].cat, 'FILTROS');
  assert.equal(d.perfilesFromFile, 1);
  const flat = flatRowsFromData(d);
  assert.ok(flat.length >= 4, 'inventario plano armado desde KAIZEN/STOCK_*');
  assert.equal(Number(flat.find(r => r.cod === '0888-1').stock), 7);
  assert.equal(flat.find(r => r.cod === '0888-1').ubicacion, 'A1-1-2');
  assert.equal(d.flat.length, flat.length);
  ok();
}
// 2) Sin wantFlat no se leen las hojas de stock
{
  const d = parseWorkbook(XLSX, ab, { wantFlat: false });
  assert.equal(d.flat.length, 0); assert.equal(d.prices.length, 2); ok();
}
// 3) La lectura rápida da EXACTAMENTE lo mismo que leer todo el libro
{
  const full = XLSX.read(ab, { type: 'array' });
  const fast = readWorkbook(XLSX, ab, true);
  assert.deepEqual(fast.SheetNames, full.SheetNames);
  for (const nm of ['PRECIOS_DATA', 'UBITEORICAS', 'DASH_ESTANTES', 'SM', 'PERFILES_ESTANTES', 'KAIZEN', 'STOCK_UBI', 'STOCK_NOUBI', 'NOSTOCK_UBI']) {
    for (const raw of [true, false]) {
      const a = XLSX.utils.sheet_to_json(full.Sheets[nm], { header: 1, raw, defval: '' });
      const b = XLSX.utils.sheet_to_json(fast.Sheets[nm], { header: 1, raw, defval: '' });
      assert.deepEqual(b, a, nm + ' raw=' + raw);
    }
  }
  assert.equal(readWorkbook(XLSX, ab, false).Sheets['KAIZEN'], undefined, 'sin wantFlat no se leen hojas de stock');
  assert.equal(fast.Sheets['HOJA_INUTIL'], undefined, 'las hojas sin uso no se interpretan');
  ok();
}
// 4) El resultado sobrevive a JSON (es lo que viaja desde GitHub)
{
  const d = parseWorkbook(XLSX, ab, { wantFlat: true });
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d); ok();
}
// 5) Conversor de línea de comandos (el mismo que corre en GitHub Actions)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl2json-'));
  const x = path.join(dir, 'in.xlsx'), j = path.join(dir, 'out.json');
  fs.writeFileSync(x, Buffer.from(ab));
  const out = execFileSync('node', [path.join(root, 'tools/excel-a-json.mjs'), x, j], { encoding: 'utf8' });
  assert.match(out, /2 precios/);
  const d = JSON.parse(fs.readFileSync(j, 'utf8'));
  assert.equal(d.src.bytes, fs.statSync(x).size);
  assert.match(d.src.sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(d.prices, parseWorkbook(XLSX, ab, { wantFlat: true }).prices);
  // libro roto → no escribe y sale con error
  const bad = path.join(dir, 'bad.xlsx'); const w2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w2, aoa([['x']]), 'OTRA');
  fs.writeFileSync(bad, Buffer.from(XLSX.write(w2, { type: 'array', bookType: 'xlsx' })));
  assert.throws(() => execFileSync('node', [path.join(root, 'tools/excel-a-json.mjs'), bad, path.join(dir, 'bad.json')], { stdio: 'pipe' }));
  assert.ok(!fs.existsSync(path.join(dir, 'bad.json')));
  ok();
}
console.log(`excel-parse.test: ${n} grupos OK`);
