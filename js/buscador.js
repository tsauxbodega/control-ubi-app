import { ACTIVE_BODEGA, bodegaName } from './config.js';
import { BM, INV, PG, PICKLIST, SM_MAP, UBI2_MAP, UBI_TEO, busAsc, busP, busRes, busSC, pendingRelocBadge, set_BM, set_busAsc, set_busP, set_busRes, set_busSC } from './state-globals.js';
import { getPriceRow, normCode, stripDash } from './file-upload.js';
import { getBusListPrice, isAccesorioGrp } from './precios-divisor.js';
import { lookupCrossBodega } from './inventario-sql.js';
import { goTab, pushNavState, updateBMButtons } from './ui-header-tabs.js';
import { clearPrec, doPrec, setPM } from './precios.js';
import { clearUbi, doUbi } from './ubicaciones.js';
import { cmp, cop, cp, escHtml, fmt, getDupUbis, hl, jsAttrSafe, mkPag, pickKeyFromItem, resetArrows, set, setAlert } from './utils.js';
import { mcResults_data } from './multi-codigo.js';
// ═══ js/buscador.js — extraído de index.html (líneas 8893–9114 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== BUSCADOR =====================
let busTimer=null;
function busLive(){clearTimeout(busTimer);busTimer=setTimeout(doSearch,180);}

// Búsqueda automática para PRECIOS
let precTimer=null;
function precLive(){
  clearTimeout(precTimer);
  if(!document.getElementById('precQ').value.trim()){clearPrec();return;}
  precTimer=setTimeout(doPrec,220);
}

// Búsqueda automática para UBICACIONES
let ubiTimer=null;
function ubiLive(){
  clearTimeout(ubiTimer);
  if(!document.getElementById('ubiQ').value.trim()){clearUbi();return;}
  ubiTimer=setTimeout(doUbi,220);
}
function setBM(m){set_BM(m);updateBMButtons();if(document.getElementById('busQ').value.trim())doSearch();}
// ── Modo Buscador: simple vs multi-código ──
// Antes Multi-Código era una pestaña aparte; ahora es un modo dentro de
// Buscador (mismo espacio de pantalla, un clic para cambiar) — se
// comparten sbox/alert, cada modo tiene su propia barra de stats y su
// propia zona de resultados, y solo una está visible a la vez.
let _busMode='simple';
function setBusMode(mode){
  _busMode = mode==='multi' ? 'multi' : 'simple';
  const isMulti = _busMode==='multi';
  document.getElementById('busmode-simple')?.classList.toggle('on', !isMulti);
  document.getElementById('busmode-multi')?.classList.toggle('on', isMulti);
  document.getElementById('busSimpleWrap').style.display = isMulti?'none':'';
  document.getElementById('busMultiWrap').style.display = isMulti?'':'none';
  document.getElementById('busSimpleResults').style.display = isMulti?'none':'';
  document.getElementById('busMultiResults').style.display = isMulti?'':'none';
  document.getElementById('busSimpleStats').style.display = isMulti?'none':'';
  const label=document.getElementById('busModeLabel');
  if(label) label.textContent = isMulti
    ? '🗂 Pega o carga una lista de referencias — se buscan todas de una vez'
    : '🔍 Busca por código · descripción · ubicación';
  setAlert('bAlert'); // limpia cualquier alerta pendiente del otro modo
  // La barra de stats de multi-código solo se muestra si ya hay una
  // búsqueda hecha (mcResults_data con contenido) — recién entrando al
  // modo, sin resultados todavía, no tiene nada que mostrar.
  const mcBar=document.getElementById('mcStatBar');
  if(mcBar) mcBar.style.display = (isMulti && Object.keys(mcResults_data||{}).length) ? 'flex' : 'none';
  if(isMulti) setTimeout(()=>document.getElementById('mcInput')?.focus(), 60);
}
// Búsqueda multi-palabra: divide el query por espacios y exige que TODOS
// los términos aparezcan en al menos uno de los campos (lógica AND).
// Con una sola palabra se comporta exactamente igual que antes.
function matchesQuery(q, ...fields){
  if(!q) return true;
  const terms=q.split(/\s+/).filter(Boolean);
  if(terms.length<=1) return fields.some(f=>(f||'').includes(q));
  return terms.every(t=>fields.some(f=>(f||'').includes(t)));
}

function doSearch(){
  if(!INV.length && !UBI_TEO.length){renderBusEmpty();return;}
  const q=document.getElementById('busQ').value.trim().toUpperCase();
  const stk=document.getElementById('fStk').value, ubi=document.getElementById('fUbi').value;

  // Código de repuesto (sin espacios): ignorar guiones; si no hay match,
  // reintentar sin la última letra (sufijo/revisión de etiqueta que a veces
  // no está en el inventario). Búsquedas con espacios (por descripción) no se tocan.
  const isCode = q && !/\s/.test(q);
  let qTry = isCode ? stripDash(q) : q;
  let retried = false;

  const filterFn = qq => INV.filter(r=>{
    if(!qq)return true;
    const u2=(UBI2_MAP[normCode(r[0])]||'');
    if(!isCode){
      if(BM==='EXA')return r[0]===qq||r[3]===qq||(u2&&u2===qq);
      return matchesQuery(qq, r[0], r[1], r[3], u2);
    }
    const cf=stripDash(r[0]);
    if(BM==='EXA')return cf===qq||r[3]===qq||(u2&&u2===qq);
    return cf.includes(qq)||(r[1]||'').includes(qq)||r[3].includes(qq)||(u2&&u2.includes(qq));
  });

  // 1. Filtrar inventario normal
  let res=filterFn(qTry);
  if(isCode && !res.length && qTry.length>1 && /[A-Z]$/.test(qTry)){
    qTry=qTry.slice(0,-1);
    res=filterFn(qTry);
    retried=res.length>0;
  }

  // 2. Inyectar ubicaciones vacías que coincidan con la búsqueda
  if(q && stk !== '1' && ubi !== '0') {
    const emptyUbis = UBI_TEO.filter(u => u[4] === 'LIBRE' && (BM === 'EXA' ? u[0] === q : u[0].includes(q)));
    emptyUbis.forEach(u => {
      if(!res.some(r => r[3] === u[0])) {
        // Fila simulada: código, desc, stock, ubi, abc, ...
        res.push(['---', '📍 Ubicación libre / Sin inventario', 0, u[0], '', 0, '', 0, 0, '']);
      }
    });
  }

  if(stk==='1')res=res.filter(r=>r[2]>0 || r[0]==='---');
  if(stk==='sm')res=res.filter(r=>Number(r[2])<0);
  if(stk==='mort')res=res.filter(r=>SM_MAP[normCode(r[0])]);
  if(stk==='0')res=res.filter(r=>r[2]<=0);
  if(ubi==='1')res=res.filter(r=>r[3]!=='Sin Ubicacion');
  if(ubi==='0')res=res.filter(r=>r[3]==='Sin Ubicacion');
  if(ubi==='dup'){const d=getDupUbis();res=res.filter(r=>d.has(r[3]));}
  
  set_busRes(res);set_busP(1);set_busSC(-1);set_busAsc(true);
  set('sRes',res.length);resetArrows('sa',5);

  // ── Aviso cruzado entre sedes ──────────────────────────────────
  // Solo aplica a búsquedas por código (no por descripción): avisar
  // "hay 40 coincidencias en la otra sede" no le sirve a nadie.
  const cross = isCode ? lookupCrossBodega(qTry) : null;

  if(q && !res.length){
    if(cross){
      setAlert('bAlert','ok',true,`<div class="xb-alert">
        <div>🏢 <b>${escHtml(qTry)}</b> no está en ${bodegaName(ACTIVE_BODEGA)}, pero
             <b>sí en ${cross.nombre}</b> — ${fmt(cross.stock)} und · ${escHtml(cross.ubicacion)}</div>
        <button class="upbtn" style="height:24px;font-size:10px;padding:0 10px"
                onclick="openCrossBodegaModal('${jsAttrSafe(cross.cod)}')">👁 Ver detalle</button>
      </div>`);
    } else {
      setAlert('bAlert','ae',true,`<div class="xb-alert"><div>⚠️ Sin resultados para "<b>${q}</b>" en ninguna sede</div>
        <button class="upbtn" style="height:24px;font-size:10px;padding:0 10px" onclick="goPrecio('${jsAttrSafe(q)}')">💰 Consultar Precio</button></div>`);
    }
  }
  else if(cross && cross.stock > 0 && res.length && res.every(r=>Number(r[2])<=0)){
    // Está aquí pero sin stock, y la otra sede sí tiene.
    setAlert('bAlert','alw',true,`<div class="xb-alert">
      <div>📦 Sin stock en ${bodegaName(ACTIVE_BODEGA)} — <b>${cross.nombre} tiene ${fmt(cross.stock)} und</b>
           en ${escHtml(cross.ubicacion)}</div>
      <button class="upbtn" style="height:24px;font-size:10px;padding:0 10px"
              onclick="openCrossBodegaModal('${jsAttrSafe(cross.cod)}')">👁 Ver detalle</button>
    </div>`);
  }
  else if(retried) setAlert('bAlert','alw',true,`🔎 Sin match exacto — mostrando sin la última letra ("${qTry}")`);
  else setAlert('bAlert');

  renderBusTable(q);
}
function renderBusTable(q){
  q=q||'';
  const tot=busRes.length,s=(busP-1)*PG,e=Math.min(s+PG,tot),pg=busRes.slice(s,e);
  document.getElementById('busBody').innerHTML=pg.map((r,i)=>{
    const stk=fmt(r[2]);
    const pr=getPriceRow(r[0]);
    const grp=r[6]||'';
    const isAcc=isAccesorioGrp(grp);
    const effPrice=getBusListPrice(pr,grp);
    const rowId=`${r[0]}|${r[3]}`;
    const effPriceIva=effPrice!==null?effPrice*1.19:null;
    const pickKey=pickKeyFromItem({cod:r[0],desc:r[1]||'',ubi:r[3],stock:r[2],price:effPriceIva});
    const picked=PICKLIST.has(pickKey);
    const pickBtn=r[0]!=='---'
      ?`<button type="button" class="pickrowbtn ${picked?'on':'off'}" data-pick-key="${pickKey}" onclick='event.stopPropagation();togglePick(${JSON.stringify({cod:r[0],desc:r[1]||"",stock:r[2],ubi:r[3],price:effPriceIva})},this)' title="${picked?'Quitar de la selección':'Agregar a la selección'}">${picked?'✓':'+'}</button>`
      :'';
    const ubi2val=UBI2_MAP[normCode(r[0])]||'';
    const ubi=r[3]==='Sin Ubicacion'
      ?'<span style="color:var(--text3)">Sin Ubicación</span>'+(ubi2val?`<span class="ubilink" style="opacity:.65;font-size:9px;margin-left:3px" onclick="goBusUbi('${jsAttrSafe(ubi2val)}','${jsAttrSafe(rowId)}')" title="2ª ubicación (KAIZEN)">+${hl(ubi2val,q,BM)}</span>`:'')
      :'<span class="ubilink" onclick="goBusUbi(\''+jsAttrSafe(r[3])+'\',\''+jsAttrSafe(rowId)+'\')" title="Ver ubicación">'+hl(r[3],q,BM)+'</span>'+(ubi2val?`<span class="ubilink" style="opacity:.65;font-size:9px;margin-left:3px" onclick="goBusUbi('${jsAttrSafe(ubi2val)}','${jsAttrSafe(rowId)}')" title="2ª ubicación (KAIZEN)">+${hl(ubi2val,q,BM)}</span>`:'')+(getDupUbis().has(r[3])?'<span class="badge" style="background:rgba(155,109,255,.18);color:#b09cff;border:1px solid rgba(155,109,255,.35);margin-left:5px;vertical-align:middle" title="Ubicación con más de una referencia asignada">DUP</span>':'');
    return`<tr data-rowid="${rowId}">
      <td>
        ${pickBtn}
        <button class="prlink" onclick="goPrecio('${jsAttrSafe(r[0])}','${jsAttrSafe(rowId)}')">💰</button>
        <button class="suglink" onclick='openSuggestModal(${JSON.stringify(r[0])},${JSON.stringify(r[1]||'')},${JSON.stringify(rowId)})' title="Sugerir ubicación">🎯</button>
        ${r[3]&&r[3]!=='Sin Ubicacion'?'<button class="stlink" onclick="goBusUbi(\''+jsAttrSafe(r[3])+'\',\''+jsAttrSafe(rowId)+'\')" title="Ver estante">📍</button>':''}
        ${r[0]!=='---'?`<button class="relocbtn${r[3]&&r[3]!=='Sin Ubicacion'?'':' reloc-new'}" onclick='openRelocModal(${JSON.stringify(r[0])},${JSON.stringify(r[1]||'')},${JSON.stringify(r[3]&&r[3]!=='Sin Ubicacion'?r[3]:'Sin Ubicacion')},${r[2]})' title="${r[3]&&r[3]!=='Sin Ubicacion'?'Registrar cambio de ubicación':'Asignar ubicación'}">↔</button>${pendingRelocBadge(r[0],r[3]&&r[3]!=='Sin Ubicacion'?r[3]:'Sin Ubicacion')}`:''}
      </td>
      <td style="color:var(--text3);font-size:9px">${s+i+1}</td>
      <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(r[0])}')">${hl(r[0],q,BM)}${cp(r[0])}${SM_MAP[normCode(r[0])]?'<span class="badge bSM" title="Stock Muerto · Ult.VT: '+(SM_MAP[normCode(r[0])].ult_vt||'—')+'">SM</span>':''}${(()=>{ const x = r[0]!=='---' ? lookupCrossBodega(r[0]) : null;
        return x && x.stock>0
          ? `<span class="xb-chip" title="Disponible en ${x.nombre}: ${fmt(x.stock)} und · ${escHtml(x.ubicacion)}"
                 onclick="event.stopPropagation();openCrossBodegaModal('${jsAttrSafe(x.cod)}')"
                 style="cursor:pointer">${x.nombre.toUpperCase()}: ${fmt(x.stock)}</span>`
          : ''; })()}</td>
      <td class="tdesc">${hl(r[1],q,BM)}</td>
      <td class="tnum ${r[2]>0?'pos':'zero'}">${stk}</td>
      <td>${ubi}</td>
      <td style="font-family:var(--mono);font-size:10px;color:var(--green)">${effPrice!==null?cop(effPrice*1.19):'—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('busPI').textContent=`${s+1}–${e} de ${tot}`;
  mkPag('busPag','busPB',Math.ceil(tot/PG),busP,p=>{set_busP(p);renderBusTable(q);});
  const bsa=document.getElementById('busSelAll');if(bsa)bsa.checked=false;
}

function clearBus(){document.getElementById('busQ').value='';set('sRes','—');setAlert('bAlert');resetArrows('sa',5);renderBusEmpty();}
function renderBusEmpty(){
  const loaded=INV.length>0;
  document.getElementById('busBody').innerHTML=`<tr><td colspan="8" style="border:0"><div class="empty"><div class="ei">${loaded?'🔍':'📭'}</div><div class="em">${loaded?'Ingresa un término para buscar':'Carga un archivo Excel para comenzar'}</div></div></td></tr>`;
  document.getElementById('busPag').style.display='none';
}
// ── unified table sort factory ──────────────────────────────────────────
function _tbSort(col,getAsc,setAsc,getSC,setSC,setP,res,prefix,nArrows,colMap,renderFn){
  const asc=getSC()===col?!getAsc():true;
  setSC(col);setAsc(asc);setP(1);
  const m=colMap?colMap[col]:col;
  res.sort((a,b)=>cmp(a[m],b[m],asc));
  resetArrows(prefix,nArrows);
  const el=document.getElementById(prefix+col);if(el)el.textContent=asc?'▲':'▼';
  renderFn();
}
function doSort(col){
  _tbSort(col,()=>busAsc,v=>{set_busAsc(v);},()=>busSC,v=>{set_busSC(v);},v=>{set_busP(v);},busRes,'sa',5,null,()=>renderBusTable(document.getElementById('busQ').value.trim().toUpperCase()));
  // Sync mobile sort buttons
  [0,1,2,3].forEach(i=>{
    const btn=document.getElementById('msa'+i);
    if(!btn)return;
    btn.classList.remove('mob-sort-asc','mob-sort-desc');
    if(i===busSC) btn.classList.add(busAsc?'mob-sort-asc':'mob-sort-desc');
  });
}

function goBusUbi(ubi,rowId=null){pushNavState(rowId);document.getElementById('ubiQ').value=ubi;goTab('ubi',document.querySelectorAll('.tab[data-tab="ubi"]')[0]);doUbi();}
function goEstante(name){pushNavState();const uEst=document.getElementById('uEstante');if(uEst){uEst.value=name;}document.getElementById('ubiQ').value='';goTab('ubi',document.querySelectorAll('.tab[data-tab="ubi"]')[0]);doUbi();}
function goPrecio(cod,rowId=null){pushNavState(rowId);document.getElementById('precQ').value=cod;goTab('prec',document.querySelectorAll('.tab[data-tab="prec"]')[0]);setPM('EXA');doPrec();}
function goBuscador(q){pushNavState();document.getElementById('busQ').value=q;goTab('bus',document.querySelectorAll('.tab[data-tab="bus"]')[0]);doSearch();}

export { _tbSort, busLive, clearBus, doSearch, doSort, goBusUbi, goBuscador, goEstante, goPrecio, matchesQuery, precLive, renderBusEmpty, setBM, setBusMode, ubiLive };
