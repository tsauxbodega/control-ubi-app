import { NOSTOCK_UBI, PG, nsAsc, nsP, nsRes, nsSC, set_nsAsc, set_nsP, set_nsRes, set_nsSC } from './state-globals.js';
import { _tbSort, matchesQuery } from './buscador.js';
import { cp, jsAttrSafe, mkPag, noDataRow, set, setAlert } from './utils.js';
// ═══ js/nostock.js — extraído de index.html (líneas 9746–9772 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== NOSTOCK =====================
function doNS(){
  if(!NOSTOCK_UBI.length){document.getElementById('nsBody').innerHTML=noDataRow(6);return;}
  const q=document.getElementById('nsQ').value.trim().toUpperCase();
  let res=NOSTOCK_UBI.filter(r=>!q||matchesQuery(q, r[0], r[1], r[2]));
  set_nsRes(res);set_nsP(1);set('nsRes',res.length);
  setAlert('nsAlert','',!res.length&&q?'ae':null,'⚠️ Sin resultados para "'+q+'"');
  renderNS();
}
function renderNS(){
  const tot=nsRes.length,s=(nsP-1)*PG,e=Math.min(s+PG,tot),pg=nsRes.slice(s,e);
  if(!tot){document.getElementById('nsBody').innerHTML=`<tr><td colspan="6" style="border:0"><div class="empty"><div class="ei">✅</div><div class="em">${NOSTOCK_UBI.length?'Sin resultados':'No hay datos — carga un Excel'}</div></div></td></tr>`;document.getElementById('nsPag').style.display='none';return;}
  document.getElementById('nsBody').innerHTML=pg.map((r,i)=>`<tr data-rowid="${r[0]}"><td style="color:var(--text3);font-size:9px">${s+i+1}</td><td class="tcode" style="cursor:pointer" onclick="openRefDetailFromPrec('${jsAttrSafe(r[0])}','${jsAttrSafe(r[1]||'')}')">${r[0]}${cp(r[0])}</td><td class="tdesc">${r[1]||'—'}</td><td style="color:var(--cyan);font-family:var(--mono);font-size:10px">${r[2]||'—'}</td><td class="tnum zero">0</td><td><button class="prlink" onclick="goPrecio('${jsAttrSafe(r[0])}')">💰</button> <button class="stlink" onclick="goBusUbi('${jsAttrSafe(r[2])}')">📍</button></td></tr>`).join('');
  document.getElementById('nsPI').textContent=`${s+1}–${e} de ${tot}`;
  mkPag('nsPag','nsPB',Math.ceil(tot/PG),nsP,p=>{set_nsP(p);renderNS();});
}
function nsSort(col){_tbSort(col,()=>nsAsc,v=>{set_nsAsc(v);},()=>nsSC,v=>{set_nsSC(v);},v=>{set_nsP(v);},nsRes,'nsa',3,null,renderNS);}
function nsSortMob(col){
  nsSort(col);
  [0,1,2].forEach(i=>{
    const btn=document.getElementById('nmsa'+i);
    if(!btn)return;
    btn.classList.remove('mob-sort-asc','mob-sort-desc');
    if(i===nsSC) btn.classList.add(nsAsc?'mob-sort-asc':'mob-sort-desc');
  });
}

export { doNS, nsSort, nsSortMob, renderNS };
