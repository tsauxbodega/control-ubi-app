import { cloudSave, ukey } from './cloud-sync.js';
import { INV, PICKLIST, PICKLIST_KEY, PICK_MAX_AGE_MS, PICK_MAX_BYTES, PICK_MAX_ITEMS, PICK_TRAY_OPEN, RELOC_LIST, _dupUbisCache, set_PICKLIST, set_PICK_TRAY_OPEN, set__dupUbisCache } from './state-globals.js';
import { normCode } from './file-upload.js';
// ═══ js/utils.js — extraído de index.html (líneas 10618–10980 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== PAGINATION =====================
function mkPag(pagId,btnId,total,cur,cb){
  const container=document.getElementById(btnId);if(!container)return;
  if(total<=1){container.innerHTML='';document.getElementById(pagId).style.display='none';return;}
  container._pagCb=cb;
  let h=`<button class="pbtn" ${cur<=1?'disabled':''} data-page="1">«</button>`;
  h+=`<button class="pbtn" ${cur<=1?'disabled':''} data-page="${cur-1}">‹</button>`;
  let st=Math.max(1,cur-2),en=Math.min(total,cur+2);
  if(st>1)h+=`<button class="pbtn" data-page="1">1</button>`;
  if(st>2)h+='<span style="padding:0 3px;color:var(--text3)">…</span>';
  for(let p=st;p<=en;p++)h+=`<button class="pbtn ${p===cur?'act':''}" data-page="${p}">${p}</button>`;
  if(en<total-1)h+='<span style="padding:0 3px;color:var(--text3)">…</span>';
  if(en<total)h+=`<button class="pbtn" data-page="${total}">${total}</button>`;
  h+=`<button class="pbtn" ${cur>=total?'disabled':''} data-page="${cur+1}">›</button>`;
  h+=`<button class="pbtn" ${cur>=total?'disabled':''} data-page="${total}">»</button>`;
  container.innerHTML=h;document.getElementById(pagId).style.display='flex';
}

// ===================== UTILS =====================
function gid(id){return document.getElementById(id);}
function set(id,v){const el=gid(id);if(el)el.textContent=v;}
function fmt(n){return(n%1===0)?n:Number(n).toFixed(2);}
const _copFmt=new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2});
function cop(n){return '$\u202f'+_copFmt.format(Number(n));}
function cmp(a,b,asc){
  if(typeof a==='string'&&typeof b==='string'){a=a.toUpperCase();b=b.toUpperCase();}
  if(a===null||a===undefined)a=asc?'\uffff':'';
  if(b===null||b===undefined)b=asc?'\uffff':'';
  return asc?(a<b?-1:a>b?1:0):(a>b?-1:a<b?1:0);
}
function resetArrows(prefix,n){for(let i=0;i<n;i++){const el=gid(prefix+i);if(el)el.textContent='';}}
function setAlert(id,cls,show,txt){
  const el=gid(id);if(!el)return;
  if(show&&txt){el.className='alert on '+(cls||'alw');el.innerHTML=txt;}
  else el.className='alert';
}
let _hlRe=null,_hlQ=null;
function hl(text,q,mode){
  if(!q||mode==='EXA'||!text)return text;
  try{
    if(_hlQ!==q){ _hlRe=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'); _hlQ=q; }
    return text.replace(_hlRe,m=>'<span class="hl">'+m+'</span>');
  }
  catch(e){return text;}
}

function escHtml(v){
  return String(v??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
// Seguro para usar dentro de onclick="fn('${...}')": primero escapa como
// string de JS (comilla simple, backslash y saltos de línea — un valor
// con un salto de línea real, p. ej. una descripción pegada de Excel,
// rompe un string de una sola comilla igual que una comilla suelta) y ESE
// resultado se vuelve a escapar como valor de atributo HTML. Si solo se
// hiciera lo primero, un valor con comillas dobles (frecuente en
// descripciones con medidas en pulgadas, p. ej. 3") rompe el atributo
// HTML antes de que el navegador llegue a interpretarlo como JS — por eso
// reemplaza a jsSafe()/escJs(), que solo cubrían la comilla simple.
function jsAttrSafe(s){
  const jsEscaped = String(s??'')
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/\r\n|\r|\n/g,'\\n')
    .replace(/\u2028/g,'\\u2028')
    .replace(/\u2029/g,'\\u2029');
  return escHtml(jsEscaped);
}

function pickKeyFromItem(it){
  const cod=normCode(it?.cod);
  const ubi=String(it?.ubi??'').trim().toUpperCase();
  const desc=String(it?.desc??'').trim().toUpperCase();
  return [cod,ubi,desc].join('||');
}
function pickLoadLocal(){
  try{
    const raw=localStorage.getItem(ukey(PICKLIST_KEY));
    if(!raw)return;
    const arr=JSON.parse(raw);
    if(!Array.isArray(arr))return;
    const cutoff=Date.now()-PICK_MAX_AGE_MS;
    set_PICKLIST(new Map());
    arr.forEach(it=>{
      if(!it)return;
      // Purgar ítems sin timestamp o más viejos que 30 días
      if(it.ts && it.ts < cutoff) return;
      const key=pickKeyFromItem(it);
      if(key)PICKLIST.set(key,{
        cod:String(it.cod??'').trim(),
        desc:String(it.desc??'').trim(),
        stock:Number(it.stock??0),
        ubi:String(it.ubi??'').trim(),
        price:it.price===null||it.price===undefined||it.price===''?null:Number(it.price),
        ts:it.ts||Date.now()
      });
    });
  }catch(e){}
}
function pickLoad(){ pickLoadLocal(); } // compatibilidad; la carga real por usuario ocurre en hydrateUserCloudData()
function pickSave(){
  try{
    // 1. Límite de ítems: si supera PICK_MAX_ITEMS, eliminar los más viejos
    if(PICKLIST.size > PICK_MAX_ITEMS){
      const sorted=[...PICKLIST.entries()].sort((a,b)=>(a[1].ts||0)-(b[1].ts||0));
      const toRemove=sorted.slice(0, PICKLIST.size - PICK_MAX_ITEMS);
      toRemove.forEach(([k])=>PICKLIST.delete(k));
    }
    // 2. Límite de tamaño: si supera PICK_MAX_BYTES, recortar hasta entrar
    let data=JSON.stringify([...PICKLIST.values()]);
    if(data.length > PICK_MAX_BYTES){
      const byAge=[...PICKLIST.entries()].sort((a,b)=>(a[1].ts||0)-(b[1].ts||0));
      let i=0;
      while(data.length > PICK_MAX_BYTES && PICKLIST.size > 0 && i<byAge.length){
        PICKLIST.delete(byAge[i][0]);
        i++;
        data=JSON.stringify([...PICKLIST.values()]);
      }
    }
    localStorage.setItem(ukey(PICKLIST_KEY), data);
  }catch(e){}
  cloudSave('picklist',[...PICKLIST.values()]);
}
function syncPickRowUI(key,selected){
  // Solo botones — nunca <tr> ni otros elementos que también puedan tener data-pick-key
  document.querySelectorAll('button[data-pick-key]').forEach(btn=>{
    if(btn.dataset.pickKey!==key)return;
    btn.textContent=selected?'✓':'+';
    btn.classList.toggle('on',selected);
    btn.classList.toggle('off',!selected);
    btn.title=selected?'Quitar de la selección':'Agregar a la selección';
  });
  // Actualizar clase de fila (funciona tanto con <tr data-rowid data-pick-key> como sin él)
  document.querySelectorAll('tr[data-rowid]').forEach(tr=>{
    if(tr.dataset.pickKey!==key)return;
    tr.classList.toggle('picked',selected);
  });
}
function renderPickUI(){
  const count=PICKLIST.size;
  const total=count+RELOC_LIST.size;
  const countEl=document.getElementById('pickCount');
  if(countEl){
    countEl.textContent=total;
    countEl.classList.toggle('zero',total===0);
  }
  const sub=document.getElementById('pickTraySub');
  const title=document.getElementById('pickTrayTitle');
  const body=document.getElementById('pickTrayBody');
  if(sub){
    const near = count >= PICK_MAX_ITEMS * 0.85;
    sub.textContent = count
      ? `${count} ref${count===1?'':'s'}${RELOC_LIST.size?` · ${RELOC_LIST.size} cambio${RELOC_LIST.size===1?'':'s'} de ubi`:''}${near ? ` · ⚠️ Cerca del límite (${PICK_MAX_ITEMS})` : ''}`
      : RELOC_LIST.size?`${RELOC_LIST.size} cambio${RELOC_LIST.size===1?'':'s'} de ubicación pendiente${RELOC_LIST.size===1?'':'s'}`:'0 elementos guardados';
    sub.style.color = near ? 'var(--amber)' : '';
  }
  if(title)title.textContent=count?`Lista de refs seleccionadas (${count})`:'Lista de refs seleccionadas';
  if(!body)return;
  // Picklist section
  let pickHtml='';
  if(!count){
    pickHtml=`<div class="pick-empty"><div class="pei">🧺</div><div class="pem">Tray vacío</div><div class="pes">Usa ＋ en cualquier fila para agregar refs, o el checkbox del encabezado para seleccionar toda la página</div></div>`;
  } else {
    const rows=[...PICKLIST.values()].map(it=>{
      const code=escHtml(it.cod||'—');
      const desc=escHtml(it.desc||'—');
      const stock=escHtml(fmt(Number(it.stock||0)));
      const ubi=escHtml(it.ubi||'—');
      const rawP=it.price;
      const price=rawP===null||rawP===undefined||rawP===''||Number.isNaN(Number(rawP))?'—':cop(Number(rawP))+' <span style="font-size:8px;opacity:.6">c/IVA</span>';
      const key=pickKeyFromItem(it);
      const safeCode=escHtml(it.cod||'');
      return `<div class="pickitem" data-pick-key="${escHtml(key)}">
        <div class="pcode" style="display:flex;align-items:center;gap:4px">${code}<button class="pcpy-sm" type="button" onclick="copyCode('${jsAttrSafe(safeCode)}',this)" title="Copiar código">⎘</button></div>
        <div class="pdesc">${desc}</div>
        <div class="pstk">${stock}</div>
        <div class="pubi">${ubi}</div>
        <div class="pprc">${price}</div>
        <button class="prem" type="button" data-rem-key="${escHtml(key)}" title="Quitar">×</button>
      </div>`;
    }).join('');
    pickHtml=`<div class="picklist">${rows}<div class="pickbar"><div class="pickhint">La lista se guarda en esta sesión del navegador.</div><div class="pickhint">${count} ítem${count===1?'':'s'}</div></div></div>`;
  }
  // Reloc section
  let relocHtml='';
  if(RELOC_LIST.size){
    const relocEntries=[...RELOC_LIST.entries()];
    const relocRows=relocEntries.map(([key,it],idx)=>`
      <div class="relocitem">
        <div style="display:flex;flex-direction:column;gap:1px;margin-right:4px;flex-shrink:0">
          <button type="button" title="Subir" onclick="moveRelocItem('${jsAttrSafe(key)}',-1)"
            style="width:16px;height:14px;font-size:9px;line-height:1;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text3);cursor:pointer;padding:0;${idx===0?'opacity:.25;pointer-events:none':''}">▲</button>
          <button type="button" title="Bajar" onclick="moveRelocItem('${jsAttrSafe(key)}',1)"
            style="width:16px;height:14px;font-size:9px;line-height:1;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text3);cursor:pointer;padding:0;${idx===relocEntries.length-1?'opacity:.25;pointer-events:none':''}">▼</button>
        </div>
        <div class="relocitem-code" style="display:flex;align-items:center;gap:4px">${escHtml(it.cod||'—')}<button class="pcpy-sm" type="button" onclick="copyCode('${jsAttrSafe(it.cod||'')}',this)" title="Copiar código">⎘</button></div>
        <div class="relocitem-desc">${escHtml(it.desc||'—')}</div>
        <div class="relocitem-move">
          <span class="relocitem-old">${escHtml(it.ubiVieja||'—')}</span>
          <span class="relocitem-arr">→</span>
          <span class="relocitem-new">${escHtml(it.ubiNueva||'—')}</span>
        </div>
        <button class="relocitem-rem" type="button" data-reloc-key="${escHtml(key)}" title="Quitar">×</button>
      </div>`).join('');
    relocHtml=`<div class="reloc-tray-section">
      <div class="reloc-tray-hdr">
        <span>🔀 CAMBIOS DE UBICACIÓN (${RELOC_LIST.size})</span>
        <div class="reloc-tray-acts">
          <button id="copyRelocBtn" class="picktray-btn" type="button" onclick="copyRelocList()" style="font-size:9px;height:22px;padding:0 7px">Copiar</button>
          <button class="picktray-btn" type="button" onclick="shareRelocList()" style="font-size:9px;height:22px;padding:0 7px">Compartir</button>
          <button class="picktray-btn" type="button" onclick="clearRelocList()" style="font-size:9px;height:22px;padding:0 7px">Limpiar</button>
        </div>
      </div>
      ${relocRows}
    </div>`;
  }
  body.innerHTML=pickHtml+relocHtml;
}
function togglePickTray(force){
  const tray=document.getElementById('pickTray');
  if(!tray)return;
  const open=typeof force==='boolean'?force:!PICK_TRAY_OPEN;
  set_PICK_TRAY_OPEN(open);
  tray.classList.toggle('open',open);
  tray.setAttribute('aria-hidden',String(!open));
  if(open)renderPickUI();
}
function togglePick(item,btn){
  const key=pickKeyFromItem(item);
  if(!key)return;
  const exists=PICKLIST.has(key);
  if(exists)PICKLIST.delete(key);
  else PICKLIST.set(key,{
    cod:String(item.cod??'').trim(),
    desc:String(item.desc??'').trim(),
    stock:Number(item.stock??0),
    ubi:String(item.ubi??'').trim(),
    price:item.price===null||item.price===undefined||item.price===''?null:Number(item.price),
    ts:Date.now()
  });
  pickSave();
  syncPickRowUI(key,!exists);
  renderPickUI();
  if(!exists){const fab=document.getElementById('pickFab');if(fab){fab.classList.remove('bump');void fab.offsetWidth;fab.classList.add('bump');setTimeout(()=>fab.classList.remove('bump'),300);}}
}
function removePickByKey(key){
  if(!PICKLIST.has(key))return;
  PICKLIST.delete(key);
  pickSave();
  syncPickRowUI(key,false);
  renderPickUI();
}
function toggleSelectAll(tbodyId, checked){
  const tbody = document.getElementById(tbodyId);
  if(!tbody) return;
  tbody.querySelectorAll('.pickrowbtn').forEach(btn => {
    const key = btn.dataset.pickKey;
    if(!key) return;
    const isOn = btn.classList.contains('on');
    if(checked && !isOn) btn.click();
    else if(!checked && isOn) btn.click();
  });
}
function clearPicklist(){
  if(!PICKLIST.size)return;
  if(!confirm(`¿Limpiar la selección? (${PICKLIST.size} referencia${PICKLIST.size===1?'':'s'})`))return;
  PICKLIST.clear();
  pickSave();
  document.querySelectorAll('button[data-pick-key]').forEach(btn=>{
    btn.textContent='+';
    btn.classList.remove('on');
    btn.classList.add('off');
    btn.title='Agregar a la selección';
  });
  document.querySelectorAll('tr[data-rowid]').forEach(tr=>tr.classList.remove('picked'));
  renderPickUI();
}
function _buildPicklistText(){
  const arr=[...PICKLIST.values()];
  if(!arr.length)return null;
  const date=new Date().toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});
  const sep='─'.repeat(32);
  const lines=[
    '📋 LISTA DE SELECCIÓN',
    `📅 ${date}`,
    sep,
    ...arr.map((it,i)=>{
      const n=String(i+1).padStart(2,' ');
      const cod=(it.cod||'—').padEnd(14,' ');
      const stk=`×${fmt(Number(it.stock||0))}`;
      const prc=it.price!=null&&it.price!==''?`  ${cop(Number(it.price))}`:'';
      const ubi=it.ubi&&it.ubi!=='Sin Ubicacion'?`\n    📍 ${it.ubi}`:'';
      return `${n}. ${cod} ${stk}${prc}\n    ${it.desc||'—'}${ubi}`;
    }),
    sep,
    `Total: ${arr.length} referencia${arr.length===1?'':'s'}`
  ].join('\n');
  return lines;
}

function copyPicklist(){
  const txt=_buildPicklistText();
  if(!txt)return;
  navigator.clipboard.writeText(txt).then(()=>{
    const btn=document.querySelector('.picktray-btn.primary');
    if(btn){const old=btn.textContent;btn.textContent='¡Copiado!';setTimeout(()=>{btn.textContent=old;},1200);}
  }).catch(()=>{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}ta.remove();});
}

function sharePicklist(){
  const txt=_buildPicklistText();
  if(!txt)return;
  if(navigator.share){
    navigator.share({title:'Lista de Selección',text:txt}).catch(()=>{});
  } else {
    navigator.clipboard.writeText(txt).then(()=>{
      const btn=document.querySelector('.picktray-btn[onclick*="sharePicklist"]');
      if(btn){const old=btn.textContent;btn.textContent='¡Copiado!';setTimeout(()=>btn.textContent=old,1400);}
    }).catch(()=>{});
  }
}

function noDataRow(cols){return`<tr><td colspan="${cols}" style="border:0"><div class="empty"><div class="ei">📭</div><div class="em">Carga un Excel para ver datos</div></div></td></tr>`;}
function getDupUbis(){
  if(_dupUbisCache)return _dupUbisCache;
  const counts={};
  for(const r of INV){if(r[3]&&r[3]!=='Sin Ubicacion')counts[r[3]]=(counts[r[3]]||0)+1;}
  set__dupUbisCache(new Set(Object.keys(counts).filter(k=>counts[k]>1)));
  return _dupUbisCache;
}
let _dupCodsCache=null;
function getDupCods(){
  // Códigos que aparecen en >1 ubicación física
  if(_dupCodsCache)return _dupCodsCache;
  const ubis={};
  for(const r of INV){
    if(r[3]&&r[3]!=='Sin Ubicacion'){
      if(!ubis[r[0]])ubis[r[0]]=new Set();
      ubis[r[0]].add(r[3]);
    }
  }
  _dupCodsCache=new Set(Object.keys(ubis).filter(k=>ubis[k].size>1));
  return _dupCodsCache;
}
function copySugProdCode(){
  const el=document.getElementById('sugProdCode');
  const code=el?.dataset?.code||'';
  if(!code)return;
  copyCode(code, document.getElementById('sugProdCopyBtn'));
}
function copyCode(cod,btn){
  navigator.clipboard.writeText(cod).then(()=>{btn.textContent='✓';btn.classList.add('copied');setTimeout(()=>{btn.textContent='⎘';btn.classList.remove('copied');},1200);}).catch(()=>{const ta=document.createElement('textarea');ta.value=cod;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);btn.textContent='✓';btn.classList.add('copied');setTimeout(()=>{btn.textContent='⎘';btn.classList.remove('copied');},1200);});
}
function cp(cod){return cod?`<button class="cpbtn" title="Copiar código" onclick="event.stopPropagation();copyCode('${jsAttrSafe(cod)}',this)">⎘</button>`:'';}
// Botón inline "Ver imágenes" para filas de tablas (mismo estilo que cp()).
// stopPropagation: evita que también dispare el onclick de la celda (ej.
// selectPrecRef en la tabla de Precios).
function imgBtn(cod,desc){return cod?`<button class="cpbtn" title="Ver imágenes" onclick="event.stopPropagation();openRefDetailFromPrec('${jsAttrSafe(cod)}','${jsAttrSafe(desc||'')}');rdShowImages()">🖼️</button>`:'';}

export { _dupCodsCache, clearPicklist, cmp, cop, copyCode, copyPicklist, copySugProdCode, cp, escHtml, fmt, getDupUbis, gid, hl, imgBtn, jsAttrSafe, mkPag, noDataRow, pickKeyFromItem, pickLoadLocal, pickSave, removePickByKey, renderPickUI, resetArrows, set, setAlert, sharePicklist, togglePick, togglePickTray, toggleSelectAll };
export const set__dupCodsCache = (v) => (_dupCodsCache = v);
