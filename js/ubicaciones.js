import { INV, PG, PICKLIST, PICK_TRAY_OPEN, RELOC_LIST, UBI2_MAP, UBI_TEO, UF, getUbiPendingChanges, hasPendingReloc, set_UF, set_uAsc, set_uP, set_uRes, set_uSC, uAsc, uP, uRes, uSC } from './state-globals.js';
import { getPriceRow, normCode } from './file-upload.js';
import { pushNavState, updateUFButtons } from './ui-header-tabs.js';
import { _tbSort, matchesQuery } from './buscador.js';
import { cop, cp, escHtml, fmt, getDupUbis, jsAttrSafe, mkPag, noDataRow, pickKeyFromItem, renderPickUI, set, setAlert, togglePickTray } from './utils.js';
import { relocSave } from './cambio-ubicacion.js';
// ═══ js/ubicaciones.js — extraído de index.html (líneas 9336–9618 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== UBICACIONES =====================
function setUF(f){set_UF(f);updateUFButtons();doUbi();}
function doUbi(){
  if(!UBI_TEO.length&&!INV.length){document.getElementById('uBody').innerHTML=noDataRow(6);return;}
  const q=document.getElementById('ubiQ').value.trim().toUpperCase();
  const estF=document.getElementById('uEstante').value.toUpperCase();
  const dupUbis=getDupUbis();
  let res=UBI_TEO.filter(r=>{
    if(UF==='LIBRE'&&r[4]!=='LIBRE')return false;
    if(UF==='OCUPADA'&&r[4]!=='OCUPADA')return false;
    if(UF==='DUP'&&!dupUbis.has(r[0]))return false;
    if(estF&&!r[0].toUpperCase().startsWith(estF))return false;
    if(!q)return true;
    const refU2=r[1]?UBI2_MAP[normCode(r[1])]||'':'';
    return matchesQuery(q, r[0], r[1], r[2], refU2);
  });
  if(UF==='DUP'){
    const expanded=[];const teoSet=new Set(UBI_TEO.map(r=>r[0]));
    for(const ubi of dupUbis){if(estF&&!ubi.toUpperCase().startsWith(estF))continue;const prods=INV.filter(r=>r[3]===ubi);const isTeo=teoSet.has(ubi);for(const p of prods){const row=[ubi,p[0],p[1],p[2],'OCUPADA',isTeo?'teo':'orphan'];if(!q||matchesQuery(q, row[0], row[1], row[2]))expanded.push(row);}}
    expanded.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));res=expanded;
  }
  set_uRes(res);set_uP(1);set('uRes',res.length);
  setAlert('uAlert','',q&&!res.length?'ae':null,`<div style="display:flex;justify-content:space-between;width:100%;align-items:center;"><div>⚠️ Sin resultados para "<b>${escHtml(q)}</b>"</div><button class="upbtn" style="height:24px;font-size:10px;padding:0 10px;" onclick="goBuscador('${jsAttrSafe(q)}')">🔍 Buscar en Buscador</button></div>`);
  document.getElementById('uCard').classList.remove('on');
  if(q&&res.length===1&&res[0][0].toUpperCase()===q)showUbiCard(res[0]);
  else if(q&&UBI_TEO.find(r=>r[0].toUpperCase()===q))showUbiCard(UBI_TEO.find(r=>r[0].toUpperCase()===q));
  renderUbi();
}
function showUbiCard(r){
  document.getElementById('uLoc').textContent=r[0];
  const estado=r[4]==='LIBRE'?'🟢 LIBRE':r[4]==='OCUPADA'?(r[3]>0?'🔵 OCUPADA':'🔴 STOCK=0'):'—';
  document.getElementById('uMeta').innerHTML=`<div class="ubimeta">Estado: <span>${estado}</span></div><div class="ubimeta">Stock: <span>${fmt(r[3])}</span></div>`;
  if(r[1]){const pr=getPriceRow(r[1]);const prStr=pr?` · Mostrador: ${cop(pr[0])}`:'';const u2=UBI2_MAP[normCode(r[1])];const u2tag=u2?`<span style="font-family:var(--mono);font-size:9px;color:var(--amber);opacity:.7;margin-left:6px;cursor:pointer" onclick="goBusUbi('${jsAttrSafe(u2)}','${jsAttrSafe(r[1])}')" title="2ª ubicación (KAIZEN) — clic para ir">+${u2}</span>`:'';document.getElementById('uProd').innerHTML=`<div style="font-family:var(--mono);font-size:10px;color:var(--amber);margin-bottom:4px">${r[1]}${u2tag}</div><div style="font-size:12px;margin-bottom:6px">${r[2]||'(Sin descripción)'}</div><div style="font-family:var(--mono);font-size:10px;color:var(--text2)">${prStr}</div>`;}
  else document.getElementById('uProd').innerHTML='<div style="color:var(--text2);font-size:11px">Ubicación vacía</div>';
  // Mostrar/ocultar área de asignación según estado
  // (antes solo aparecía en LIBRE; ahora también en OCUPADA, para poder
  // añadir otra ref a una ubicación que ya tiene contenido — coexiste con
  // el área de "cambiar ref" de abajo, que sirve para reemplazar en vez de sumar)
  const assignArea=document.getElementById('uCardAssignArea');
  const assignQ=document.getElementById('uCardAssignQ');
  if(assignArea){
    if(r[4]==='LIBRE'||r[4]==='OCUPADA'){
      assignArea.style.display='';
      if(assignQ){assignQ.value='';assignQ.dataset.targetUbi=r[0];}
      renderUCardAssignList('');
    } else {
      assignArea.style.display='none';
    }
  }
  // Mostrar/ocultar área de cambio de contenido (solo si OCUPADA y tiene ref)
  const swapArea=document.getElementById('uCardSwapArea');
  if(swapArea){
    if(r[4]==='OCUPADA'&&r[1]){
      swapArea.style.display='';
      swapArea.dataset.targetUbi=r[0];
      swapArea.dataset.oldCod=r[1];
      swapArea.dataset.oldDesc=r[2]||'';
      swapArea.dataset.oldStock=r[3]||0;
      const sq=document.getElementById('uCardSwapQ');
      if(sq)sq.value='';
      document.getElementById('uCardSwapList').innerHTML='<div style="font-size:10px;color:var(--text3);padding:4px 0">Escribe código o descripción para buscar...</div>';
      document.getElementById('uCardSwapConfirm').style.display='none';
    } else {
      swapArea.style.display='none';
    }
  }
  // ── Indicador de cambios pendientes en esta ubicación ─────────────────
  const uCardChg=document.getElementById('uCardPendingChg');
  if(uCardChg){
    const chg=getUbiPendingChanges(r[0]);
    if(chg){
      const outRows=chg.out.map(x=>`<div style="display:flex;gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="font-family:var(--mono);font-size:9px;color:var(--red)">↑ SALE</span><span style="font-family:var(--mono);font-size:10px;color:var(--amber)">${x.cod}</span><span style="font-size:9px;color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.desc||''}</span><span style="font-family:var(--mono);font-size:9px;color:var(--text3)">→ ${x.ubiNueva}</span></div>`).join('');
      const inRows=chg.in.map(x=>`<div style="display:flex;gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="font-family:var(--mono);font-size:9px;color:var(--green)">↓ ENTRA</span><span style="font-family:var(--mono);font-size:10px;color:var(--amber)">${x.cod}</span><span style="font-size:9px;color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.desc||''}</span><span style="font-family:var(--mono);font-size:9px;color:var(--text3)">← ${x.ubiVieja}</span></div>`).join('');
      uCardChg.innerHTML=`<div style="font-family:var(--mono);font-size:9px;color:var(--cyan);margin-bottom:5px">🔀 CAMBIOS PENDIENTES</div>${outRows}${inRows}`;
      uCardChg.style.display='';
    } else {
      uCardChg.style.display='none';
      uCardChg.innerHTML='';
    }
  }
  document.getElementById('uCard').classList.add('on');
}
function renderUCardAssignList(q){
  const list=document.getElementById('uCardAssignList');
  const targetUbi=document.getElementById('uCardAssignQ')?.dataset.targetUbi||'';
  if(!list)return;
  const q2=(q||'').trim().toUpperCase();
  // Sin búsqueda: mostrar solo las sin ubicación
  // Con búsqueda: mostrar TODAS las refs que coincidan
  let candidates;
  if(!q2){
    candidates=INV.filter(r=>r[3]==='Sin Ubicacion').slice(0,30);
  } else {
    candidates=INV.filter(r=>r[0].includes(q2)||String(r[1]||'').toUpperCase().includes(q2)).slice(0,30);
  }
  if(!candidates.length){
    list.innerHTML=`<div style="font-size:10px;color:var(--text3);padding:4px 0">${q2?'Sin resultados que coincidan':'Sin refs sin ubicación'}</div>`
      +(q2?`<button type="button"
        style="display:flex;align-items:center;gap:6px;width:100%;margin-top:5px;background:rgba(34,212,212,.06);border:1px dashed rgba(34,212,212,.35);border-radius:5px;padding:6px 8px;cursor:pointer;text-align:left"
        onclick='openRelocModalPreFill(${JSON.stringify(q2)},"(sin descripción)","Sin Ubicacion",0,${JSON.stringify(targetUbi)})'>
        <span style="font-family:var(--mono);font-size:10px;color:var(--cyan)">➕</span>
        <span style="font-size:10px;color:var(--text2)">Asignar <span style="font-family:var(--mono);color:var(--amber)">${escHtml(q2)}</span> a esta ubicación (manual)</span>
      </button>`:'');
    return;
  }
  // Footer manual siempre disponible cuando hay búsqueda
  const manualFooter=q2?`<button type="button"
    style="display:flex;align-items:center;gap:6px;width:100%;margin-top:5px;background:rgba(34,212,212,.04);border:1px dashed rgba(34,212,212,.25);border-radius:5px;padding:4px 8px;cursor:pointer;text-align:left"
    onclick='openRelocModalPreFill(${JSON.stringify(q2)},"(sin descripción)","Sin Ubicacion",0,${JSON.stringify(targetUbi)})'>
    <span style="font-family:var(--mono);font-size:9px;color:var(--cyan)">➕</span>
    <span style="font-size:9px;color:var(--text3)">¿No está en inventario? Asignar <span style="font-family:var(--mono);color:var(--amber)">${escHtml(q2)}</span> manualmente</span>
  </button>`:'';
  list.innerHTML=candidates.map(r=>{
    const ubiActual=r[3]&&r[3]!=='Sin Ubicacion'?r[3]:'Sin Ubicacion';
    const tieneUbi=ubiActual!=='Sin Ubicacion';
    const ubiColor=tieneUbi?'var(--cyan)':'var(--text3)';
    const pend=hasPendingReloc(r[0],ubiActual);
    return`<button type="button"
      style="display:flex;align-items:center;gap:6px;width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:4px 8px;cursor:pointer;text-align:left"
      onclick='openRelocModalPreFill(${JSON.stringify(r[0])},${JSON.stringify(r[1]||'')},${JSON.stringify(ubiActual)},${r[2]},${JSON.stringify(targetUbi)})'>
      <span style="font-family:var(--mono);font-size:10px;color:var(--amber);flex-shrink:0">${r[0]}</span>
      <span style="font-size:10px;color:var(--text2);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r[1]||'—'}</span>
      <span style="font-family:var(--mono);font-size:9px;color:${ubiColor};flex-shrink:0">${tieneUbi?ubiActual:'Sin ubi'}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--green);flex-shrink:0">×${r[2]}</span>
      ${pend?'<span style="font-size:8px;color:var(--cyan)">🔀</span>':''}
    </button>`;
  }).join('')+manualFooter;
}

// ── CAMBIO DE CONTENIDO EN UBICACIÓN OCUPADA ──────────────────────────────
let _swapPending=null; // {newCod,newDesc,newUbi,newStock,targetUbi,oldCod,oldDesc,oldStock}

function renderUCardSwapList(q){
  const list=document.getElementById('uCardSwapList');
  const swapArea=document.getElementById('uCardSwapArea');
  if(!list||!swapArea)return;
  const oldCod=swapArea.dataset.oldCod||'';
  const q2=(q||'').trim().toUpperCase();
  if(!q2){list.innerHTML='<div style="font-size:10px;color:var(--text3);padding:4px 0">Escribe código o descripción para buscar...</div>';return;}
  const candidates=INV.filter(r=>r[0]!==oldCod&&(r[0].includes(q2)||String(r[1]||'').toUpperCase().includes(q2))).slice(0,25);
  if(!candidates.length){list.innerHTML='<div style="font-size:10px;color:var(--text3);padding:4px 0">Sin resultados</div>';return;}
  list.innerHTML=candidates.map(r=>{
    const ubiLabel=r[3]&&r[3]!=='Sin Ubicacion'?r[3]:'Sin ubi';
    const ubiColor=r[3]&&r[3]!=='Sin Ubicacion'?'var(--cyan)':'var(--text3)';
    const pend=hasPendingReloc(r[0],r[3]||'Sin Ubicacion');
    return`<button type="button"
      style="display:flex;align-items:center;gap:6px;width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:4px 8px;cursor:pointer;text-align:left"
      onclick='prepareSwapContent(${JSON.stringify(r[0])},${JSON.stringify(r[1]||'')},${JSON.stringify(r[3]||'Sin Ubicacion')},${r[2]||0})'>
      <span style="font-family:var(--mono);font-size:10px;color:var(--amber);flex-shrink:0">${r[0]}</span>
      <span style="font-size:10px;color:var(--text2);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r[1]||'—'}</span>
      <span style="font-family:var(--mono);font-size:9px;color:${ubiColor};flex-shrink:0">${ubiLabel}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--green);flex-shrink:0">×${r[2]||0}</span>
      ${pend?'<span style="font-size:8px;color:var(--cyan)">🔀</span>':''}
    </button>`;
  }).join('');
}

function prepareSwapContent(newCod,newDesc,newUbi,newStock){
  const swapArea=document.getElementById('uCardSwapArea');
  if(!swapArea)return;
  const targetUbi=swapArea.dataset.targetUbi;
  const oldCod=swapArea.dataset.oldCod;
  const oldDesc=swapArea.dataset.oldDesc;
  const oldStock=swapArea.dataset.oldStock;
  _swapPending={newCod,newDesc,newUbi,newStock,targetUbi,oldCod,oldDesc,oldStock};
  const confirmEl=document.getElementById('uCardSwapConfirm');
  const summary=document.getElementById('uCardSwapSummary');
  if(confirmEl&&summary){
    const oldUbiLabel=`<span style="font-family:var(--mono);color:var(--cyan)">${targetUbi}</span>`;
    const oldRefLabel=`<span style="font-family:var(--mono);color:var(--amber)">${oldCod}</span>`;
    const newRefLabel=`<span style="font-family:var(--mono);color:var(--amber)">${newCod}</span>`;
    const srcLabel=newUbi&&newUbi!=='Sin Ubicacion'?`<span style="font-family:var(--mono);color:var(--cyan)">${newUbi}</span>`:`<span style="color:var(--text3)">Sin Ubicación</span>`;
    summary.innerHTML=
      `<div>↩ ${oldRefLabel} sale de ${oldUbiLabel} → <span style="color:var(--text3)">Sin Ubicación</span></div>`+
      `<div>↪ ${newRefLabel} entra de ${srcLabel} → ${oldUbiLabel}</div>`;
    confirmEl.style.display='';
    confirmEl.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
}

function cancelSwapConfirm(){
  _swapPending=null;
  const confirmEl=document.getElementById('uCardSwapConfirm');
  if(confirmEl)confirmEl.style.display='none';
}

function confirmSwapContent(){
  if(!_swapPending)return;
  const{newCod,newDesc,newUbi,newStock,targetUbi,oldCod,oldDesc,oldStock}=_swapPending;
  const now=Date.now();
  // 1. Desplazar ref actual fuera de la ubicación → Sin Ubicación
  const keyOld=oldCod+'||'+targetUbi;
  RELOC_LIST.set(keyOld,{cod:oldCod,desc:oldDesc,ubiVieja:targetUbi,ubiNueva:'Sin Ubicacion',stock:Number(oldStock)||0,ts:now});
  // 2. Mover nueva ref a esta ubicación
  const keyNew=newCod+'||'+(newUbi||'Sin Ubicacion');
  RELOC_LIST.set(keyNew,{cod:newCod,desc:newDesc,ubiVieja:newUbi||'Sin Ubicacion',ubiNueva:targetUbi,stock:Number(newStock)||0,ts:now});
  relocSave();
  _swapPending=null;
  // Limpiar UI
  const confirmEl=document.getElementById('uCardSwapConfirm');
  const swapQ=document.getElementById('uCardSwapQ');
  const swapList=document.getElementById('uCardSwapList');
  if(confirmEl)confirmEl.style.display='none';
  if(swapQ)swapQ.value='';
  if(swapList)swapList.innerHTML='<div style="font-size:10px;color:var(--text3);padding:4px 0">Escribe código o descripción para buscar...</div>';
  renderPickUI();
  // Animación en el FAB de lista
  const fab=document.getElementById('pickFab');
  if(fab){fab.classList.remove('bump');void fab.offsetWidth;fab.classList.add('bump');setTimeout(()=>fab.classList.remove('bump'),300);}
  if(!PICK_TRAY_OPEN)togglePickTray(true);
}
// ─────────────────────────────────────────────────────────────────────────────

function renderUbi(){
  const dupUbis=getDupUbis();
  const tot=uRes.length,s=(uP-1)*PG,e=Math.min(s+PG,tot),pg=uRes.slice(s,e);
  if(!tot){
    document.getElementById('uBody').innerHTML=`<tr><td colspan="7" style="border:0"><div class="empty"><div class="ei">📍</div><div class="em">${UBI_TEO.length?'Sin resultados':'Carga un Excel para ver ubicaciones'}</div></div></td></tr>`;
    document.getElementById('uPag').style.display='none';
    return;
  }
  document.getElementById('uBody').innerHTML=pg.map((r,i)=>{
    const rowId=r[0];
    const isOrphan=r[5]==='orphan';
    const stDot=r[4]==='LIBRE'?'lib':r[3]>0?'ocu':'nostock';
    const stText=r[4]==='LIBRE'?'LIBRE':r[3]>0?'OCUPADA':'STOCK=0';
    const stColor=r[4]==='LIBRE'?'var(--text3)':r[3]>0?'var(--green)':'var(--red)';
    const isDup=dupUbis.has(r[0]);
    const dupBadge=isDup?`<span style="font-family:var(--mono);font-size:8px;font-weight:700;color:var(--purple);background:rgba(155,109,255,.15);border:1px solid rgba(155,109,255,.3);border-radius:3px;padding:1px 5px;margin-left:5px;vertical-align:middle">DUP</span>`:'';
    const teoBadge=isOrphan?`<span style="font-family:var(--mono);font-size:8px;font-weight:700;color:var(--amber);background:rgba(232,156,32,.12);border:1px solid rgba(232,156,32,.3);border-radius:3px;padding:1px 5px;margin-left:5px;vertical-align:middle" title="Sin registro en UBI TEÓRICAS">SIN TEO</span>`:'';
    // ── Badges de cambios pendientes ──────────────────────────────────────
    const chg=getUbiPendingChanges(r[0]);
    const saleBadge=chg?.out?.length?`<span style="font-family:var(--mono);font-size:8px;font-weight:700;color:var(--red);background:rgba(232,64,64,.12);border:1px solid rgba(232,64,64,.35);border-radius:3px;padding:1px 5px;margin-left:5px;vertical-align:middle" title="${chg.out.map(x=>x.cod+' → '+x.ubiNueva).join(', ')}">↑ SALE</span>`:'';
    const entraBADGE=chg?.in?.length?`<span style="font-family:var(--mono);font-size:8px;font-weight:700;color:var(--green);background:rgba(31,199,106,.12);border:1px solid rgba(31,199,106,.35);border-radius:3px;padding:1px 5px;margin-left:5px;vertical-align:middle" title="${chg.in.map(x=>x.cod+' ← '+x.ubiVieja).join(', ')}">↓ ENTRA</span>`:'';
    const rowBg=chg?'background:rgba(34,212,212,.04)':isOrphan?'background:rgba(232,156,32,.04)':isDup?'background:rgba(155,109,255,.04)':'';
    const pr=r[1]?getPriceRow(r[1]):null;
    const pickKey=r[1]?pickKeyFromItem({cod:r[1],desc:r[2]||'',ubi:r[0],stock:r[3],price:pr?pr[0]:null}):'';
    const picked=pickKey?PICKLIST.has(pickKey):false;
    const pickBtn=pickKey
      ?`<button type="button" class="pickrowbtn ${picked?'on':'off'}" data-pick-key="${pickKey}" onclick='event.stopPropagation();togglePick(${JSON.stringify({cod:r[1],desc:r[2]||"",stock:r[3],ubi:r[0],price:pr?pr[0]:null})},this)' title="${picked?'Quitar de la selección':'Agregar a la selección'}">${picked?'✓':'+'}</button>`
      :'';
    return`<tr data-rowid="${rowId}" data-pick-key="${pickKey}" class="${picked?'picked':''}"${rowBg?' style="'+rowBg+'"':''}>
      <td>${pickBtn}</td>
      <td class="tcode" style="color:var(--cyan);cursor:pointer" onclick="focusUbi('${jsAttrSafe(r[0])}')"><span style="white-space:nowrap">${r[0]}${dupBadge}${teoBadge}${saleBadge}${entraBADGE}</span>
        <button class="suglink" onclick='event.stopPropagation();openSuggestModal(${JSON.stringify(r[1]||r[0])},${JSON.stringify(r[2]||'')},${JSON.stringify(rowId)})' title="Sugerir ubicación">🎯</button>
      </td>
      <td class="tcode"${r[1]?` style="cursor:pointer" onclick="openRefDetailFromPrec('${jsAttrSafe(r[1])}','${jsAttrSafe(r[2]||'')}')"`:''}>${r[1]?r[1]+''+cp(r[1]):'—'}</td>
      <td class="tdesc">${r[2]||'—'}</td>
      <td class="tnum ${r[3]>0?'pos':'zero'}">${r[4]==='LIBRE'?'—':fmt(r[3])}</td>
      <td><span class="ustat ${stDot}"></span><span style="font-family:var(--mono);font-size:9px;color:${stColor}">${stText}</span></td>
      <td>${r[1]?`<button class="prlink" onclick="goPrecio('${jsAttrSafe(r[1])}')">💰</button>`:'—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('uPI').textContent=`${s+1}–${e} de ${tot}`;
  mkPag('uPag','uPB',Math.ceil(tot/PG),uP,p=>{set_uP(p);renderUbi();});
  const usa=document.getElementById('uSelAll');if(usa)usa.checked=false;
}

function focusUbi(loc){
  pushNavState(loc);
  // Busca la fila exacta en UBI_TEO para mostrar la card de detalle
  const r=UBI_TEO.find(u=>u[0].toUpperCase()===loc.toUpperCase());
  if(r){
    showUbiCard(r);
    // Scroll suave al card sin re-filtrar la tabla
    const card=document.getElementById('uCard');
    if(card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
}
function uSort(col){_tbSort(col,()=>uAsc,v=>{set_uAsc(v);},()=>uSC,v=>{set_uSC(v);},v=>{set_uP(v);},uRes,'usa',4,null,renderUbi);}
// Igual que doSort() para el Buscador: aplica el orden y además sincroniza
// los botones de la barra de orden móvil (solo visible en ≤640px).
function uSortMob(col){
  uSort(col);
  [0,1,2,3].forEach(i=>{
    const btn=document.getElementById('umsa'+i);
    if(!btn)return;
    btn.classList.remove('mob-sort-asc','mob-sort-desc');
    if(i===uSC) btn.classList.add(uAsc?'mob-sort-asc':'mob-sort-desc');
  });
}
function clearUbi(){document.getElementById('ubiQ').value='';document.getElementById('uCard').classList.remove('on');setAlert('uAlert');renderUbi();}

export { cancelSwapConfirm, clearUbi, confirmSwapContent, doUbi, focusUbi, prepareSwapContent, renderUCardAssignList, renderUCardSwapList, renderUbi, setUF, uSort, uSortMob };
