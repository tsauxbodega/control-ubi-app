import { CURRENT_USER, db } from './auth.js';
import { ESTANTES, INV, INV_IDX, NOSTOCK_UBI, PRICES, UBI_TEO, cleanNumber } from './state-globals.js';
import { getPriceRow, normCode } from './file-upload.js';
import { cop, escHtml, getDupUbis, jsAttrSafe } from './utils.js';
import { RADAR_PRICE_BASELINE, radarPriceSaveLocalCache } from './radar-precios.js';
// ═══ js/precios-divisor.js — extraído de index.html (líneas 7102–7461 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════
// DIVISOR DE PRECIOS — tinas / cajas → precio por unidad de producto
// ══════════════════════════════════════════════════════════════════
// Algunas refs (aceites en tina, líquidos en caja) traen en la LISTA DE PRECIOS
// (Excel) el valor de toda la presentación, mientras el stock del SQL cuenta
// unidades. PRICE_DIV guarda, por referencia, entre cuánto dividir.
// Solo afecta los precios del Excel (Mostrador, Accesorios, Costo y demás tipos);
// el costo promedio del SQL ya viene por unidad y no se toca.
//
// Garantías:
//  · Nunca se divide dos veces: cada fila conserva su valor original en _raw y
//    el divisor siempre se calcula desde ese original.
//  · Lo que se guarda en el navegador es siempre el valor original (ver
//    pricesRawForStorage), así que recargar la app no acumula divisiones.
//  · Solo se tocan las filas con divisor; el resto de precios no se modifica.
const PRICE_DIV_KEY='ctrl_price_div';
let PRICE_DIV = (()=>{ try{ const o=JSON.parse(localStorage.getItem(PRICE_DIV_KEY)||'{}'); return (o&&typeof o==='object')?o:{}; }catch(e){ return {}; } })();
let _priceDivUnsub=null;

// Aplica (o revierte) los divisores sobre PRICES. Idempotente.
// Devuelve las claves de PRICES cuyo valor cambió (para rebasar el Radar).
function applyPriceDivisors(){
  const changed=[];
  for(const [k,row] of Object.entries(PRICES||{})){
    if(!row) continue;
    const cfg=PRICE_DIV[normCode(k)];
    const d=cfg&&Number(cfg.div)>0?Number(cfg.div):0;
    if(!d){
      if(row._raw){ // ya no tiene divisor → volver al valor original
        row[0]=row._raw.m; row[1]=row._raw.a; row[3]=row._raw.c;
        if(row._raw.bt&&row.byType) Object.assign(row.byType,row._raw.bt);
        delete row._raw; delete row._div; changed.push(k);
      }
      continue;
    }
    if(!row._raw) row._raw={m:row[0],a:row[1],c:row[3],bt:row.byType?{...row.byType}:null};
    const div=v=>Math.round((Number(v)||0)/d*100)/100;
    const antes=row[3];
    row[0]=div(row._raw.m); row[1]=div(row._raw.a); row[3]=div(row._raw.c);
    if(row._raw.bt){ row.byType=row.byType||{}; for(const t in row._raw.bt) row.byType[t]=div(row._raw.bt[t]); }
    row._div=d;
    if(row[3]!==antes||row._div!==d) changed.push(k);
  }
  return changed;
}

// Copia de PRICES para guardar en el navegador: siempre con los valores originales.
function pricesRawForStorage(prices){
  let out=null;
  for(const k in prices){
    const r=prices[k];
    if(r&&r._raw){ if(!out) out={...prices}; out[k]=[r._raw.m,r._raw.a,r[2],r._raw.c]; }
  }
  return out||prices;
}

// El Radar compara contra una base de precios: si cambia el divisor, esa base
// debe pasar a la escala nueva para no inventar una "bajada de precio del 99%".
function priceDivRebaseRadar(keys){
  if(!keys||!keys.length) return;
  try{
    for(const k of keys){
      const r=PRICES[k];
      if(r&&RADAR_PRICE_BASELINE[k]) RADAR_PRICE_BASELINE[k]=[r[0],r[1],r[3]];
    }
    radarPriceSaveLocalCache();
  }catch(e){ console.warn('[Divisor de precios] no se pudo rebasar el Radar:',e); }
}

function priceDivSaveLocal(){ try{ localStorage.setItem(PRICE_DIV_KEY,JSON.stringify(PRICE_DIV)); }catch(e){} }
function priceDivSaveCloud(){
  if(typeof db==='undefined'||!CURRENT_USER) return;
  const items=Object.entries(PRICE_DIV).map(([cod,v])=>({cod,div:v.div,nota:v.nota||'',desc:v.desc||''}));
  db.doc('equipo/precio_divisores').set({items,updatedAt:Date.now(),updatedBy:CURRENT_USER.nombre||CURRENT_USER.email||''})
    .catch(e=>console.warn('[Divisor de precios] No se pudo guardar en la nube (quedó en este equipo):',e));
}
function watchPriceDiv(){
  if(typeof db==='undefined'||!CURRENT_USER) return;
  if(_priceDivUnsub){ try{_priceDivUnsub();}catch(e){} _priceDivUnsub=null; }
  _priceDivUnsub=db.doc('equipo/precio_divisores').onSnapshot(snap=>{
    if(!snap.exists) return;
    const list=(snap.data()||{}).items||[];
    const next={};
    list.forEach(it=>{ if(it&&it.cod&&Number(it.div)>0) next[normCode(it.cod)]={div:Number(it.div),nota:it.nota||'',desc:it.desc||'',cod:it.cod}; });
    if(JSON.stringify(next)===JSON.stringify(PRICE_DIV)) return;
    PRICE_DIV=next; priceDivSaveLocal();
    priceDivRebaseRadar(applyPriceDivisors());
    if(document.getElementById('priceDivOverlay')?.classList.contains('on')) priceDivRender();
  },err=>console.warn('[Divisor de precios] sin acceso a la nube:',err));
}

// ── Modal de administración ───────────────────────────────────────
const PD_SEL=new Map(); // normCode → {cod,desc}
function pdNorm(x){return String(x??'').toUpperCase();}
function pdRaw(row){ return row&&row._raw?{m:row._raw.m,a:row._raw.a,c:row._raw.c}:{m:row?row[0]:0,a:row?row[1]:0,c:row?row[3]:0}; }
function pdMoney(n){ return (n>0)?cop(n):'—'; }
function openPriceDivModal(){
  if(!(CURRENT_USER&&CURRENT_USER.rol==='admin')) return;
  PD_SEL.clear();
  document.getElementById('pdSearch').value=''; document.getElementById('pdDiv').value=''; document.getElementById('pdNota').value='';
  document.getElementById('pdMsg').textContent='';
  document.getElementById('priceDivOverlay').classList.add('on');
  priceDivRender();
  setTimeout(()=>document.getElementById('pdSearch').focus(),50);
}
function closePriceDivModal(){ document.getElementById('priceDivOverlay').classList.remove('on'); }

function priceDivSearch(){
  const box=document.getElementById('pdResults');
  const q=pdNorm(document.getElementById('pdSearch').value).trim();
  if(q.length<2){ box.innerHTML=''; return; }
  const toks=q.split(/\s+/);
  const hits=[];
  for(const [k,row] of Object.entries(PRICES||{})){
    const inv=INV_IDX.get(normCode(k));
    const desc=pdNorm((inv&&inv[1])||row[2]||'');
    const hay=pdNorm(k)+' '+desc;
    if(toks.every(t=>hay.includes(t))){ hits.push({k,row,desc:(inv&&inv[1])||row[2]||''}); if(hits.length>=200) break; }
  }
  if(!hits.length){ box.innerHTML='<div class="pd-empty">Sin resultados en la lista de precios.</div>'; return; }
  window._pdHits=hits;
  box.innerHTML=`<div class="pd-resbar"><span>${hits.length}${hits.length>=200?'+':''} resultado${hits.length!==1?'s':''}</span>
      <button class="sbtn" style="height:24px;font-size:9px;padding:0 10px" onclick="priceDivAddAll()">➕ Agregar todos</button></div>
    <div class="pd-scroll"><table style="width:100%"><tbody>${hits.slice(0,60).map((h,i)=>{
      const cfg=PRICE_DIV[normCode(h.k)], raw=pdRaw(h.row), on=PD_SEL.has(normCode(h.k));
      return `<tr><td class="tcode">${escHtml(h.k)}</td><td class="tdesc">${escHtml(h.desc)}</td>
        <td class="tnum" title="Costo unitario de la lista (original)">${pdMoney(raw.c)}</td>
        <td>${cfg?`<span class="pd-tag">÷${cfg.div}</span>`:''}</td>
        <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 10px" ${on?'disabled':''} onclick="priceDivAdd(${i})">${on?'✓':'➕'}</button></td></tr>`;}).join('')}
    </tbody></table></div>${hits.length>60?`<div class="pd-empty">Mostrando 60 de ${hits.length}. Afina la búsqueda o usa "Agregar todos".</div>`:''}`;
}
function priceDivAdd(i){ const h=(window._pdHits||[])[i]; if(!h) return; PD_SEL.set(normCode(h.k),{cod:h.k,desc:h.desc}); priceDivSearch(); priceDivRender(); }
function priceDivAddAll(){ (window._pdHits||[]).forEach(h=>PD_SEL.set(normCode(h.k),{cod:h.k,desc:h.desc})); priceDivSearch(); priceDivRender(); }
function priceDivRemoveSel(n){ PD_SEL.delete(n); priceDivSearch(); priceDivRender(); }
function priceDivClearSel(){ PD_SEL.clear(); priceDivSearch(); priceDivRender(); }

function priceDivRender(){
  const d=Number(document.getElementById('pdDiv').value);
  const okD=d>0&&isFinite(d);
  // Seleccionadas + vista previa
  const sel=[...PD_SEL.entries()];
  const selBox=document.getElementById('pdSelected');
  if(!sel.length){ selBox.innerHTML='<div class="pd-empty">Aún no has elegido referencias. Búscalas arriba y pulsa ➕.</div>'; }
  else{
    selBox.innerHTML=`<div class="pd-resbar"><span><b>${sel.length}</b> seleccionada${sel.length!==1?'s':''}</span>
        <button class="sbtn" style="height:24px;font-size:9px;padding:0 10px" onclick="priceDivClearSel()">Limpiar</button></div>
      <div class="pd-scroll"><table style="width:100%"><thead><tr><th>Código</th><th>Descripción</th><th>Costo lista</th><th>${okD?'÷'+d:'Con divisor'}</th><th></th></tr></thead><tbody>
      ${sel.slice(0,100).map(([n,it])=>{
        const raw=pdRaw(getPriceRow(it.cod));
        return `<tr><td class="tcode">${escHtml(it.cod)}</td><td class="tdesc">${escHtml(it.desc)}</td>
          <td class="tnum">${pdMoney(raw.c)}</td>
          <td class="tnum" style="color:var(--cyan)">${okD?pdMoney(Math.round(raw.c/d*100)/100):'—'}</td>
          <td><button class="sbtn" style="height:22px;font-size:9px;padding:0 8px" onclick="priceDivRemoveSel('${jsAttrSafe(n)}')">✕</button></td></tr>`;}).join('')}
      </tbody></table></div>${sel.length>100?`<div class="pd-empty">Vista previa de 100 de ${sel.length}.</div>`:''}`;
  }
  document.getElementById('pdApply').disabled=!(sel.length&&okD);
  // Ya configuradas
  const cfgs=Object.entries(PRICE_DIV).sort((a,b)=>String(a[1].cod||a[0]).localeCompare(String(b[1].cod||b[0]),'es',{numeric:true}));
  document.getElementById('pdListTitle').textContent=`Ya configuradas (${cfgs.length})`;
  document.getElementById('pdList').innerHTML=cfgs.length?`<div class="pd-scroll"><table style="width:100%"><thead><tr><th>Código</th><th>Descripción</th><th>Divisor</th><th>Nota</th><th>Lista → unidad</th><th></th></tr></thead><tbody>
    ${cfgs.map(([n,c])=>{
      const row=getPriceRow(c.cod||n), raw=pdRaw(row);
      return `<tr><td class="tcode">${escHtml(c.cod||n)}</td><td class="tdesc">${escHtml(c.desc||'—')}</td>
        <td class="tnum"><span class="pd-tag">÷${c.div}</span></td>
        <td style="font-size:10px;color:var(--text3)">${escHtml(c.nota||'')}</td>
        <td class="tnum" style="font-size:10px">${row?pdMoney(raw.c)+' → <b style="color:var(--cyan)">'+pdMoney(row[3])+'</b>':'<span style="color:var(--text3)">no está en la lista actual</span>'}</td>
        <td style="white-space:nowrap"><button class="sbtn" style="height:22px;font-size:9px;padding:0 8px" onclick="priceDivEdit('${jsAttrSafe(n)}')">✏️</button>
            <button class="sbtn" style="height:22px;font-size:9px;padding:0 8px" onclick="priceDivDelete('${jsAttrSafe(n)}')">🗑</button></td></tr>`;}).join('')}
    </tbody></table></div>`:'<div class="pd-empty">Ninguna todavía.</div>';
}
function priceDivEdit(n){
  const c=PRICE_DIV[n]; if(!c) return;
  PD_SEL.clear(); PD_SEL.set(n,{cod:c.cod||n,desc:c.desc||''});
  document.getElementById('pdDiv').value=c.div; document.getElementById('pdNota').value=c.nota||'';
  document.getElementById('pdMsg').textContent='Editando ÷'+c.div+' — cambia el divisor y pulsa Aplicar.';
  priceDivSearch(); priceDivRender();
}
function priceDivApply(){
  const d=Number(document.getElementById('pdDiv').value);
  const msg=document.getElementById('pdMsg');
  if(!PD_SEL.size){ msg.textContent='Elige al menos una referencia.'; return; }
  if(!(d>0&&isFinite(d))){ msg.textContent='El divisor debe ser un número mayor que 0.'; return; }
  const nota=document.getElementById('pdNota').value.trim();
  let n=0;
  for(const [norm,it] of PD_SEL){
    if(d===1){ delete PRICE_DIV[norm]; }
    else PRICE_DIV[norm]={div:d,nota,desc:it.desc||'',cod:it.cod};
    n++;
  }
  priceDivSaveLocal(); priceDivSaveCloud();
  priceDivRebaseRadar(applyPriceDivisors());
  PD_SEL.clear();
  document.getElementById('pdDiv').value=''; document.getElementById('pdNota').value='';
  msg.textContent=d===1?`✅ ${n} referencia${n!==1?'s':''} vuelve${n!==1?'n':''} al precio original.`:`✅ Divisor ÷${d} aplicado a ${n} referencia${n!==1?'s':''}.`;
  priceDivSearch(); priceDivRender();
}
function priceDivDelete(n){
  const c=PRICE_DIV[n]; if(!c) return;
  if(!confirm(`¿Quitar el divisor ÷${c.div} de ${c.cod||n}? Volverá a mostrar el precio original de la lista.`)) return;
  delete PRICE_DIV[n];
  priceDivSaveLocal(); priceDivSaveCloud();
  priceDivRebaseRadar(applyPriceDivisors());
  document.getElementById('pdMsg').textContent='Divisor quitado.';
  priceDivSearch(); priceDivRender();
}
// Devuelve el precio correcto según grupo: accesorios → pr[1] (Precio Accesorios), demás → pr[0] (Mostrador)
// invRow: fila INV [cod,desc,stock,ubi,abc,days,grp,...] — grp=r[6]
function isAccesorioGrp(grp){const g=grp?String(grp).toLowerCase():'';return g.includes('accesorio')||g.includes('boutique');}
function getEffectivePrice(priceRow,grp){
  if(!priceRow)return null;
  return isAccesorioGrp(grp)?priceRow[1]:priceRow[0];
}
// Precio de un tipo específico (para el nuevo selector de tipo de
// precio). Si la fila no trae byType (Excel viejo, sin la hoja ampliada
// todavía) cae de vuelta al comportamiento clásico mostrador/accesorios.
function getPriceByType(priceRow, typeKey){
  if(!priceRow) return null;
  if(priceRow.byType && typeKey in priceRow.byType) return priceRow.byType[typeKey];
  if(typeKey==='accesorios') return priceRow[1];
  return priceRow[0];
}
// Precio para la columna PRECIO/IVA del buscador principal: siempre
// MOSTRADOR_SIN_DCTO (columna "MOSTRADOR_SIN DCTO" del Excel de precios),
// no el primer tipo detectado — a diferencia de getEffectivePrice(), que
// sigue usando el primer tipo para el resto de la app (Reporte, Radar de
// precios, Cotizador, Precios, Selection Tray). Accesorios no cambia: usa
// Precio Accesorios igual que antes. Si el Excel cargado todavía no trae
// esa columna, cae de vuelta al comportamiento anterior para no romper nada.
function getBusListPrice(priceRow, grp){
  if(!priceRow) return null;
  if(isAccesorioGrp(grp)){
    if(priceRow.byType && 'accesorios_sin_dcto' in priceRow.byType) return priceRow.byType['accesorios_sin_dcto'];
    return priceRow[1]; // fallback si el Excel aún no trae esa columna
  }
  if(priceRow.byType && 'mostrador_sin_dcto' in priceRow.byType) return priceRow.byType['mostrador_sin_dcto'];
  return priceRow[0];
}

const SHELF_SNAP_THROTTLE_MS = 10*60*1000; // no reescribir más de 1 vez cada 10 min por cliente
async function syncShelfSnapshots(){
  try{
    if(!CURRENT_USER || !ESTANTES.length) return;
    const lastSync=parseInt(localStorage.getItem('shelfSnapSyncTs')||'0');
    if(Date.now()-lastSync < SHELF_SNAP_THROTTLE_MS) return;

    const batch=db.batch();
    let count=0;
    for(const est of ESTANTES){
      const nombre=String(est[0]||'').trim();
      if(!nombre) continue;
      const prefix=nombre.toUpperCase();
      // Misma lógica de clasificación de ubicaciones que usa el modal en vivo
      // (openQRShelfModal), para que el snapshot público muestre exactamente
      // lo mismo que vería un usuario ya logueado.
      const estRows=UBI_TEO.filter(u=>{
        const ubi=String(u[0]||'').trim().toUpperCase();
        if(!ubi.startsWith(prefix))return false;
        const rest=ubi.slice(prefix.length);
        return /^[A-Z]?\d/.test(rest)||/^\d/.test(rest);
      }).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));

      // Solo lo mínimo necesario para el modal: sin precios, sin costos.
      // OJO: Firestore NO permite arrays anidados (array dentro de array)
      // como valor de campo — por eso esto va como array de OBJETOS, no
      // array de arrays. Antes esto tronaba en batch.set() con "Nested
      // arrays are not supported" en el primer estante (A1), lo que
      // abortaba TODO el loop — ningún estante llegaba nunca a guardarse.
      const ubicaciones=estRows.map(u=>({
        loc: String(u[0]||''), cod: String(u[1]||''), desc: String(u[2]||''),
        stock: cleanNumber(u[3]), estado: String(u[4]||'')
      }));

      // docId debe coincidir EXACTO con el que arma fetchShelfSnapshot() al leer
      // (línea ~5157: toUpperCase + mismo reemplazo de barras). El nombre del
      // estante tal como viene de DASH_ESTANTES puede no estar en mayúsculas;
      // sin este toUpperCase aquí, el doc que se guarda nunca coincide con el
      // que se busca al escanear el QR sin sesión → snap.exists=false siempre
      // → el modal cae al mensaje "sin conexión" aunque sí haya internet.
      const docId=nombre.toUpperCase().replace(/[/\\]/g,'_');
      batch.set(db.collection('estante_snapshots').doc(docId),{
        estante:nombre,
        total:Number(est[1])||0,
        ocupadas:Number(est[2])||0,
        libres:Number(est[3])||0,
        pctLibre:Number(est[4])||0,
        ubicaciones,
        ts:firebase.firestore.FieldValue.serverTimestamp()
      });
      count++;
      if(count>=450){ await batch.commit(); count=0; } // margen bajo el límite de 500/lote de Firestore
    }
    if(count>0) await batch.commit();

    // ── Snapshot público del PANORAMA GENERAL ────────────────────────────
    // A diferencia del snapshot por estante (uno por cada fila de
    // ESTANTES), este es UN SOLO documento con los totales agregados — por
    // eso comparte el mismo throttle de 10 min de arriba y no suma ~cientos
    // de escrituras extra por sync: es 1 escritura más, no N. Con esto el
    // QR "panorama" también puede servir una vista rápida a invitados sin
    // sesión (ver openPanoramaModal), igual que ya hace el QR por estante.
    try{
      const kpis=computePanoramaKPIs();
      await db.collection('panorama_snapshot').doc('current').set({
        ...kpis,
        ts:firebase.firestore.FieldValue.serverTimestamp()
      });
    }catch(e){
      // Tampoco crítico: si falla (p.ej. reglas de 'panorama_snapshot' aún
      // no publicadas), el modal de panorama para invitados simplemente
      // cae al pedido de login, como antes.
      console.warn('Sync de snapshot del panorama general (QR) no se pudo completar — no es crítico:', e);
    }

    localStorage.setItem('shelfSnapSyncTs', String(Date.now()));
  }catch(e){
    // No debe interrumpir la carga principal de datos si esto falla
    // (por ejemplo, si las reglas de Firestore de 'estante_snapshots' aún no existen).
    console.warn('Sync de snapshots de estantes (QR) no se pudo completar — no es crítico:', e);
  }
}

async function fetchShelfSnapshot(nombreEstante){
  const docId=String(nombreEstante||'').trim().toUpperCase().replace(/[/\\]/g,'_');
  if(!docId) return null;
  const snap=await db.collection('estante_snapshots').doc(docId).get();
  return snap.exists ? snap.data() : null;
}

// ── Snapshot público del PANORAMA GENERAL (lectura) ─────────────────────
async function fetchPanoramaSnapshot(){
  const snap=await db.collection('panorama_snapshot').doc('current').get();
  return snap.exists ? snap.data() : null;
}

// KPIs agregados del panorama — misma lógica que antes vivía inline dentro
// de openPanoramaModal(). Extraída a función aparte para poder reutilizarla
// tanto al pintar el modal en vivo (sesión activa) como al armar el
// snapshot público que se guarda para invitados sin sesión.
function computePanoramaKPIs(){
  const nEst=ESTANTES.length;
  const okEst=ESTANTES.filter(r=>(Number(r[4])||0)>=0.2).length;
  const warnEst=nEst-okEst;

  const uTot=UBI_TEO.length;
  const uOcu=UBI_TEO.filter(r=>String(r[4]||'').trim().toUpperCase()==='OCUPADA').length;
  const uLib=UBI_TEO.filter(r=>String(r[4]||'').trim().toUpperCase()==='LIBRE').length;
  const pOcuGen=uTot?Math.round(uOcu/uTot*100):0;
  const pLibGen=uTot?(uLib/uTot*100):0;

  const dupSet=getDupUbis();
  const dupRefs=INV.filter(r=>dupSet.has(r[3])).length;

  const rTot=INV.length;
  const rStk=INV.filter(r=>cleanNumber(r[2])>0).length;
  const rSinUbi=INV.filter(r=>!r[3]||r[3]==='Sin Ubicacion').length;
  const rZero=NOSTOCK_UBI.length;

  return {nEst,okEst,warnEst,uTot,uOcu,uLib,pOcuGen,pLibGen:Number(pLibGen.toFixed(1)),dupRefs,rTot,rStk,rSinUbi,rZero};
}

export { applyPriceDivisors, closePriceDivModal, computePanoramaKPIs, fetchPanoramaSnapshot, fetchShelfSnapshot, getBusListPrice, getEffectivePrice, getPriceByType, isAccesorioGrp, openPriceDivModal, priceDivAdd, priceDivAddAll, priceDivApply, priceDivClearSel, priceDivDelete, priceDivEdit, priceDivRemoveSel, priceDivRender, priceDivSearch, pricesRawForStorage, syncShelfSnapshots, watchPriceDiv };
