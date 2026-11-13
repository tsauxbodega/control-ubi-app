// ═══ js/config.js — extraído de index.html (líneas 6164–6192 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ═══════════════════════════════════════════════════════════════════
// API · CONFIGURACIÓN GLOBAL
// ═══════════════════════════════════════════════════════════════════
const API_URL = "https://tcu-api-proxy.anys.workers.dev"
// Antes aquí había un API_TOKEN estático visible para cualquiera. Ahora cada petición lleva el
// ID token de Firebase del usuario conectado (ver js/api.js) y el Worker lo verifica.

// ═══════════════════════════════════════════════════════════════════
// MULTI-BODEGA — 130 Sur · 230 Norte
// ═══════════════════════════════════════════════════════════════════
// INV y compañía SIEMPRE representan la bodega ACTIVA. Las filas crudas
// de ambas sedes viven en INV_RAW_BY_BODEGA; el índice de la sede NO
// activa vive en CROSS_IDX y solo se usa para el aviso cruzado.
const BODEGAS = {
  130: { id:130, nombre:'Sur',   sede:'Toyota Sur',   layout:true  },
  230: { id:230, nombre:'Norte', sede:'Toyota Norte', layout:false }
};
// layout:false → la sede no tiene cargadas ubicaciones teóricas/estantes.
// Cuando exista el Excel de layout de Norte, poner layout:true y listo.

const BODEGA_DEFAULT = 130;
let ACTIVE_BODEGA = BODEGA_DEFAULT;
let INV_RAW_BY_BODEGA = {};   // { 130:[filas], 230:[filas] }
let CROSS_IDX = new Map();    // código normalizado → fila de la OTRA sede
const BODEGA_KEY = 'ctrl_active_bodega';

function otherBodega(b){ return Number(b)===130 ? 230 : 130; }
function bodegaName(b){ return BODEGAS[b]?.nombre || ('B'+b); }
function activeHasLayout(){ return !!BODEGAS[ACTIVE_BODEGA]?.layout; }

export { ACTIVE_BODEGA, API_URL, BODEGAS, BODEGA_DEFAULT, BODEGA_KEY, CROSS_IDX, INV_RAW_BY_BODEGA, activeHasLayout, bodegaName, otherBodega };
export const set_ACTIVE_BODEGA = (v) => (ACTIVE_BODEGA = v);
export const set_CROSS_IDX = (v) => (CROSS_IDX = v);
export const set_INV_RAW_BY_BODEGA = (v) => (INV_RAW_BY_BODEGA = v);
