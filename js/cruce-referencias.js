import { cloudSave, ukey } from './cloud-sync.js';
// ═══ js/cruce-referencias.js — extraído de index.html (líneas 15231–15277 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== CRUCE DE REFERENCIAS =====================
// Estado del módulo
let CRUCE_A = null; // { cod, desc, stock, ubi }
let CRUCE_B = null;
let CRUCE_GUARDADOS = []; // historial de cruces resueltos para exportar

const CRUCE_STORE_KEY = 'ctrl_cruces_v1';

function saveCruces(){
  try{ localStorage.setItem(ukey(CRUCE_STORE_KEY), JSON.stringify(CRUCE_GUARDADOS)); }catch(e){}
  cloudSave('cruces', CRUCE_GUARDADOS);
}
function loadCrucesLocal(){
  try{
    const r = localStorage.getItem(ukey(CRUCE_STORE_KEY));
    if(r) CRUCE_GUARDADOS = JSON.parse(r);
    else CRUCE_GUARDADOS=[];
  }catch(e){ CRUCE_GUARDADOS=[]; }
}
function loadCruces(){ loadCrucesLocal(); } // compatibilidad; la carga real por usuario ocurre en hydrateUserCloudData()

// Expand/Collapse del módulo de cruces
function toggleCruceSection(forceOpen){
  const hdr = document.getElementById('cruceSolverHdr2');
  const body = document.getElementById('cruceSolverBody2');
  if(!hdr||!body) return;
  const isOpen = hdr.classList.contains('open');
  const shouldOpen = (forceOpen===true) ? true : (forceOpen===false ? false : !isOpen);
  if(shouldOpen){
    hdr.classList.add('open');
    body.classList.add('open');
    hdr.setAttribute('aria-expanded','true');
  } else {
    hdr.classList.remove('open');
    body.classList.remove('open');
    hdr.setAttribute('aria-expanded','false');
  }
}
function toggleCruceSection2(){
  const hdr = document.getElementById('cruceSolverHdr2');
  const body = document.getElementById('cruceSolverBody2');
  if(!hdr||!body) return;
  const isOpen = hdr.classList.contains('open');
  if(!isOpen){ hdr.classList.add('open'); body.classList.add('open'); }
  else { hdr.classList.remove('open'); body.classList.remove('open'); }
}

export { CRUCE_A, CRUCE_B, CRUCE_GUARDADOS, CRUCE_STORE_KEY, loadCrucesLocal, toggleCruceSection, toggleCruceSection2 };
export const set_CRUCE_GUARDADOS = (v) => (CRUCE_GUARDADOS = v);
