// Búsqueda de baterías por vehículo para el módulo Etiquetas.
// Módulo PURO (sin DOM): se prueba en Node con tests/etiquetas-vehiculo.test.mjs.
//
// El catálogo guarda la compatibilidad como texto libre en `aplic`, p. ej.
//   'Prado 150/250 Diesel / LC78'   ·   'Corolla Cross Gas / Hilux Gas'
// Cada vehículo se separa por " / " (con espacios; "150/250" no se parte).
// Aquí se normaliza ese texto y la consulta del usuario para poder escribir
// "hilux diesel", "lc 300", "corolla cross híbrido" o directamente "LN2".

const FUEL_WORDS = {
  diesel: 'DSL', dsl: 'DSL', petrolero: 'DSL',
  gas: 'GAS', gasolina: 'GAS', nafta: 'GAS', bencina: 'GAS',
  hev: 'HEV', hibrido: 'HEV', hybrid: 'HEV',
};

export function normTxt(s) {
  let t = String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[_,;]+/g, ' ');
  t = t
    .replace(/land\s*-?\s*cru\w{2}er/g, 'lc')   // "Land Cruiser", "Land Crusier", "landcruiser"
    .replace(/\bcarolla\b/g, 'corolla')
    .replace(/\brav\s*-?\s*4\b/g, 'rav4')
    .replace(/\b4\s*runner\b/g, '4runner')
    .replace(/\bfj\s*cruiser\b/g, 'fj cruiser')
    .replace(/\bhilux\b|\bhillux\b/g, 'hilux')
    .replace(/\blc\s*-?\s*(\d)/g, 'lc$1')        // "lc 300" -> "lc300"
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

// Divide "Prado 150/250 Diesel / LC78" en vehículos sueltos con su combustible.
export function parseAplic(aplic, combDefault) {
  return String(aplic || '')
    .split(/\s+\/\s+/)
    .map((txt) => txt.trim())
    .filter(Boolean)
    .map((txt) => {
      const norm = normTxt(txt);
      const words = norm.split(' ');
      let fuel = null;
      const base = [];
      for (const w of words) {
        if (FUEL_WORDS[w]) fuel = FUEL_WORDS[w];
        else base.push(w);
      }
      const years = [...txt.matchAll(/(\d{4})\s*\+/g)].map((m) => Number(m[1]));
      return {
        txt,
        base: base.join(' '),
        fuel: fuel || (combDefault && combDefault !== 'MIX' ? combDefault : null),
        fromYear: years.length ? Math.min(...years) : null,
      };
    });
}

// "hilux 2020 diesel" -> { tokens:['hilux'], fuel:'DSL', year:2020, raw:'hilux 2020 diesel' }
export function parseQuery(q, fuelFilter) {
  const norm = normTxt(q);
  let fuel = fuelFilter || null;
  let year = null;
  const tokens = [];
  for (const w of norm.split(' ').filter(Boolean)) {
    if (FUEL_WORDS[w]) fuel = FUEL_WORDS[w];
    else if (/^(19|20)\d{2}$/.test(w)) year = Number(w);
    else tokens.push(w);
  }
  return { tokens, fuel, year, raw: norm };
}

const fieldHay = (ref, d) =>
  normTxt([ref, d.modelo, d.tipo_caja, d.marca, d.tipo, d.desc].join(' '));

/**
 * @param {Object} cat      catálogo { ref: {desc, aplic, comb, ...} }
 * @param {string} q        texto que escribe el usuario
 * @param {string} [fuel]   filtro 'GAS' | 'DSL' | 'HEV' | '' (todos)
 * @returns {{exactos:Array, relacionados:Array, directos:Array}}
 *   exactos: el vehículo coincide tal cual; relacionados: coincide pero es otra
 *   versión (p. ej. buscas "corolla" y aparece "Corolla Cross"); directos:
 *   coincide por código/modelo/caja (escribió "LN2" o "80D23L").
 */
export function buscarPorVehiculo(cat, q, fuel) {
  const pq = parseQuery(q, fuel);
  const out = { exactos: [], relacionados: [], directos: [] };
  if (!pq.tokens.length && !pq.fuel) return out;
  const joined = pq.tokens.join(' ');
  for (const [ref, d] of Object.entries(cat || {})) {
    const entries = parseAplic(d.aplic, d.comb);
    let best = null;
    for (const e of entries) {
      if (pq.tokens.length) {
        const hay = e.base;
        if (!pq.tokens.every((t) => hay.includes(t))) continue;
      }
      if (pq.fuel && e.fuel && e.fuel !== pq.fuel) continue;
      if (pq.fuel && !e.fuel) continue;
      if (pq.year && e.fromYear && pq.year < e.fromYear) continue;
      const exact = pq.tokens.length > 0 && e.base === joined;
      const rank = exact ? 2 : 1;
      if (!best || rank > best.rank) best = { e, rank };
    }
    if (best) {
      const row = { ref, d, match: best.e.txt, fuel: best.e.fuel || d.comb || '' };
      (best.rank === 2 ? out.exactos : out.relacionados).push(row);
      continue;
    }
    // Búsqueda directa por código / modelo / tipo de caja / marca
    if (pq.tokens.length && !pq.fuel) {
      const hay = fieldHay(ref, d);
      if (pq.tokens.every((t) => hay.includes(t))) {
        out.directos.push({ ref, d, match: d.aplic || '', fuel: d.comb || '' });
      }
    }
  }
  const byMarca = (a, b) =>
    (a.d.marca === 'YUASA' ? 0 : 1) - (b.d.marca === 'YUASA' ? 0 : 1) || a.ref.localeCompare(b.ref);
  out.exactos.sort(byMarca);
  out.relacionados.sort(byMarca);
  out.directos.sort(byMarca);
  return out;
}

// Vehículos que aparecen en el catálogo, para los botones de acceso rápido.
export const VEHICULOS_RAPIDOS = [
  'Hilux', 'Fortuner', 'Prado', 'Land Cruiser', 'LC300', 'Corolla', 'Corolla Cross',
  'Yaris', 'Yaris Cross', 'RAV4', '4Runner', 'FJ Cruiser', 'Tundra',
];
