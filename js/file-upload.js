import { PRICES, PRICE_IDX, cleanNumber, set_PRICE_IDX } from './state-globals.js';
import { processExcel } from './excel-respaldo.js';
// ═══ js/file-upload.js — extraído de index.html (líneas 7066–7101 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== FILE UPLOAD =====================
function handleFile(e){
  const file=e.target.files[0];
  if(!file)return;
  const r=new FileReader();
  r.onload=ev=>{document.getElementById('prog').style.display='block';setTimeout(()=>processExcel(ev.target.result,file.name),80);};
  r.readAsArrayBuffer(file);
  e.target.value='';
}
function prog(p){document.getElementById('progfill').style.width=p+'%';}
function normCode(v){return String(v??'').replace(/ /g,' ').trim().toUpperCase().replace(/\s+/g,'');}
// Ignora guiones al comparar códigos (la etiqueta del repuesto a veces los
// trae y el inventario no, o viceversa).
function stripDash(v){return String(v??'').toUpperCase().replace(/-/g,'');}
function findSheetName(sheets,aliases){
  const ups=sheets.map(s=>[s,s.toUpperCase()]);
  for(const a of aliases){const au=a.toUpperCase();const exact=ups.find(([,u])=>u===au);if(exact)return exact[0];const partial=ups.find(([,u])=>u.includes(au));if(partial)return partial[0];}
  return null;
}
function addInvRow(store,code,desc,stock,ubi,abc='',days=0,grp='',cost=0,score=0,date='',ultima_compra=''){
  const c=normCode(code);if(!c)return;
  let u=String(ubi??'').trim();
  if(!u||u.toLowerCase()==='nan'||u==='#N/A'||u==='0')u='Sin Ubicacion';
  const key=`${c}|${u}|${String(desc??'').trim()}`;
  if(store.has(key))return;
  store.set(key,[c,String(desc??'').trim(),cleanNumber(stock),u,String(abc??'').trim(),cleanNumber(days),String(grp??'').trim(),cleanNumber(cost),cleanNumber(score),String(date??'').trim(),String(ultima_compra??'').trim()]);
}
function buildPriceIndex(){
  set_PRICE_IDX({});
  for(const[k,v]of Object.entries(PRICES||{})){PRICE_IDX[normCode(k)]=v;}
}
function getPriceRow(code){
  const k=String(code??'').trim();
  return PRICES[k]||PRICES[normCode(k)]||PRICE_IDX[normCode(k)]||null;
}

export { addInvRow, buildPriceIndex, findSheetName, getPriceRow, handleFile, normCode, prog, stripDash };
