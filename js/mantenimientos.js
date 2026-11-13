import { CURRENT_USER, canAccessTab, db } from './auth.js';
import { INV, PRICES } from './state-globals.js';
import { matchesQuery } from './buscador.js';
import { escHtml, fmt, jsAttrSafe } from './utils.js';
import { cotInvContext } from './cotizador.js';
// ═══ js/mantenimientos.js — extraído de index.html (líneas 17771–18221 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
/* ═══════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════
// MANTENIMIENTOS · Combos de repuestos por vehículo
// ═══════════════════════════════════════════════════════════════════
// Colección propia (no toca INV/PRICES/etc.) dentro del mismo proyecto
// Firebase de Control UBI. Cada documento = un combo vehículo+mantenimiento,
// con una lista libre de referencias (sin límite ni categorías fijas).
// Igual que el resto de la app: se escribe primero en localStorage y luego
// se intenta la nube — si la nube falla, el dato ya quedó a salvo local.
const MANT_COLLECTION = 'mant_combos';
const MANT_LOCAL_KEY = 'ctrl_mant_combos_cache';
// Categorías de Prepull, ofrecidas como sugerencia rápida (datalist) al
// etiquetar una referencia — no son obligatorias ni limitan la cantidad
// de filas por combo.
const MANT_SUGGESTED_TAGS = ["FILTRO_ACEITE","ARO_TAPON","FILTRO_M","FILTRO_H","FILTRO_AA","LIMPIADOR_INY","LIQUIDO_F","LIMPIADOR_FR"];

let MANT_COMBOS = [];       // [{id, vehiculo, mantenimiento, items:[{tag,cod,cant}], ts, actualizadoPor}]
let MANT_EDIT_ITEMS = [];   // copia de trabajo mientras se edita un combo
let MANT_EDITING_ID = null; // id del combo en edición; null = combo nuevo
let mantQ = '';
let MANT_EXPANDED = new Set(); // ids de combos con las referencias desplegadas en la lista

function mantCanManage(){
  // Borrar combos e importar en bloque queda para admin/supervisor —
  // crear/editar referencias sí lo puede hacer cualquiera con acceso al modal.
  return !!(CURRENT_USER && (CURRENT_USER.rol==='admin' || CURRENT_USER.rol==='supervisor'));
}
function mantModalIsOpen(){
  return document.getElementById('mantOverlay')?.classList.contains('on');
}
function openMantModal(){
  if(typeof canAccessTab==='function' && !canAccessTab('mant')) return; // bloqueo por rol
  document.getElementById('mantOverlay').classList.add('on');
  document.getElementById('mant-edit-view').style.display='none';
  document.getElementById('mant-list-view').style.display='block';
  renderMantList();
}
function closeMantModal(){
  document.getElementById('mantOverlay').classList.remove('on');
}
function mantDocId(vehiculo, mantenimiento){
  return (vehiculo+'__'+mantenimiento).replace(/[\/\.\#\$\[\]\s]+/g,'_').slice(0,400);
}
function mantSaveLocalCache(){ try{ localStorage.setItem(MANT_LOCAL_KEY, JSON.stringify(MANT_COMBOS)); }catch(e){} }
function mantLoadLocalCache(){
  try{
    const raw=localStorage.getItem(MANT_LOCAL_KEY);
    if(!raw) return;
    const arr=JSON.parse(raw);
    if(Array.isArray(arr)) MANT_COMBOS=arr;
  }catch(e){}
}
// NOTA (04/09/2026): se pasó de escucha en vivo (onSnapshot, ~300 docs
// releídos completos en cada carga/reconexión) a carga puntual bajo
// demanda — se trae la colección UNA vez al iniciar sesión y de ahí en
// adelante solo vuelve a pedirla si el usuario toca "🔄 Actualizar" (ver
// mantRefreshFromCloud/botón en el modal). Reduce el consumo de lecturas
// de esta colección de "cada recarga de cada dispositivo" a "cuando de
// verdad hace falta ver cambios de otro compañero".
let mantLoading = false;
async function mantRefreshFromCloud(){
  mantLoadLocalCache();
  if(mantModalIsOpen()) renderMantList();
  if(!db || mantLoading) return;
  mantLoading = true;
  try{
    const snap = await db.collection(MANT_COLLECTION).get();
    const arr=[];
    snap.forEach(doc=>{
      const d=doc.data()||{};
      arr.push({id:doc.id, vehiculo:d.vehiculo||'', mantenimiento:d.mantenimiento||'', items:Array.isArray(d.items)?d.items:[], ts:d.ts||0, actualizadoPor:d.actualizadoPor||''});
    });
    arr.sort((a,b)=> a.vehiculo.localeCompare(b.vehiculo) || a.mantenimiento.localeCompare(b.mantenimiento));
    MANT_COMBOS = arr;
    mantSaveLocalCache();
    if(mantModalIsOpen()) renderMantList();
  }catch(err){
    // Missing or insufficient permissions: la colección mant_combos necesita
    // una regla en Firestore. Agrega esto en Firebase Console → Firestore → Rules:
    //   match /mant_combos/{doc} {
    //     allow read, write: if request.auth != null;
    //   }
    console.warn('[Mantenimientos] No se pudo traer de la nube — usando respaldo local. Si el error es "Missing or insufficient permissions", agrega la regla de mant_combos en Firestore Rules (ver comentario en código):', err.code||err.message);
  }finally{
    mantLoading = false;
  }
}
// Alias con el nombre anterior para no romper la única llamada de arranque.
function startMantListener(){ mantRefreshFromCloud(); }

// ── Datalists de sugerencia (vehículos/mantenimientos/etiquetas ya usados) ──
function mantRefreshDatalists(){
  const vehs=[...new Set(MANT_COMBOS.map(c=>c.vehiculo).filter(Boolean))].sort();
  const mants=[...new Set(MANT_COMBOS.map(c=>c.mantenimiento).filter(Boolean))].sort();
  const tags=new Set(MANT_SUGGESTED_TAGS);
  MANT_COMBOS.forEach(c=>(c.items||[]).forEach(it=>{ if(it.tag) tags.add(it.tag); }));
  const dlVeh=document.getElementById('mantVehList');
  if(dlVeh) dlVeh.innerHTML=vehs.map(v=>`<option value="${escHtml(v)}">`).join('');
  const dlMant=document.getElementById('mantMantList');
  if(dlMant) dlMant.innerHTML=mants.map(m=>`<option value="${escHtml(m)}">`).join('');
  const dlTag=document.getElementById('mantTagList');
  if(dlTag) dlTag.innerHTML=[...tags].sort().map(t=>`<option value="${escHtml(t)}">`).join('');
}

// ── Vista lista ──
function mantSearchInput(v){ mantQ=(v||'').trim().toUpperCase(); renderMantList(); }
function mantKmFromMant(m){
  const match=String(m||'').match(/REV\s+(\d+)/i);
  return match?parseInt(match[1],10):null;
}
function mantPopulateVehFilter(){
  const sel=document.getElementById('mantVehFilter');
  if(!sel) return;
  const current=sel.value;
  const vehs=[...new Set(MANT_COMBOS.map(c=>c.vehiculo).filter(Boolean))].sort();
  sel.innerHTML='<option value="">Todos los vehículos</option>'+vehs.map(v=>`<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  if(vehs.includes(current)) sel.value=current;
}
function renderMantList(){
  mantRefreshDatalists();
  mantPopulateVehFilter();
  const impBtn=document.getElementById('mantImportBtn');
  if(impBtn) impBtn.style.display = mantCanManage() ? 'inline-flex' : 'none';
  const body=document.getElementById('mantListBody');
  if(!body) return;
  const vehFilter=document.getElementById('mantVehFilter')?.value||'';
  let rows=MANT_COMBOS;
  if(vehFilter) rows=rows.filter(c=>c.vehiculo===vehFilter);
  if(mantQ){
    rows=rows.filter(c=>
      c.vehiculo.toUpperCase().includes(mantQ) ||
      c.mantenimiento.toUpperCase().includes(mantQ) ||
      (c.items||[]).some(it=>String(it.cod||'').toUpperCase().includes(mantQ))
    );
  }
  if(!rows.length){
    body.innerHTML=`<div style="color:var(--text3);text-align:center;padding:20px 10px;font-size:12px">${MANT_COMBOS.length?'Sin resultados para tu búsqueda.':'Todavía no hay combos cargados — creá uno nuevo o importá el JSON.'}</div>`;
    return;
  }
  // Agrupar por vehículo — dentro de cada uno, ordenar por km (REV NNNNN);
  // lo que no matchea ese patrón va al final, alfabético.
  const grupos={};
  rows.forEach(c=>{ (grupos[c.vehiculo]=grupos[c.vehiculo]||[]).push(c); });

  body.innerHTML=Object.keys(grupos).sort().map(vehiculo=>{
    const items=grupos[vehiculo].sort((a,b)=>{
      const ka=mantKmFromMant(a.mantenimiento), kb=mantKmFromMant(b.mantenimiento);
      if(ka!==null&&kb!==null) return ka-kb;
      if(ka!==null) return -1;
      if(kb!==null) return 1;
      return a.mantenimiento.localeCompare(b.mantenimiento);
    });

    // Detectar huecos: si el salto entre dos REV consecutivos duplica (o
    // más) el paso típico de este vehículo, avisar — probablemente falte
    // cargar un nivel intermedio.
    const kms=items.map(c=>mantKmFromMant(c.mantenimiento)).filter(k=>k!==null);
    let gapNote='';
    if(kms.length>=2){
      const pasos=kms.slice(1).map((k,i)=>k-kms[i]).filter(p=>p>0);
      const pasoTipico=pasos.length?Math.min(...pasos):0;
      const huecos=[];
      for(let i=1;i<kms.length;i++){
        const salto=kms[i]-kms[i-1];
        if(pasoTipico>0 && salto>=pasoTipico*2) huecos.push(`${kms[i-1].toLocaleString('es-CO')} → ${kms[i].toLocaleString('es-CO')}`);
      }
      if(huecos.length) gapNote=`<div class="mant-gap-note">⚠️ Posible(s) km faltante(s) entre: ${huecos.join(' · ')}</div>`;
    }

    const rowsHtml=items.map(c=>{
      const n=(c.items||[]).filter(it=>it.cod).length;
      const fecha=c.ts?new Date(c.ts).toLocaleDateString('es-CO'):'—';
      const expanded=MANT_EXPANDED.has(c.id);
      const detail=expanded?`<div class="mant-card-detail">
          ${n?(c.items||[]).filter(it=>it.cod).map(it=>`
            <div class="mant-card-detail-item">
              <span class="mant-card-detail-tag">${escHtml(it.tag||'(sin categoría)')}</span>
              <span class="mant-card-detail-cod">${escHtml(it.cod)}${(it.cant&&it.cant>1)?` ×${it.cant}`:''}</span>
            </div>`).join(''):`<div class="mant-card-empty">Sin referencias definidas todavía.</div>`}
        </div>`:'';
      return `<div class="mant-card">
        <div class="mant-card-head">
          <div>
            <div class="mant-card-mant" style="font-size:13px">${escHtml(c.mantenimiento)}</div>
          </div>
          <div class="mant-card-meta">
            <span class="mant-card-badge">${n} ref${n===1?'':'s'}</span>
            <span class="mant-card-date">${fecha}${c.actualizadoPor?' · '+escHtml(c.actualizadoPor):''}</span>
          </div>
        </div>
        <div class="mant-card-actions">
          <button type="button" class="rpt-btn close" style="padding:5px 12px;font-size:11px" data-id="${escHtml(c.id)}" onclick="mantToggleRefs(this.dataset.id)">${expanded?'▲ Ocultar refs':'▼ Ver refs'}</button>
          <button type="button" class="rpt-btn print" style="padding:5px 12px;font-size:11px" data-id="${escHtml(c.id)}" onclick="mantOpenEdit(this.dataset.id)">✏️ Editar</button>
          ${mantCanManage()?`<button type="button" class="rpt-btn close" style="padding:5px 12px;font-size:11px" data-id="${escHtml(c.id)}" onclick="mantDeleteCombo(this.dataset.id)">🗑️</button>`:''}
        </div>
        ${detail}
      </div>`;
    }).join('');

    return `<div class="mant-vgroup">
      <div class="mant-vgroup-head">
        <span class="mant-vgroup-title">${escHtml(vehiculo)}</span>
        <button type="button" class="rpt-btn close" style="padding:5px 12px;font-size:11px" onclick="mantOpenNew('${jsAttrSafe(vehiculo)}')">➕ Agregar km</button>
      </div>
      ${gapNote}
      ${rowsHtml}
    </div>`;
  }).join('');
}

// ── Vista edición ──
function mantToggleRefs(id){
  if(MANT_EXPANDED.has(id)) MANT_EXPANDED.delete(id);
  else MANT_EXPANDED.add(id);
  renderMantList();
}
function mantOpenNew(prefillVeh){
  MANT_EDITING_ID=null;
  MANT_EDIT_ITEMS=[];
  document.getElementById('mant-f-vehiculo').value=prefillVeh||'';
  document.getElementById('mant-f-mant').value='';
  document.getElementById('mant-f-vehiculo').disabled=false;
  document.getElementById('mant-f-mant').disabled=false;
  document.getElementById('mant-f-delete').style.display='none';
  mantRefreshDatalists();
  mantRenderItems();
  document.getElementById('mant-list-view').style.display='none';
  document.getElementById('mant-edit-view').style.display='block';
  if(prefillVeh) setTimeout(()=>document.getElementById('mant-f-mant').focus(),50);
}
function mantOpenEdit(id){
  const c=MANT_COMBOS.find(x=>x.id===id);
  if(!c) return;
  MANT_EDITING_ID=id;
  MANT_EDIT_ITEMS=(c.items||[]).map(it=>({tag:it.tag||'',cod:it.cod||'',cant:it.cant||1}));
  document.getElementById('mant-f-vehiculo').value=c.vehiculo;
  document.getElementById('mant-f-mant').value=c.mantenimiento;
  // Renombrar vehículo/mantenimiento acá crearía otro doc (el id sale de
  // ambos) — para eso está "Nuevo combo"; acá solo se editan referencias.
  document.getElementById('mant-f-vehiculo').disabled=true;
  document.getElementById('mant-f-mant').disabled=true;
  document.getElementById('mant-f-delete').style.display=mantCanManage()?'inline-block':'none';
  mantRefreshDatalists();
  mantRenderItems();
  document.getElementById('mant-list-view').style.display='none';
  document.getElementById('mant-edit-view').style.display='block';
}
function mantCloseEdit(){
  document.getElementById('mant-edit-view').style.display='none';
  document.getElementById('mant-list-view').style.display='block';
  renderMantList();
}
function mantAddItemRow(){ MANT_EDIT_ITEMS.push({tag:'',cod:'',cant:1}); mantRenderItems(); }
function mantRemoveItemRow(idx){ MANT_EDIT_ITEMS.splice(idx,1); mantRenderItems(); }
function mantItemField(idx,field,val){
  if(!MANT_EDIT_ITEMS[idx]) return;
  MANT_EDIT_ITEMS[idx][field] = field==='cant' ? (Math.max(1,Number(val)||1)) : val;
}
// Línea chica bajo el código: descripción + stock/ubicación tomados del
// inventario actual (INV), igual que hace el cotizador — así se ve de una
// si la referencia existe y si hay para entregar sin pedirla.
function mantItemHint(it){
  if(!it.cod) return '';
  const ctx=cotInvContext(it.cod);
  if(!ctx.row && ctx.precio==null) return `<span style="color:var(--amber)">Sin coincidencia en inventario/precios</span>`;
  const stockTxt = ctx.stock!=null ? (ctx.stock>0?`Stock ${fmt(ctx.stock)}`:`<span style="color:var(--red)">Sin stock</span>`) : 'Sin dato de stock';
  const ubiTxt = ctx.ubi ? ` · ${escHtml(ctx.ubi)}` : '';
  const descTxt = ctx.desc ? `${escHtml(ctx.desc)} — ` : '';
  return `${descTxt}${stockTxt}${ubiTxt}`;
}
function mantRenderItems(){
  const body=document.getElementById('mantItemsBody');
  if(!body) return;
  body.innerHTML = MANT_EDIT_ITEMS.map((it,idx)=>`
    <div class="cot-item-row" data-idx="${idx}">
      <input class="rpt-input" style="flex:0 0 150px" list="mantTagList" value="${escHtml(it.tag)}" placeholder="Categoría (opcional)" oninput="mantItemField(${idx},'tag',this.value)">
      <div class="cot-item-code-wrap">
        <input class="rpt-input" value="${escHtml(it.cod)}" placeholder="Código" autocomplete="off"
          oninput="mantItemCodeInput(${idx},this.value)" onblur="mantItemCodeBlur(${idx})">
        <div class="cot-drop" id="mantDrop${idx}"></div>
      </div>
      <div style="flex:2;min-width:0;font-size:10px;color:var(--text3);display:flex;align-items:center">${mantItemHint(it)}</div>
      <input class="rpt-input" style="flex:0 0 60px" type="number" min="1" step="1" value="${it.cant||1}" oninput="mantItemField(${idx},'cant',this.value)" title="Cantidad">
      <button type="button" class="rpt-btn close" style="flex:0 0 30px;padding:4px 0" onclick="mantRemoveItemRow(${idx})" title="Quitar referencia">✕</button>
    </div>
  `).join('');
  const cEl=document.getElementById('mantItemCount');
  if(cEl) cEl.textContent = String(MANT_EDIT_ITEMS.filter(it=>it.cod).length);
}
function mantItemCodeInput(idx,val){
  if(MANT_EDIT_ITEMS[idx]) MANT_EDIT_ITEMS[idx].cod=val;
  const drop=document.getElementById('mantDrop'+idx);
  if(!drop) return;
  const q=(val||'').trim().toUpperCase();
  if(!q){ drop.innerHTML=''; drop.classList.remove('on'); return; }
  const seen=new Set();
  const matches=[];
  for(const r of INV){
    const key=String(r[0]||'').toUpperCase();
    if(!key||seen.has(key)) continue;
    if(matchesQuery(q,key,String(r[1]||'').toUpperCase())){
      matches.push({cod:r[0],desc:r[1]||'',enInv:true});
      seen.add(key);
      if(matches.length>=8) break;
    }
  }
  if(matches.length<8){
    for(const [cod,row] of Object.entries(PRICES)){
      const key=cod.toUpperCase();
      if(seen.has(key)) continue;
      const desc=row[2]||'';
      if(matchesQuery(q,key,desc.toUpperCase())){
        matches.push({cod,desc,enInv:false});
        seen.add(key);
        if(matches.length>=8) break;
      }
    }
  }
  if(!matches.length){ drop.innerHTML='<div style="padding:6px 8px;font-family:var(--mono);font-size:10px;color:var(--text3)">Sin coincidencias</div>'; drop.classList.add('on'); return; }
  drop.innerHTML=matches.map(m=>
    `<button type="button" class="cot-drop-item" onmousedown="event.preventDefault();mantPickItem(${idx},${escHtml(JSON.stringify(m.cod))})"><b>${escHtml(m.cod)}</b> — ${escHtml(m.desc||'(sin descripción)')}${!m.enInv?' <span style="color:var(--amber)">· sin stock físico</span>':''}</button>`
  ).join('');
  drop.classList.add('on');
}
function mantPickItem(idx,cod){
  if(!MANT_EDIT_ITEMS[idx]) return;
  MANT_EDIT_ITEMS[idx].cod=cod;
  const drop=document.getElementById('mantDrop'+idx);
  if(drop) drop.classList.remove('on');
  mantRenderItems();
}
function mantItemCodeBlur(idx){
  // Deja tiempo a que el onmousedown de una sugerencia registre antes de
  // cerrar el dropdown (mismo criterio que cotItemCodeBlur).
  setTimeout(()=>{ const drop=document.getElementById('mantDrop'+idx); if(drop) drop.classList.remove('on'); },150);
}

// ── Guardar / eliminar ──
async function mantSaveCombo(){
  const vehiculo=document.getElementById('mant-f-vehiculo').value.trim();
  const mantenimiento=document.getElementById('mant-f-mant').value.trim();
  if(!vehiculo||!mantenimiento){ alert('Completa vehículo y mantenimiento.'); return; }
  const items=MANT_EDIT_ITEMS.filter(it=>it.cod&&it.cod.trim()).map(it=>({tag:(it.tag||'').trim(),cod:it.cod.trim(),cant:Math.max(1,Number(it.cant)||1)}));
  const id=MANT_EDITING_ID || mantDocId(vehiculo,mantenimiento);
  const payload={vehiculo,mantenimiento,items,ts:Date.now(),actualizadoPor:CURRENT_USER?.nombre||CURRENT_USER?.email||''};
  // Optimista local primero: el cambio se ve ya mismo aunque la nube tarde o falle.
  const idx=MANT_COMBOS.findIndex(c=>c.id===id);
  if(idx>=0) MANT_COMBOS[idx]={...MANT_COMBOS[idx],...payload};
  else MANT_COMBOS.push({id,...payload});
  mantSaveLocalCache();
  mantCloseEdit();
  if(!db){ alert('Guardado en este dispositivo. La nube no está disponible ahora mismo.'); return; }
  try{ await db.collection(MANT_COLLECTION).doc(id).set(payload); }
  catch(e){
    console.warn('[Mantenimientos] No se pudo guardar en la nube — quedó guardado localmente:', e);
    alert('No se pudo sincronizar con la nube ahora mismo. El combo quedó guardado en este dispositivo.');
  }
}
async function mantDeleteCombo(id){
  if(!mantCanManage() || !id) return;
  if(!confirm('¿Eliminar este combo? Esta acción no se puede deshacer.')) return;
  MANT_COMBOS=MANT_COMBOS.filter(c=>c.id!==id);
  mantSaveLocalCache();
  mantCloseEdit();
  if(!db) return;
  try{ await db.collection(MANT_COLLECTION).doc(id).delete(); }
  catch(e){
    console.warn('[Mantenimientos] No se pudo borrar en la nube:', e);
    alert('No se pudo eliminar en la nube ahora mismo (se quitó localmente) — revisa tu conexión.');
  }
}

// ── Exportar / Importar JSON en bloque ──
// El formato de exportación es compatible con el de Prepull
// ({combinaciones:[{vehiculo,mantenimiento,repuestos:{...}}]}) y también
// acepta el propio formato interno ({items:[{tag,cod,cant}]}), así que un
// archivo exportado desde acá se puede volver a importar sin pérdidas.
function mantExportJson(){
  const combinaciones=MANT_COMBOS.map(c=>({vehiculo:c.vehiculo,mantenimiento:c.mantenimiento,items:c.items||[]}));
  const payload={exportadoEn:new Date().toISOString(),total:combinaciones.length,combinaciones};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`mant_combos_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function mantImportJsonPick(){
  if(!mantCanManage()){ alert('Solo un admin o supervisor puede importar combos en bloque.'); return; }
  document.getElementById('mantImportFile').click();
}
async function mantImportJsonFile(ev){
  const file=ev.target.files && ev.target.files[0];
  ev.target.value='';
  if(!file) return;
  let data;
  try{ data=JSON.parse(await file.text()); }
  catch(e){ alert('El archivo no es un JSON válido.'); return; }
  const combos = Array.isArray(data) ? data : (Array.isArray(data.combinaciones) ? data.combinaciones : null);
  if(!combos){ alert('No se encontró un arreglo "combinaciones" en el archivo (ni un arreglo en la raíz).'); return; }

  let creados=0, actualizados=0, omitidos=0;
  const now=Date.now();
  const autor=CURRENT_USER?.nombre||CURRENT_USER?.email||'';
  const writes=[];
  for(const raw of combos){
    const vehiculo=String(raw.vehiculo||'').trim();
    const mantenimiento=String(raw.mantenimiento||'').trim();
    if(!vehiculo||!mantenimiento){ omitidos++; continue; }
    let items=[];
    if(raw.repuestos && typeof raw.repuestos==='object' && !Array.isArray(raw.repuestos)){
      // Formato Prepull: {FILTRO_ACEITE:"cod", ARO_TAPON:"", ...} — se
      // descartan las categorías vacías, no se guardan filas en blanco.
      items=Object.entries(raw.repuestos).filter(([,v])=>v&&String(v).trim()).map(([tag,v])=>({tag,cod:String(v).trim(),cant:1}));
    }else if(Array.isArray(raw.items)){
      items=raw.items.filter(it=>it&&it.cod).map(it=>({tag:it.tag||'',cod:String(it.cod).trim(),cant:Math.max(1,Number(it.cant)||1)}));
    }
    const id=mantDocId(vehiculo,mantenimiento);
    if(MANT_COMBOS.some(c=>c.id===id)) actualizados++; else creados++;
    writes.push({id,payload:{vehiculo,mantenimiento,items,ts:now,actualizadoPor:autor}});
  }
  if(!writes.length){ alert('No había combos válidos para importar.'); return; }
  if(!confirm(`Se van a guardar ${writes.length} combos (${creados} nuevos, ${actualizados} actualizaciones${omitidos?`, ${omitidos} omitidos por datos incompletos`:''}). ¿Continuar?`)) return;

  // Optimista local primero, por si la nube tarda o falla.
  writes.forEach(w=>{
    const idx=MANT_COMBOS.findIndex(c=>c.id===w.id);
    if(idx>=0) MANT_COMBOS[idx]={...MANT_COMBOS[idx],...w.payload};
    else MANT_COMBOS.push({id:w.id,...w.payload});
  });
  mantSaveLocalCache();
  renderMantList();

  if(!db){ alert(`Importado localmente: ${creados} nuevos, ${actualizados} actualizados. La nube no está disponible ahora mismo.`); return; }
  try{
    // Máx. 500 escrituras por lote en Firestore — margen de seguridad de
    // 450, mismo criterio que el resto de la app (ver migración de
    // snapshots de estantes).
    for(let i=0;i<writes.length;i+=450){
      const batch=db.batch();
      writes.slice(i,i+450).forEach(w=>batch.set(db.collection(MANT_COLLECTION).doc(w.id), w.payload));
      await batch.commit();
    }
    alert(`Importación completa: ${creados} combos nuevos, ${actualizados} actualizados.`);
  }catch(e){
    console.error('[Mantenimientos] Falló la importación en la nube:', e);
    alert('Los combos quedaron guardados en este dispositivo, pero no se pudo sincronizar todo con la nube. Revisa tu conexión e intenta de nuevo (no se duplicará nada).');
  }
}

export { MANT_COMBOS, MANT_EDITING_ID, MANT_EXPANDED, closeMantModal, mantAddItemRow, mantCloseEdit, mantDeleteCombo, mantExportJson, mantImportJsonFile, mantImportJsonPick, mantItemCodeBlur, mantItemCodeInput, mantItemField, mantOpenEdit, mantOpenNew, mantPickItem, mantRefreshFromCloud, mantRemoveItemRow, mantSaveCombo, mantSearchInput, mantToggleRefs, openMantModal, renderMantList, startMantListener };
