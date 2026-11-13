import { cloudSave, ukey } from './cloud-sync.js';
import { doSearch } from './buscador.js';
import { doPrec } from './precios.js';
import { doUbi } from './ubicaciones.js';
import { escHtml, jsAttrSafe, removePickByKey, togglePickTray } from './utils.js';
import { removeRelocByKey } from './cambio-ubicacion.js';
// ═══ js/tema-historial.js — extraído de index.html (líneas 12859–12936 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ── THEME TOGGLE ──────────────────────────────────────────────────────────────
function toggleTheme(){
  const html=document.documentElement;
  const isLight=html.getAttribute('data-theme')==='light';
  html.setAttribute('data-theme',isLight?'dark':'light');
  localStorage.setItem('ctrl_ubi_theme',isLight?'dark':'light');
  // Update SVG logo oval color
  updateLogoTheme();
}
function updateLogoTheme(){
  // Badge TCU autocontenido (rojo+blanco fijo) — no requiere ajuste por tema
}
// ── SEARCH HISTORY ──────────────────────────────────────────────────────────
const HIST_MAX=8;
let HIST_CACHE={bus:[],prec:[],ubi:[]}; // historial de búsqueda por usuario, sincronizado con Firestore
function loadHistLocal(){
  try{
    const raw=localStorage.getItem(ukey('ctrl_hist_all'));
    HIST_CACHE = raw ? JSON.parse(raw) : {bus:[],prec:[],ubi:[]};
  }catch(e){ HIST_CACHE={bus:[],prec:[],ubi:[]}; }
  if(!HIST_CACHE||typeof HIST_CACHE!=='object') HIST_CACHE={bus:[],prec:[],ubi:[]};
  ['bus','prec','ubi'].forEach(p=>{ if(!Array.isArray(HIST_CACHE[p])) HIST_CACHE[p]=[]; });
}
function saveHistLocal(){
  try{ localStorage.setItem(ukey('ctrl_hist_all'),JSON.stringify(HIST_CACHE)); }catch(e){}
  cloudSave('historial', HIST_CACHE);
}
function getHist(p){ return (HIST_CACHE&&HIST_CACHE[p])||[]; }
function pushHist(p,q){
  if(!q)return;
  let h=getHist(p).filter(v=>v!==q);
  h.unshift(q);
  if(h.length>HIST_MAX)h.length=HIST_MAX;
  HIST_CACHE[p]=h;
  saveHistLocal();
  updateHistBtn(p);
}
function clearHist(p){HIST_CACHE[p]=[];saveHistLocal();updateHistBtn(p);closeAllHist();}
function updateHistBtn(p){
  const btn=document.getElementById(p+'HistBtn');
  if(!btn)return;
  const n=getHist(p).length;
  btn.classList.toggle('has',n>0);
  btn.title=n?'Historial ('+n+' búsquedas)':'Sin historial';
}
function toggleHist(p){
  const drop=document.getElementById(p+'HistDrop');
  if(!drop)return;
  const open=drop.classList.contains('on');
  closeAllHist();
  if(!open){renderHistDrop(p);drop.classList.add('on');}
}
function closeAllHist(){document.querySelectorAll('.shistdrop').forEach(d=>d.classList.remove('on'));}
function renderHistDrop(p){
  const drop=document.getElementById(p+'HistDrop');
  const h=getHist(p);
  const clkIco='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>';
  if(!h.length){drop.innerHTML='<div class="shistempty">Sin búsquedas recientes</div>';return;}
  drop.innerHTML='<div class="shisthead">Búsquedas recientes</div>'+
    h.map(q=>`<div class="shistitem" onclick="applyHist('${jsAttrSafe(p)}',${escHtml(JSON.stringify(q))})">${clkIco}<span class="shistq">${escHtml(q)}</span></div>`).join('')+
    `<div class="shistclear" onclick="clearHist('${jsAttrSafe(p)}')">✕ &nbsp;Limpiar historial</div>`;
}
function applyHist(p,q){
  closeAllHist();
  if(p==='bus'){document.getElementById('busQ').value=q;doSearch();}
  else if(p==='prec'){document.getElementById('precQ').value=q;doPrec();}
  else if(p==='ubi'){document.getElementById('ubiQ').value=q;doUbi();}
}
document.addEventListener('click',e=>{if(!e.target.closest('.shist'))closeAllHist();});
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-rem-key]');
  if(b){e.stopPropagation();removePickByKey(b.dataset.remKey);}
  const r=e.target.closest('[data-reloc-key]');
  if(r){e.stopPropagation();removeRelocByKey(r.dataset.relocKey);}
});
document.addEventListener('click',e=>{const b=e.target.closest('.pbtn[data-page]');if(!b)return;const c=b.parentElement;if(c?._pagCb)c._pagCb(+b.dataset.page);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')togglePickTray(false);});

export { HIST_CACHE, applyHist, clearHist, loadHistLocal, pushHist, toggleHist, toggleTheme, updateHistBtn };
export const set_HIST_CACHE = (v) => (HIST_CACHE = v);
