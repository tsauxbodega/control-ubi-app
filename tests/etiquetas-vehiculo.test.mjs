// Prueba de la búsqueda por vehículo (js/etiquetas-vehiculo.js) contra el catálogo REAL de etiquetas.js.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buscarPorVehiculo, parseAplic, parseQuery, normTxt } from '../js/etiquetas-vehiculo.js';

// Extrae el objeto ETQ_BAT_CAT del código fuente sin cargar el DOM.
const src = fs.readFileSync(new URL('../js/etiquetas.js', import.meta.url), 'utf8');
const ini = src.indexOf('let ETQ_BAT_CAT = {');
const fin = src.indexOf('\n};', ini);
assert.ok(ini > 0 && fin > ini, 'no encontré ETQ_BAT_CAT');
const CAT = new Function('return ' + src.slice(ini + 'let ETQ_BAT_CAT = '.length, fin + 3))();
assert.ok(Object.keys(CAT).length >= 20, 'catálogo muy corto');

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('  ✓', name); };
const refs = (rows) => rows.map((r) => r.ref);

t('normaliza Land Cruiser / acentos / espacios', () => {
  assert.equal(normTxt('Land Crusier 300'), 'lc300');
  assert.equal(normTxt('LANDCRUISER 79'), 'lc79');
  assert.equal(normTxt('Híbrido'), 'hibrido');
  assert.equal(normTxt('Rav 4'), 'rav4');
  assert.equal(normTxt('Carolla'), 'corolla');
});

t('no parte "150/250" y detecta combustible por vehículo', () => {
  const e = parseAplic('Prado 150/250 Diesel / LC78', 'DSL');
  assert.equal(e.length, 2);
  assert.equal(e[0].base, 'prado 150/250');
  assert.equal(e[0].fuel, 'DSL');
  assert.equal(e[1].fuel, 'DSL'); // hereda comb del catálogo
});

t('consulta: combustible y año se separan de las palabras', () => {
  const q = parseQuery('Hilux 2020 diésel');
  assert.deepEqual(q.tokens, ['hilux']);
  assert.equal(q.fuel, 'DSL');
  assert.equal(q.year, 2020);
});

t('hilux diesel -> baterías diesel de Hilux, ninguna gasolina', () => {
  const r = buscarPorVehiculo(CAT, 'hilux diesel');
  const todos = [...r.exactos, ...r.relacionados];
  assert.ok(todos.length > 0);
  assert.ok(refs(todos).includes('28800574HL')); // Yuasa 57412 (Hilux 4x4 DSL)
  for (const x of todos) assert.notEqual(CAT[x.ref].comb, 'GAS', x.ref);
});

t('hilux gasolina incluye 56216 y no las diesel', () => {
  const r = buscarPorVehiculo(CAT, 'hilux gasolina');
  const todos = refs([...r.exactos, ...r.relacionados]);
  assert.ok(todos.includes('2880056H2L'));
  assert.ok(!todos.includes('28800574HL'));
});

t('corolla: "Corolla" exacto va antes que "Corolla Cross"', () => {
  const r = buscarPorVehiculo(CAT, 'corolla');
  assert.ok(refs(r.exactos).includes('2880080D3L'));
  assert.ok(!refs(r.exactos).includes('2880044H1L')); // Corolla Cross Gas / Yaris -> relacionado
  assert.ok(refs(r.relacionados).includes('2880044H1L'));
});

t('corolla cross híbrido (filtro de botón) devuelve solo HEV', () => {
  const r = buscarPorVehiculo(CAT, 'corolla cross', 'HEV');
  const todos = [...r.exactos, ...r.relacionados];
  assert.ok(todos.length > 0);
  for (const x of todos) assert.equal(x.fuel, 'HEV');
});

t('"lc 300" y "land cruiser 300" dan lo mismo', () => {
  const a = refs(buscarPorVehiculo(CAT, 'lc 300').exactos).sort();
  const b = refs(buscarPorVehiculo(CAT, 'land cruiser 300').exactos).sort();
  assert.ok(a.length > 0);
  assert.deepEqual(a, b);
});

t('Yuasa aparece antes que Hella', () => {
  const r = buscarPorVehiculo(CAT, 'prado');
  const lista = [...r.exactos, ...r.relacionados];
  const iH = lista.findIndex((x) => x.d.marca === 'HELLA');
  const ultimaY = lista.map((x) => x.d.marca).lastIndexOf('YUASA');
  if (iH >= 0 && ultimaY >= 0) assert.ok(iH > ultimaY || lista.slice(0, iH).every((x) => x.d.marca === 'YUASA'));
});

t('búsqueda directa por tipo de caja y por modelo comercial', () => {
  const ln2 = refs(buscarPorVehiculo(CAT, 'LN2').directos);
  assert.ok(ln2.includes('2880038B42'));
  const d = refs(buscarPorVehiculo(CAT, '80D23L').directos);
  assert.ok(d.includes('2880080D3L'));
});

t('consulta vacía o sin resultados no rompe', () => {
  const v = buscarPorVehiculo(CAT, '');
  assert.equal(v.exactos.length + v.relacionados.length + v.directos.length, 0);
  const n = buscarPorVehiculo(CAT, 'zzzz');
  assert.equal(n.exactos.length + n.relacionados.length + n.directos.length, 0);
});

t('año: "hilux 2015 gasolina" excluye la de "2017+"', () => {
  const r = buscarPorVehiculo(CAT, 'hilux 2015 gasolina');
  assert.ok(!refs([...r.exactos, ...r.relacionados]).includes('2880056H2L'));
  const r2 = buscarPorVehiculo(CAT, 'hilux 2019 gasolina');
  assert.ok(refs([...r2.exactos, ...r2.relacionados]).includes('2880056H2L'));
});

console.log(`etiquetas-vehiculo: ${ok} pruebas OK`);
