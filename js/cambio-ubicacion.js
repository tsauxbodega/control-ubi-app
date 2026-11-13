import { relocSaveCloud } from './cloud-sync.js';
import { INV, PICK_TRAY_OPEN, RELOC_KEY, RELOC_LIST, UF, _relocBulkCods, _relocTarget, set_RELOC_LIST, set__relocBulkCods, set__relocTarget } from './state-globals.js';
import { doUbi, renderUbi } from './ubicaciones.js';
import { escHtml, jsAttrSafe, renderPickUI, togglePickTray } from './utils.js';
// ═══ js/cambio-ubicacion.js — extraído de index.html (líneas 15403–15560 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ── CAMBIO DE UBICACIÓN ─────────────────────────────────────────────────────
// modo individual: cod/desc/ubiVieja/stock son scalars
// modo lote:       _relocBulkCods=[{cod,desc,ubiVieja,stock}, ...]  y los params se ignoran
function openRelocModal(cod,desc,ubiVieja,stock){
  set__relocBulkCods(null);
  set__relocTarget({cod,desc,ubiVieja,stock});
  const cEl=document.getElementById('relocCode');
  const fEl=document.getElementById('relocFrom');
  const inp=document.getElementById('relocInput');
  const isSin=!ubiVieja||ubiVieja==='Sin Ubicacion';
  if(cEl)cEl.textContent=cod;
  if(fEl){fEl.textContent=isSin?'Sin Ubicación':ubiVieja;fEl.style.color=isSin?'var(--text3)':'';}
  document.getElementById('relocBulkInfo').style.display='none';
  document.getElementById('relocSingleInfo').style.display='';
  if(inp){inp.value='';inp.focus();}
  renderRelocShelves('');
  document.getElementById('relocOverlay').classList.add('on');
  setTimeout(()=>document.getElementById('relocInput')?.focus(),80);
}
function openRelocModalBulk(items){ // items=[{cod,desc,ubiVieja,stock}]
  set__relocTarget(null);
  set__relocBulkCods(items);
  const inp=document.getElementById('relocInput');
  document.getElementById('relocBulkInfo').style.display='';
  document.getElementById('relocBulkCount').textContent=items.length;
  document.getElementById('relocSingleInfo').style.display='none';
  if(inp){inp.value='';}
  renderRelocShelves('');
  document.getElementById('relocOverlay').classList.add('on');
  setTimeout(()=>document.getElementById('relocInput')?.focus(),80);
}
function closeRelocModal(){
  document.getElementById('relocOverlay').classList.remove('on');
  set__relocTarget(null);
  set__relocBulkCods(null);
}
function renderRelocShelves(q){
  const list=document.getElementById('relocShelfList');
  if(!list)return;
  const q2=(q||'').trim().toUpperCase();
  const allUbis=[...new Set(INV.map(r=>r[3]).filter(u=>u&&u!=='Sin Ubicacion'))].sort();
  const vieja=_relocTarget?.ubiVieja||'';
  const filtered=(q2?allUbis.filter(u=>u.includes(q2)):allUbis).filter(u=>u!==vieja).slice(0,40);
  list.innerHTML=filtered.map(u=>`<button class="reloc-shelf-chip" type="button" onclick="selectRelocShelf('${jsAttrSafe(u)}')">${escHtml(u)}</button>`).join('');
}
function selectRelocShelf(name){
  const inp=document.getElementById('relocInput');
  if(inp){inp.value=name;}
  document.querySelectorAll('.reloc-shelf-chip').forEach(c=>c.classList.toggle('active',c.textContent===name));
}
function confirmReloc(){
  const inp=document.getElementById('relocInput');
  const ubiNueva=(inp?.value||'').trim().toUpperCase();
  if(!ubiNueva){inp?.focus();return;}
  const now=Date.now();
  if(_relocBulkCods&&_relocBulkCods.length){
    _relocBulkCods.forEach(({cod,desc,ubiVieja,stock})=>{
      const key=cod+'||'+(ubiVieja||'Sin Ubicacion');
      RELOC_LIST.set(key,{cod,desc,ubiVieja:ubiVieja||'Sin Ubicacion',ubiNueva,stock,ts:now});
    });
  } else if(_relocTarget){
    const {cod,desc,ubiVieja,stock}=_relocTarget;
    const key=cod+'||'+(ubiVieja||'Sin Ubicacion');
    RELOC_LIST.set(key,{cod,desc,ubiVieja:ubiVieja||'Sin Ubicacion',ubiNueva,stock,ts:now});
  } else return;
  relocSave();
  closeRelocModal();
  renderPickUI();
  const fab=document.getElementById('pickFab');
  if(fab){fab.classList.remove('bump');void fab.offsetWidth;fab.classList.add('bump');setTimeout(()=>fab.classList.remove('bump'),300);}
  if(!PICK_TRAY_OPEN)togglePickTray(true);
}
function removeRelocByKey(key){
  if(!RELOC_LIST.has(key))return;
  RELOC_LIST.delete(key);
  relocSave();
  renderPickUI();
}
function clearRelocList(){
  if(!RELOC_LIST.size)return;
  if(!confirm(`¿Limpiar los ${RELOC_LIST.size} cambio${RELOC_LIST.size===1?'':'s'} de ubicación pendientes?`))return;
  RELOC_LIST.clear();
  relocSave();
  renderPickUI();
}
function relocSave(){
  try{localStorage.setItem(RELOC_KEY,JSON.stringify([...RELOC_LIST.values()]));}catch(e){}
  relocSaveCloud(); // sincroniza con todas las cuentas (equipo/reloc_list en Firestore)
  // Refrescar grid de ubicaciones para que los badges ↑SALE / ↓ENTRA aparezcan al instante
  if(document.getElementById('uBody')){
    if(document.getElementById('ubiQ')?.value.trim()||document.getElementById('uEstante')?.value||UF!=='ALL') doUbi(); else renderUbi();
  }
}
function relocLoad(){
  try{
    const raw=localStorage.getItem(RELOC_KEY);
    if(!raw)return;
    const arr=JSON.parse(raw);
    if(!Array.isArray(arr))return;
    set_RELOC_LIST(new Map());
    arr.forEach(it=>{if(!it?.cod)return;RELOC_LIST.set(it.cod+'||'+it.ubiVieja,it);});
  }catch(e){}
}
function moveRelocItem(key,dir){
  const entries=[...RELOC_LIST.entries()];
  const idx=entries.findIndex(([k])=>k===key);
  if(idx<0)return;
  const swapIdx=idx+dir;
  if(swapIdx<0||swapIdx>=entries.length)return;
  // Swap
  [entries[idx],entries[swapIdx]]=[entries[swapIdx],entries[idx]];
  set_RELOC_LIST(new Map(entries));
  relocSave();
  renderPickUI();
}

function _buildRelocText(){
  const arr=[...RELOC_LIST.values()];
  if(!arr.length)return null;
  const date=new Date().toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});
  const sep='─'.repeat(32);
  return [
    '🔀 CAMBIOS DE UBICACIÓN',
    `📅 ${date}`,
    sep,
    ...arr.map((it,i)=>{
      const n=String(i+1).padStart(2,' ');
      const cod=(it.cod||'—').padEnd(14,' ');
      const stk=`×${it.stock||0}`;
      return `${n}. ${cod} ${stk}\n    ${it.ubiVieja||'—'} → ${it.ubiNueva||'—'}\n    ${it.desc||''}`;
    }),
    sep,
    `Total: ${arr.length} cambio${arr.length===1?'':'s'}`
  ].join('\n');
}

function shareRelocList(){
  const txt=_buildRelocText();
  if(!txt)return;
  if(navigator.share){
    navigator.share({title:'Cambios de Ubicación',text:txt}).catch(()=>{});
  } else {
    navigator.clipboard.writeText(txt).then(()=>{
      const btn=document.querySelector('.picktray-btn[onclick*="shareRelocList"]');
      if(btn){const old=btn.textContent;btn.textContent='¡Copiado!';setTimeout(()=>btn.textContent=old,1400);}
    }).catch(()=>{});
  }
}

function copyRelocList(){
  const txt=_buildRelocText();
  if(!txt)return;
  navigator.clipboard.writeText(txt).then(()=>{
    const btn=document.getElementById('copyRelocBtn');
    if(btn){const old=btn.textContent;btn.textContent='¡Copiado!';setTimeout(()=>btn.textContent=old,1200);}
  }).catch(()=>{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}ta.remove();});
}

export { clearRelocList, closeRelocModal, confirmReloc, copyRelocList, moveRelocItem, openRelocModal, relocLoad, relocSave, removeRelocByKey, renderRelocShelves, selectRelocShelf, shareRelocList };
