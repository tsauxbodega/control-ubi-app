import { CURRENT_USER, db } from './auth.js';
import { cloudLoad, cloudSave } from './cloud-sync.js';
import { INV, KAIZEN_EXT, PICKLIST, PRICES, PRICE_TYPES } from './state-globals.js';
import { getPriceRow, normCode } from './file-upload.js';
import { getEffectivePrice, getPriceByType } from './precios-divisor.js';
import { matchesQuery } from './buscador.js';
import { cop, escHtml, fmt, jsAttrSafe } from './utils.js';
import { rptApplyColOrder, rptGetData } from './reporte-imprimible.js';
// ═══ js/cotizador.js — extraído de index.html (líneas 16755–17770 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
/* ══════════════════════════════════════════════════════════════════════
   COTIZACIÓN / PEDIDO
   Documento comercial interno (no es factura electrónica DIAN — no lleva
   resolución/CUFE). Pensado para operar en papel cuando no hay Internet
   ni acceso al ERP oficial: se llena, se firma físicamente, y se concilia
   contra el sistema oficial cuando vuelva la conexión.
   Reutiliza el mismo mecanismo de impresión que el Reporte (#rptPrintArea).
   ══════════════════════════════════════════════════════════════════════ */
let COT_ITEMS=[];
let COT_TIPO='COT';
let COT_CONFIG={razonSocial:'',nit:'',direccion:'',telefono:'',logoBase64:'',vendedores:[]};

/* ── Datos compartidos del equipo (empresa/logo/vendedores/clientes) ──
   Viven en equipo/cotizador_config y equipo/cotizador_clientes — la regla
   de Firestore "match /equipo/{docId} { allow read, write: if isSignedIn() }"
   ya cubre esto sin tocar reglas. Se sincronizan en vivo (onSnapshot) para
   que cualquiera con acceso a Exportar vea los mismos datos sin tener que
   configurarlos cada quien en su dispositivo. localStorage queda como
   caché instantánea (arranca el modal sin esperar red) y respaldo offline. */
const COT_CONFIG_DOC='equipo/cotizador_config';
const COT_CLIENTES_DOC='equipo/cotizador_clientes';
const COT_SEQ_DOC='equipo/cotizador_seq';
let _cotConfigUnsub=null, _cotClientesUnsub=null;
let COT_CLIENTES_CLOUD=null; // null = todavía no llegó nada de la nube en esta sesión

function cotLoadConfig(){
  // Carga instantánea desde caché local; watchCotConfig() la actualiza en
  // cuanto responde Firestore (puede tardar un instante la primera vez).
  COT_CONFIG={razonSocial:'',nit:'',direccion:'',telefono:'',logoBase64:'',vendedores:[]};
  try{
    const raw=localStorage.getItem('ctrl_cot_config');
    if(raw) Object.assign(COT_CONFIG, JSON.parse(raw));
  }catch(e){}
}
function watchCotConfig(){
  if(!CURRENT_USER) return;
  if(_cotConfigUnsub){ _cotConfigUnsub(); _cotConfigUnsub=null; }
  _cotConfigUnsub=db.doc(COT_CONFIG_DOC).onSnapshot(snap=>{
    if(!snap.exists) return;
    const d=snap.data()||{};
    COT_CONFIG={
      razonSocial:d.razonSocial||'', nit:d.nit||'', direccion:d.direccion||'',
      telefono:d.telefono||'', logoBase64:d.logoBase64||'', vendedores:d.vendedores||[]
    };
    try{ localStorage.setItem('ctrl_cot_config', JSON.stringify(COT_CONFIG)); }catch(e){}
    // Si el modal ya está abierto, refresca los campos sin interrumpir al
    // usuario (p.ej. otro compañero acaba de subir el logo).
    if(document.getElementById('cotOverlay')?.classList.contains('on')) cotRefreshConfigFields();
  }, err=>console.warn('[Cotizador] watchCotConfig sin sincronizar (revisa Firestore rules equipo/{docId}):', err));
}
function cotRefreshConfigFields(){
  const razon=document.getElementById('cotEmpRazon'); if(razon && document.activeElement!==razon) razon.value=COT_CONFIG.razonSocial;
  const nit=document.getElementById('cotEmpNit'); if(nit && document.activeElement!==nit) nit.value=COT_CONFIG.nit;
  const dir=document.getElementById('cotEmpDir'); if(dir && document.activeElement!==dir) dir.value=COT_CONFIG.direccion;
  const tel=document.getElementById('cotEmpTel'); if(tel && document.activeElement!==tel) tel.value=COT_CONFIG.telefono;
  const img=document.getElementById('cotLogoPreview');
  if(img){ if(COT_CONFIG.logoBase64){ img.src=COT_CONFIG.logoBase64; img.style.display='inline-block'; } else img.style.display='none'; }
  cotRenderVendedores();
}
function cotSaveConfig(){
  COT_CONFIG.razonSocial=document.getElementById('cotEmpRazon').value.trim();
  COT_CONFIG.nit=document.getElementById('cotEmpNit').value.trim();
  COT_CONFIG.direccion=document.getElementById('cotEmpDir').value.trim();
  COT_CONFIG.telefono=document.getElementById('cotEmpTel').value.trim();
  try{ localStorage.setItem('ctrl_cot_config', JSON.stringify(COT_CONFIG)); }catch(e){}
  cotSaveConfigCloud();
  const details=document.getElementById('cotEmpresaDetails');
  if(details) details.open=false;
}
function cotSaveConfigCloud(){
  if(!CURRENT_USER) return;
  db.doc(COT_CONFIG_DOC).set({...COT_CONFIG, updatedAt:Date.now(), updatedBy:CURRENT_USER.nombre||CURRENT_USER.email||''})
    .catch(e=>console.warn('[Cotizador] No se pudo guardar la config en la nube (quedó local igual):', e));
}
function cotLogoUpload(ev){
  const file=ev.target.files && ev.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    COT_CONFIG.logoBase64=reader.result;
    try{ localStorage.setItem('ctrl_cot_config', JSON.stringify(COT_CONFIG)); }catch(e){}
    cotSaveConfigCloud();
    const img=document.getElementById('cotLogoPreview');
    if(img){ img.src=reader.result; img.style.display='inline-block'; }
  };
  reader.readAsDataURL(file);
}
/* ── Directorio de clientes (compartido con todo el equipo) ──
   Cada vez que se imprime una cotización/pedido, el cliente se guarda
   (o actualiza) en equipo/cotizador_clientes — así CUALQUIERA del equipo
   que atienda a ese cliente después ve los mismos datos, no solo quien lo
   registró la primera vez. */
const COT_CLIENTES_KEY='ctrl_cot_clientes';
function watchCotClientes(){
  if(!CURRENT_USER) return;
  if(_cotClientesUnsub){ _cotClientesUnsub(); _cotClientesUnsub=null; }
  _cotClientesUnsub=db.doc(COT_CLIENTES_DOC).onSnapshot(snap=>{
    COT_CLIENTES_CLOUD=snap.exists?(snap.data().list||[]):[];
    try{ localStorage.setItem(COT_CLIENTES_KEY, JSON.stringify(COT_CLIENTES_CLOUD)); }catch(e){}
  }, err=>console.warn('[Cotizador] watchCotClientes sin sincronizar:', err));
}
function cotReadClientes(){
  if(COT_CLIENTES_CLOUD!==null) return COT_CLIENTES_CLOUD; // la nube ya respondió esta sesión
  try{ return JSON.parse(localStorage.getItem(COT_CLIENTES_KEY)||'[]')||[]; }catch(e){ return []; }
}
function cotSaveClienteToDirectory(cli){
  if(!cli.nombre) return;
  let list=cotReadClientes();
  // Empareja por documento o NIT si hay alguno (más confiable que el
  // nombre, que puede escribirse distinto cada vez); si no hay ninguno
  // de los dos, empareja por nombre exacto.
  const idx=list.findIndex(c =>
    (cli.doc && c.doc && c.doc.toUpperCase()===cli.doc.toUpperCase()) ||
    (cli.nit && c.nit && c.nit.toUpperCase()===cli.nit.toUpperCase()) ||
    (!cli.doc && !cli.nit && !c.doc && !c.nit && c.nombre.toUpperCase()===cli.nombre.toUpperCase())
  );
  if(idx>=0) list[idx]={...list[idx], ...cli};
  else list.unshift({...cli});
  if(list.length>500) list=list.slice(0,500);
  COT_CLIENTES_CLOUD=list;
  try{ localStorage.setItem(COT_CLIENTES_KEY, JSON.stringify(list)); }catch(e){}
  if(CURRENT_USER){
    db.doc(COT_CLIENTES_DOC).set({list, updatedAt:Date.now()})
      .catch(e=>console.warn('[Cotizador] Directorio de clientes sin sincronizar (quedó local igual):', e));
  }
}
function cotClienteSearch(val){
  const drop=document.getElementById('cotClienteDrop');
  if(!drop) return;
  const q=(val||'').trim().toUpperCase();
  if(!q){ drop.innerHTML=''; drop.classList.remove('on'); return; }
  const list=cotReadClientes();
  const matches=list.filter(c =>
    (c.nombre||'').toUpperCase().includes(q) || (c.doc||'').toUpperCase().includes(q) || (c.nit||'').toUpperCase().includes(q)
  ).slice(0,8);
  if(!matches.length){ drop.innerHTML=''; drop.classList.remove('on'); return; }
  drop.innerHTML=matches.map((c,i)=>
    `<button type="button" class="cot-drop-item" onmousedown="event.preventDefault();cotPickCliente(${i})"><b>${escHtml(c.nombre)}</b>${c.doc?' · CC '+escHtml(c.doc):''}${c.nit?' · NIT '+escHtml(c.nit):''}</button>`
  ).join('');
  drop._matches=matches; // guardado temporal para no tener que re-filtrar en el clic
  drop.classList.add('on');
}
function cotPickCliente(i){
  const drop=document.getElementById('cotClienteDrop');
  const c=drop && drop._matches ? drop._matches[i] : null;
  if(!c) return;
  document.getElementById('cotCliNombre').value=c.nombre||'';
  document.getElementById('cotCliDoc').value=c.doc||'';
  document.getElementById('cotCliNit').value=c.nit||'';
  document.getElementById('cotCliTel').value=c.tel||'';
  document.getElementById('cotCliEmail').value=c.email||'';
  document.getElementById('cotCliDir').value=c.dir||'';
  cotClienteDropClose();
  cotAutosaveDraft();
}
function cotClienteDropClose(){
  const drop=document.getElementById('cotClienteDrop');
  if(drop) drop.classList.remove('on');
}

function cotAddVendedor(){
  const inp=document.getElementById('cotVendedorNuevo');
  const nm=(inp.value||'').trim();
  if(!nm) return;
  if(!COT_CONFIG.vendedores.includes(nm)) COT_CONFIG.vendedores.push(nm);
  inp.value='';
  try{ localStorage.setItem('ctrl_cot_config', JSON.stringify(COT_CONFIG)); }catch(e){}
  cotSaveConfigCloud();
  cotRenderVendedores();
}
function cotRemoveVendedor(nm){
  COT_CONFIG.vendedores=COT_CONFIG.vendedores.filter(v=>v!==nm);
  try{ localStorage.setItem('ctrl_cot_config', JSON.stringify(COT_CONFIG)); }catch(e){}
  cotSaveConfigCloud();
  cotRenderVendedores();
}
function cotRenderVendedores(){
  const box=document.getElementById('cotVendedoresList');
  if(box){
    box.innerHTML = COT_CONFIG.vendedores.length ? COT_CONFIG.vendedores.map(v=>
      `<span class="chip" style="cursor:default">${escHtml(v)} <button type="button" onclick="cotRemoveVendedor(${escHtml(JSON.stringify(v))})" style="background:none;border:none;color:var(--red);cursor:pointer;margin-left:4px;font-size:11px;padding:0" title="Quitar">✕</button></span>`
    ).join('') : '<span style="font-family:var(--mono);font-size:10px;color:var(--text3)">Sin vendedores agregados todavía.</span>';
  }
  const sel=document.getElementById('cotVendedorSel');
  if(sel){
    const prev=sel.value;
    sel.innerHTML = '<option value="">— Seleccionar —</option>'+COT_CONFIG.vendedores.map(v=>`<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
    if(prev && COT_CONFIG.vendedores.includes(prev)) sel.value=prev;
  }
}

/* ── Numeración consecutiva, CONTINUA para todo el equipo ──
   Vive en equipo/cotizador_seq y se incrementa con una transacción de
   Firestore, así que dos vendedores finalizando un documento al mismo
   tiempo nunca reciben el mismo número. Si no hay red, cae a un contador
   local marcado "-OFF" (para que sea obvio que hay que revisarlo cuando
   vuelva la conexión — no es un número oficial continuo). Los números ya
   asignados dentro del borrador actual se guardan en _cotNumCache para no
   gastar un consecutivo nuevo solo por alternar el toggle Cotización/Pedido. */
let _cotNumCache={COT:null, PED:null};
async function cotNextNumberCloud(tipo){
  if(!CURRENT_USER) return cotNextNumberLocal(tipo);
  try{
    const next=await Promise.race([
      db.runTransaction(async tx=>{
        const ref=db.doc(COT_SEQ_DOC);
        const snap=await tx.get(ref);
        const seq=snap.exists?(snap.data()||{}):{};
        const n=(seq[tipo]||0)+1;
        tx.set(ref, {...seq, [tipo]:n, updatedAt:Date.now()});
        return n;
      }),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout-cotSeq')),6000))
    ]);
    return tipo+'-'+String(next).padStart(5,'0');
  }catch(e){
    console.warn('[Cotizador] Numeración en la nube falló, se usa respaldo local (revisar al reconectar):', e);
    return cotNextNumberLocal(tipo);
  }
}
function cotNextNumberLocal(tipo){
  let seq={};
  try{ seq=JSON.parse(localStorage.getItem('ctrl_cot_seq')||'{}')||{}; }catch(e){}
  seq[tipo]=(seq[tipo]||0)+1;
  try{ localStorage.setItem('ctrl_cot_seq', JSON.stringify(seq)); }catch(e){}
  return tipo+'-OFF'+String(seq[tipo]).padStart(4,'0');
}
async function cotSetTipo(tipo){
  COT_TIPO=tipo;
  document.querySelectorAll('#cotTipoTog .togbtn').forEach(b=>b.classList.toggle('on', b.dataset.val===tipo));
  const numEl=document.getElementById('cotNum');
  if(_cotNumCache[tipo]){
    numEl.value=_cotNumCache[tipo];
  }else{
    numEl.value='···';
    const n=await cotNextNumberCloud(tipo);
    _cotNumCache[tipo]=n;
    if(COT_TIPO===tipo) numEl.value=n; // por si alternó de tipo mientras esperaba la nube
  }
  cotAutosaveDraft();
}
// Igual que cotSetTipo pero SIN generar un número consecutivo nuevo — la
// usa cotLoadFromHistory()/cotLoadDraft() para restaurar un documento que
// ya tenía número asignado, sin gastar uno de más.
function cotSetTipoSilent(tipo){
  COT_TIPO=tipo;
  document.querySelectorAll('#cotTipoTog .togbtn').forEach(b=>b.classList.toggle('on', b.dataset.val===tipo));
}

/* ── Ítems ── */
// Trae al documento los ítems que ya estén marcados con el botón "+" en
// Buscador, Ubicaciones, Precios, Nostock, etc. (la misma Selection Tray
// que usa el picking) — así no hay que escribir código por código: se
// van marcando mientras se navega y se importan todos de una vez acá.
// Trae del inventario todo lo que la cotización puede aprovechar de un
// código: precio correcto según grupo (accesorios usa otra tarifa),
// stock actual, ubicación, costo (para el margen, solo visible acá
// adentro, nunca se imprime) y unidades en tránsito (O/O) si no hay stock.
function cotInvContext(cod){
  const r=INV.find(x=>x[0]===cod);
  const pr=getPriceRow(cod);
  const kz=KAIZEN_EXT[normCode(cod)];
  // Puede existir en la lista de precios sin estar en el inventario físico
  // actual (catálogo, referencia de pedido especial) — se sigue pudiendo
  // cotizar, solo que sin dato de stock/ubicación.
  if(!r && !pr) return {row:null, desc:'', precio:null, stock:null, ubi:null, costo:null, transito:0};
  const precio = pr ? (COT_PRICE_TYPE ? getPriceByType(pr, COT_PRICE_TYPE) : getEffectivePrice(pr, r?r[6]:'')) : null;
  return {
    row: r||null,
    desc: r ? r[1] : (pr ? pr[2] : ''),
    precio,
    stock: r ? Number(r[2])||0 : null,
    ubi: r ? r[3] : null,
    costo: r ? Number(r[7])||0 : (pr ? Number(pr[3])||0 : null),
    transito: kz ? Number(kz.oo)||0 : 0
  };
}
// Tipo de precio elegido para TODA la cotización (''=automático, el
// mismo criterio de siempre: mostrador o accesorios según el grupo del
// ítem). Al cambiarlo desde el selector, se recalculan los precios de
// los ítems ya agregados que sí tengan ese tipo disponible.
let COT_PRICE_TYPE='';
function cotSetPriceType(key){
  COT_PRICE_TYPE=key||'';
  COT_ITEMS.forEach(it=>{
    if(!it.cod) return;
    const ctx=cotInvContext(it.cod);
    if(ctx.precio!=null) it.precio=Math.round(ctx.precio);
  });
  cotRenderItems();
  cotCalcTotals();
}
function cotImportFromPicklist(){
  if(!PICKLIST.size){
    alert('La Selection Tray está vacía.\n\nMarca referencias con el botón "+" en Buscador, Ubicaciones, Precios, etc., y vuelve a este botón para traerlas.');
    return;
  }
  const soloVacia = COT_ITEMS.length===1 && !COT_ITEMS[0].cod && !COT_ITEMS[0].desc;
  if(soloVacia) COT_ITEMS=[];
  const existentes=new Set(COT_ITEMS.map(it=>String(it.cod||'').toUpperCase()).filter(Boolean));
  let agregados=0;
  PICKLIST.forEach(it=>{
    const cod=String(it.cod||'').trim();
    if(!cod || cod==='---') return; // fila simulada de "ubicación libre" del Buscador, no es un ítem real
    if(existentes.has(cod.toUpperCase())) return; // evita duplicados si ya estaba agregado a mano
    const ctx=cotInvContext(cod);
    COT_ITEMS.push({
      cod,
      desc: it.desc || (ctx.row ? ctx.row[1] : '') || '',
      cant: 1,
      precio: ctx.precio ? Math.round(ctx.precio) : 0,
      stock: ctx.stock, ubi: ctx.ubi, costo: ctx.costo, transito: ctx.transito
    });
    existentes.add(cod.toUpperCase());
    agregados++;
  });
  if(!COT_ITEMS.length) COT_ITEMS=[{cod:'',desc:'',cant:1,precio:0}];
  cotRenderItems();
  cotCalcTotals();
  if(agregados) alert(agregados+' ítem'+(agregados===1?'':'s')+' importado'+(agregados===1?'':'s')+' desde la Selection Tray.');
  else alert('Los ítems de la Selection Tray ya estaban agregados.');
}
function cotAddItemRow(){
  COT_ITEMS.push({cod:'',desc:'',cant:1,precio:0,stock:null,ubi:null,costo:null,transito:0});
  cotRenderItems();
}
function cotRemoveItemRow(idx){
  COT_ITEMS.splice(idx,1);
  if(!COT_ITEMS.length) COT_ITEMS.push({cod:'',desc:'',cant:1,precio:0,stock:null,ubi:null,costo:null,transito:0});
  cotRenderItems();
  cotCalcTotals();
}
function cotRenderItems(){
  const body=document.getElementById('cotItemsBody');
  if(!body) return;
  body.innerHTML = COT_ITEMS.map((it,idx)=>{
    const sub=(Number(it.cant)||0)*(Number(it.precio)||0);
    return `<div class="cot-item-row" data-idx="${idx}">
      <div class="cot-item-code-wrap">
        <input class="rpt-input" value="${escHtml(it.cod)}" placeholder="Código" autocomplete="off"
          oninput="cotItemCodeInput(${idx},this.value)" onblur="cotItemCodeBlur(${idx})">
        <div class="cot-drop" id="cotDrop${idx}"></div>
      </div>
      <div style="flex:2;min-width:0">
        <input class="rpt-input" style="width:100%;box-sizing:border-box" value="${escHtml(it.desc)}" placeholder="Descripción" oninput="cotItemField(${idx},'desc',this.value)">
        ${cotItemHint(it)}
      </div>
      <input class="rpt-input" style="flex:0 0 64px" type="number" min="0" step="1" value="${it.cant}" oninput="cotItemField(${idx},'cant',this.value)">
      <input class="rpt-input" style="flex:0 0 104px" type="number" min="0" step="1" value="${it.precio}" oninput="cotItemField(${idx},'precio',this.value)">
      <div class="cot-item-sub">${cop(Math.round(sub))}</div>
      <button type="button" class="rpt-btn close" style="flex:0 0 30px;padding:4px 0" onclick="cotRemoveItemRow(${idx})" title="Quitar ítem">✕</button>
    </div>`;
  }).join('');
  const n=COT_ITEMS.filter(it=>it.cod||it.desc).length;
  const cEl=document.getElementById('cotItemCount');
  if(cEl) cEl.textContent = n+' ítem'+(n===1?'':'s');
  cotRenderStockWarning();
}
// Línea chica bajo la descripción: stock/ubicación (para saber si se puede
// entregar de una vez o hay que pedirlo) y margen sobre costo (SOLO
// visible acá adentro para el vendedor — nunca aparece en el documento
// impreso, ver cotBuildDocHtml).
function cotItemHint(it){
  if(!it.cod) return '';
  const bits=[];
  if(it.stock!=null){
    const okStock=it.stock>=(Number(it.cant)||0) && it.stock>0;
    const color=okStock?'var(--green)':'var(--red)';
    let txt=`Stock: ${fmt(it.stock)}${it.ubi?' en '+escHtml(it.ubi):''}`;
    if(!okStock && it.transito>0) txt+=` · ${fmt(it.transito)} en tránsito`;
    bits.push(`<span style="color:${color}">${txt}</span>`);
  } else {
    bits.push(`<span style="color:var(--amber)">No está en el inventario físico actual (solo en lista de precios)</span>`);
  }
  if(it.costo!=null && it.costo>0 && it.precio>0){
    const margen=((it.precio-it.costo)/it.precio*100);
    bits.push(`<span style="color:var(--text3)">Margen: ${margen.toFixed(0)}%</span>`);
  }
  return bits.length ? `<div style="font-family:var(--mono);font-size:8.5px;margin-top:2px;display:flex;gap:10px;flex-wrap:wrap">${bits.join('')}</div>` : '';
}
// Aviso (no bloqueante) si algún ítem no tiene stock suficiente para la
// cantidad pedida — ayuda a decidir si el documento debe salir como
// "Pedido" (para pedir/traer) en vez de entrega inmediata.
function cotRenderStockWarning(){
  const box=document.getElementById('cotStockWarning');
  if(!box) return;
  const faltantes=COT_ITEMS.filter(it=>it.cod && it.stock!=null && it.stock<(Number(it.cant)||0));
  if(!faltantes.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='block';
  box.innerHTML=`⚠️ ${faltantes.length} ítem${faltantes.length===1?'':'s'} sin stock suficiente para la cantidad pedida: `+
    faltantes.map(it=>`<b>${escHtml(it.cod)}</b>`).join(', ')+
    ' — considera generarlo como Pedido en vez de entrega inmediata.';
}
// Campos de texto/número: NO reconstruye toda la lista (perdería el foco
// del input mientras se escribe — mismo cuidado que ya se tuvo con el
// panel de columnas del Reporte). Solo actualiza el subtotal de esa fila
// y el total general.
function cotItemField(idx, field, val){
  if(!COT_ITEMS[idx]) return;
  COT_ITEMS[idx][field] = (field==='cant'||field==='precio') ? (Number(val)||0) : val;
  const row=document.querySelector(`.cot-item-row[data-idx="${idx}"]`);
  if(row){
    const it=COT_ITEMS[idx];
    const sub=(Number(it.cant)||0)*(Number(it.precio)||0);
    const subEl=row.querySelector('.cot-item-sub');
    if(subEl) subEl.textContent=cop(Math.round(sub));
    if(field==='cant'||field==='precio'){
      const hintWrap=row.children[1]; // el div que envuelve input de descripción + cotItemHint()
      if(hintWrap){
        let hintEl=hintWrap.querySelector('div');
        const hintHtml=cotItemHint(it);
        if(hintEl) hintEl.outerHTML = hintHtml || '<div></div>';
        else if(hintHtml) hintWrap.insertAdjacentHTML('beforeend', hintHtml);
      }
    }
  }
  if(field==='cant') cotRenderStockWarning();
  cotCalcTotals();
}
// Autocompletado de código: busca por código O descripción, cruzando
// INVENTARIO (igual que el Buscador principal) Y LISTA DE PRECIOS —
// así aparecen también referencias que tienen precio pero que hoy no
// están físicamente en bodega (catálogo, pedido especial), que antes
// eran invisibles para el cotizador aunque sí se pudieran vender.
function cotItemCodeInput(idx, val){
  if(COT_ITEMS[idx]) COT_ITEMS[idx].cod=val;
  const drop=document.getElementById('cotDrop'+idx);
  if(!drop) return;
  const q=(val||'').trim().toUpperCase();
  if(!q){ drop.innerHTML=''; drop.classList.remove('on'); return; }
  const seen=new Set();
  const matches=[];
  for(const r of INV){
    const key=String(r[0]||'').toUpperCase();
    if(!key || seen.has(key)) continue;
    if(matchesQuery(q, key, String(r[1]||'').toUpperCase())){
      matches.push({cod:r[0], desc:r[1]||'', enInv:true});
      seen.add(key);
      if(matches.length>=8) break;
    }
  }
  if(matches.length<8){
    for(const [cod,row] of Object.entries(PRICES)){
      const key=cod.toUpperCase();
      if(seen.has(key)) continue;
      const desc=row[2]||'';
      if(matchesQuery(q, key, desc.toUpperCase())){
        matches.push({cod, desc, enInv:false});
        seen.add(key);
        if(matches.length>=8) break;
      }
    }
  }
  if(!matches.length){ drop.innerHTML='<div style="padding:6px 8px;font-family:var(--mono);font-size:10px;color:var(--text3)">Sin coincidencias</div>'; drop.classList.add('on'); return; }
  drop.innerHTML=matches.map(m=>
    `<button type="button" class="cot-drop-item" onmousedown="event.preventDefault();cotPickItem(${idx},${escHtml(JSON.stringify(m.cod))})"><b>${escHtml(m.cod)}</b> — ${escHtml(m.desc||'(sin descripción)')}${!m.enInv?' <span style="color:var(--amber)">· sin stock físico</span>':''}</button>`
  ).join('');
  drop.classList.add('on');
}
function cotPickItem(idx, cod){
  const ctx=cotInvContext(cod);
  if((!ctx.row && ctx.precio==null) || !COT_ITEMS[idx]) return;
  COT_ITEMS[idx].cod=cod;
  COT_ITEMS[idx].desc=ctx.desc||'';
  if(ctx.precio!=null) COT_ITEMS[idx].precio=Math.round(ctx.precio);
  COT_ITEMS[idx].stock=ctx.stock;
  COT_ITEMS[idx].ubi=ctx.ubi;
  COT_ITEMS[idx].costo=ctx.costo;
  COT_ITEMS[idx].transito=ctx.transito;
  const drop=document.getElementById('cotDrop'+idx);
  if(drop) drop.classList.remove('on');
  cotRenderItems();
  cotCalcTotals();
}
// Respaldo si escriben el código completo y no hacen clic en ninguna
// sugerencia (p.ej. tabulan directo al siguiente campo): al perder el
// foco, si hay una coincidencia EXACTA y aún no se completó la
// descripción, se autocompleta igual.
function cotItemCodeBlur(idx){
  setTimeout(()=>{
    const drop=document.getElementById('cotDrop'+idx);
    if(drop) drop.classList.remove('on');
    const it=COT_ITEMS[idx];
    if(it && it.cod && !it.desc){
      const r=INV.find(x=>String(x[0]).toUpperCase()===String(it.cod).trim().toUpperCase());
      if(r) cotPickItem(idx, r[0]);
    }
  },150); // deja tiempo a que el onmousedown de una sugerencia registre antes de cerrar el dropdown
}

function cotCalcTotals(){
  const subtotal=COT_ITEMS.reduce((s,it)=>s+(Number(it.cant)||0)*(Number(it.precio)||0),0);
  const ivaOn=document.getElementById('cotIva')?.checked;
  const iva=ivaOn?subtotal*0.19:0;
  const total=subtotal+iva;
  const box=document.getElementById('cotTotalsBox');
  if(box) box.innerHTML=`
    <div class="cot-tot-row"><span>Subtotal</span><span>${cop(Math.round(subtotal))}</span></div>
    ${ivaOn?`<div class="cot-tot-row"><span>IVA (19%)</span><span>${cop(Math.round(iva))}</span></div>`:''}
    <div class="cot-tot-row cot-tot-final"><span>TOTAL</span><span>${cop(Math.round(total))}</span></div>`;
}

let _cotSetupDone=false;
let _cotDraftInitDone=false;
let _cotDraftTimer=null;
async function openCotModal(){
  cotLoadConfig();
  cotRefreshConfigFields();
  const details=document.getElementById('cotEmpresaDetails');
  if(details) details.open = !COT_CONFIG.nit;
  const ptSel=document.getElementById('cotPriceTypeSel');
  if(ptSel){
    const types=PRICE_TYPES.length?PRICE_TYPES:[{key:'mostrador',label:'Mostrador'},{key:'accesorios',label:'Accesorios'}];
    ptSel.innerHTML = `<option value="">Automático (según grupo del ítem)</option>` +
      types.map(t=>`<option value="${escHtml(t.key)}">${escHtml(t.label)}</option>`).join('');
  }

  if(!_cotSetupDone){
    _cotSetupDone=true;
    watchCotConfig();
    watchCotClientes();
    document.getElementById('cotOverlay').addEventListener('input', ()=>{
      clearTimeout(_cotDraftTimer);
      _cotDraftTimer=setTimeout(cotAutosaveDraft, 600);
    });
    document.getElementById('cotOverlay').addEventListener('change', ()=>{
      clearTimeout(_cotDraftTimer);
      _cotDraftTimer=setTimeout(cotAutosaveDraft, 600);
    });
  }

  if(!_cotDraftInitDone){
    _cotDraftInitDone=true;
    await cotLoadDraft();
  }else{
    cotRenderItems();
    cotCalcTotals();
  }
  document.getElementById('cotOverlay').classList.add('on');
}
function closeCotModal(){
  document.getElementById('cotOverlay').classList.remove('on');
}
async function cotClearForm(){
  if(!confirm('¿Vaciar el formulario? Se perderá el cliente, los ítems y las observaciones actuales.\n\n(Esto NO afecta a las cotizaciones/pedidos ya guardados en el Historial).')) return;
  await cotResetFormState();
  cotAutosaveDraft();
}
async function cotResetFormState(){
  document.getElementById('cotCliNombre').value='';
  document.getElementById('cotCliDoc').value='';
  document.getElementById('cotCliNit').value='';
  document.getElementById('cotCliTel').value='';
  document.getElementById('cotCliEmail').value='';
  document.getElementById('cotCliDir').value='';
  document.getElementById('cotModelo').value='';
  document.getElementById('cotPlaca').value='';
  document.getElementById('cotVin').value='';
  document.getElementById('cotKm').value='';
  document.getElementById('cotObs').value='';
  document.getElementById('cotIva').checked=true;
  document.getElementById('cotFecha').value=new Date().toISOString().slice(0,10);
  COT_ITEMS=[{cod:'',desc:'',cant:1,precio:0,stock:null,ubi:null,costo:null,transito:0}];
  _cotNumCache={COT:null,PED:null};
  cotRenderItems();
  await cotSetTipo('COT');
  cotCalcTotals();
}
function cotApplySnapshot(s){
  cotSetTipoSilent(s.tipo||'COT');
  document.getElementById('cotNum').value=s.num||'';
  _cotNumCache[s.tipo||'COT']=s.num||null;
  document.getElementById('cotFecha').value=s.fecha||new Date().toISOString().slice(0,10);
  document.getElementById('cotCliNombre').value=s.cli?.nombre||'';
  document.getElementById('cotCliDoc').value=s.cli?.doc||'';
  document.getElementById('cotCliNit').value=s.cli?.nit||'';
  document.getElementById('cotCliTel').value=s.cli?.tel||'';
  document.getElementById('cotCliEmail').value=s.cli?.email||'';
  document.getElementById('cotCliDir').value=s.cli?.dir||'';
  document.getElementById('cotModelo').value=s.cli?.modelo||'';
  document.getElementById('cotPlaca').value=s.cli?.placa||'';
  document.getElementById('cotVin').value=s.cli?.vin||'';
  document.getElementById('cotKm').value=s.cli?.km||'';
  document.getElementById('cotObs').value=s.obs||'';
  document.getElementById('cotIva').checked=!!s.iva;
  cotRenderVendedores();
  document.getElementById('cotVendedorSel').value=s.vendedor||'';
  COT_ITEMS=(s.items&&s.items.length)?JSON.parse(JSON.stringify(s.items)):[{cod:'',desc:'',cant:1,precio:0,stock:null,ubi:null,costo:null,transito:0}];
  cotRenderItems();
  cotCalcTotals();
}
function cotSnapshotForm(){
  return {
    tipo: COT_TIPO,
    num: document.getElementById('cotNum').value,
    fecha: document.getElementById('cotFecha').value,
    vendedor: document.getElementById('cotVendedorSel').value,
    cli: {
      nombre: document.getElementById('cotCliNombre').value,
      doc: document.getElementById('cotCliDoc').value,
      nit: document.getElementById('cotCliNit').value,
      tel: document.getElementById('cotCliTel').value,
      email: document.getElementById('cotCliEmail').value,
      dir: document.getElementById('cotCliDir').value,
      modelo: document.getElementById('cotModelo').value,
      placa: document.getElementById('cotPlaca').value,
      vin: document.getElementById('cotVin').value,
      km: document.getElementById('cotKm').value
    },
    obs: document.getElementById('cotObs').value,
    iva: !!document.getElementById('cotIva')?.checked,
    items: JSON.parse(JSON.stringify(COT_ITEMS))
  };
}
function cotAutosaveDraft(){
  if(!document.getElementById('cotOverlay')?.classList.contains('on')) return;
  const snap=cotSnapshotForm();
  try{ localStorage.setItem('ctrl_cot_draft', JSON.stringify(snap)); }catch(e){}
  cloudSave('cot_draft', snap);
}
async function cotLoadDraft(){
  let draft=null;
  try{ draft=await cloudLoad('cot_draft'); }catch(e){}
  if(!draft){
    try{ const raw=localStorage.getItem('ctrl_cot_draft'); if(raw) draft=JSON.parse(raw); }catch(e){}
  }
  if(draft && ((draft.items&&draft.items.some(it=>it.cod||it.desc)) || draft.cli?.nombre)){
    cotApplySnapshot(draft);
  }else{
    await cotResetFormState();
  }
}

const COT_HISTORY_KEY='ctrl_cot_history';
const COT_HISTORY_MAX=300;
let _cotHistCache=[];
let _cotHistCloudOk=false;

function cotSaveHistory(){
  const snap=cotSnapshotForm();
  const subtotal=COT_ITEMS.reduce((s,it)=>s+(Number(it.cant)||0)*(Number(it.precio)||0),0);
  const entry={
    id:'h'+Date.now()+Math.random().toString(36).slice(2,7),
    tipo:snap.tipo, num:snap.num, fecha:snap.fecha,
    cliente:snap.cli.nombre||'(sin nombre)',
    vendedor:snap.vendedor||'',
    total:Math.round(subtotal*(snap.iva?1.19:1)),
    itemsCount:COT_ITEMS.filter(it=>it.cod||it.desc).length,
    creadoPor:CURRENT_USER?.nombre||CURRENT_USER?.email||'',
    snapshot:snap
  };
  let hist=[];
  try{ hist=JSON.parse(localStorage.getItem(COT_HISTORY_KEY)||'[]')||[]; }catch(e){}
  hist.unshift(entry);
  if(hist.length>COT_HISTORY_MAX) hist=hist.slice(0,COT_HISTORY_MAX);
  try{ localStorage.setItem(COT_HISTORY_KEY, JSON.stringify(hist)); }catch(e){}
  if(CURRENT_USER){
    db.doc('equipo/cot_hist_'+entry.id).set({...entry, kind:'cot_historial', ts:Date.now()})
      .catch(e=>console.warn('[Cotizador] Historial en la nube falló — quedó guardado localmente igual:', e));
  }
  return entry;
}
function cotReadHistoryLocal(){
  try{ return JSON.parse(localStorage.getItem(COT_HISTORY_KEY)||'[]')||[]; }catch(e){ return []; }
}
async function cotReadHistoryCloud(limitN=150){
  if(!CURRENT_USER) return null;
  try{
    const snap=await Promise.race([
      db.collection('equipo').where('kind','==','cot_historial').orderBy('ts','desc').limit(limitN).get(),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout-cotHist')),6000))
    ]);
    return snap.docs.map(d=>d.data());
  }catch(e){
    console.warn('[Cotizador] Historial general sin consultar (puede faltar el índice compuesto kind+ts en Firestore):', e);
    return null;
  }
}
let _cotHistSelected=new Set();
async function openCotHistory(){
  _cotHistSelected=new Set();
  const list=document.getElementById('cotHistoryList');
  list.innerHTML='<div style="text-align:center;padding:28px;color:var(--text3);font-family:var(--mono);font-size:11px">Cargando historial del equipo…</div>';
  document.getElementById('cotHistoryOverlay').classList.add('on');
  const cloud=await cotReadHistoryCloud();
  if(cloud){
    _cotHistCache=cloud;
    _cotHistCloudOk=true;
  }else{
    _cotHistCache=cotReadHistoryLocal();
    _cotHistCloudOk=false;
  }
  renderCotHistoryList();
}
function renderCotHistoryList(){
  const hist=_cotHistCache;
  const list=document.getElementById('cotHistoryList');
  const bar=document.getElementById('cotHistoryBar');
  const warnHtml=_cotHistCloudOk?'':'<div style="padding:8px 10px;margin-bottom:8px;background:rgba(232,156,32,.1);border:1px solid rgba(232,156,32,.3);border-radius:6px;color:var(--amber);font-family:var(--mono);font-size:9.5px">⚠️ Sin conexión con el historial del equipo — mostrando solo lo guardado en este dispositivo.</div>';
  if(!hist.length){
    if(bar) bar.style.display='none';
    list.innerHTML=warnHtml+'<div style="text-align:center;padding:34px 16px;color:var(--text3);font-family:var(--mono);font-size:11px">Todavía no se ha generado ninguna cotización/pedido.</div>';
    return;
  }
  if(bar) bar.style.display='flex';
  const allChecked=hist.length>0 && hist.every(h=>_cotHistSelected.has(h.id));
  const selAll=document.getElementById('cotHistSelAll');
  if(selAll) selAll.checked=allChecked;
  const delBtn=document.getElementById('cotHistDelBtn');
  if(delBtn){ delBtn.disabled=_cotHistSelected.size===0; delBtn.textContent=`🗑 Eliminar seleccionados (${_cotHistSelected.size})`; }
  list.innerHTML=warnHtml+hist.map(h=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <input type="checkbox" ${_cotHistSelected.has(h.id)?'checked':''} onchange="cotHistToggleOne('${jsAttrSafe(h.id)}',this.checked)" style="flex:0 0 auto;cursor:pointer">
        <div style="flex:1;min-width:160px">
          <div style="font-family:var(--mono);font-size:11px;font-weight:700;color:${h.tipo==='PED'?'var(--cyan)':'var(--amber)'}">${h.tipo==='PED'?'PEDIDO':'COTIZACIÓN'} ${escHtml(h.num)}</div>
          <div style="font-size:10.5px;color:var(--text2);margin-top:2px">${escHtml(h.cliente)} · ${escHtml(h.fecha)} · ${h.itemsCount} ítem${h.itemsCount===1?'':'s'} · ${cop(h.total)}${h.creadoPor?' · '+escHtml(h.creadoPor):''}</div>
        </div>
        <button type="button" class="rpt-btn" style="padding:4px 10px;font-size:10px" onclick="cotLoadFromHistory('${jsAttrSafe(h.id)}',false)">👁 Reimprimir</button>
        <button type="button" class="rpt-btn" style="padding:4px 10px;font-size:10px;background:rgba(31,199,106,.12);border-color:rgba(31,199,106,.35);color:var(--green)" onclick="cotLoadFromHistory('${jsAttrSafe(h.id)}',true)">📋 Duplicar</button>
        <button type="button" class="rpt-btn close" style="padding:4px 8px;font-size:10px" onclick="cotHistDeleteOne('${jsAttrSafe(h.id)}')" title="Eliminar este documento">✕</button>
      </div>`).join('');
}
function cotHistToggleAll(checked){
  _cotHistSelected = checked ? new Set(_cotHistCache.map(h=>h.id)) : new Set();
  renderCotHistoryList();
}
function cotHistToggleOne(id, checked){
  if(checked) _cotHistSelected.add(id); else _cotHistSelected.delete(id);
  renderCotHistoryList();
}
function cotHistDeleteOne(id){
  if(!confirm('¿Eliminar este documento del historial? Esto no se puede deshacer.')) return;
  _cotHistCache=_cotHistCache.filter(h=>h.id!==id);
  renderCotHistoryList();
  try{ localStorage.setItem(COT_HISTORY_KEY, JSON.stringify(cotReadHistoryLocal().filter(h=>h.id!==id))); }catch(e){}
  db.doc('equipo/cot_hist_'+id).delete().catch(e=>console.warn('[Cotizador] Borrado en la nube falló:', e));
  _cotHistSelected.delete(id);
}
function cotHistDeleteSelected(){
  if(!_cotHistSelected.size) return;
  if(!confirm(`¿Eliminar ${_cotHistSelected.size} documento${_cotHistSelected.size===1?'':'s'} del historial? Esto no se puede deshacer.`)) return;
  const ids=[..._cotHistSelected];
  _cotHistCache=_cotHistCache.filter(h=>!_cotHistSelected.has(h.id));
  _cotHistSelected=new Set();
  renderCotHistoryList();
  try{ localStorage.setItem(COT_HISTORY_KEY, JSON.stringify(cotReadHistoryLocal().filter(h=>!ids.includes(h.id)))); }catch(e){}
  ids.forEach(id=>db.doc('equipo/cot_hist_'+id).delete().catch(e=>console.warn('[Cotizador] Borrado en la nube falló:', id, e)));
}
function closeCotHistory(){ document.getElementById('cotHistoryOverlay').classList.remove('on'); }
async function cotLoadFromHistory(id, asDuplicate){
  const entry=_cotHistCache.find(h=>h.id===id);
  if(!entry) return;
  const s={...entry.snapshot};
  if(asDuplicate){
    s.num=await cotNextNumberCloud(s.tipo||'COT');
    s.fecha=new Date().toISOString().slice(0,10);
  }
  cotApplySnapshot(s);
  closeCotHistory();
  cotAutosaveDraft();
}

const COT_PRINT_CSS = `
  @page{size:letter;margin:14mm}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px}
  .cot-doc{max-width:100%}
  .cot-doc-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:10px}
  .cot-doc-razon{font-size:15px;font-weight:700;margin-top:4px}
  .cot-doc-datos{font-size:10.5px;color:#333;line-height:1.5}
  .cot-doc-tipo{text-align:right}
  .cot-doc-tipo-label{font-size:16px;font-weight:800;letter-spacing:1px}
  .cot-doc-num,.cot-doc-fecha{font-size:11px;color:#333}
  .cot-doc-cliente{margin-bottom:12px}
  .cot-doc-cliente-title{font-weight:700;font-size:11px;text-transform:uppercase;color:#555;margin-bottom:4px}
  .cot-doc-cliente-table{width:100%;border-collapse:collapse;font-size:11px}
  .cot-doc-cliente-table td{padding:2px 4px}
  .cot-doc-items{width:100%;border-collapse:collapse;margin-bottom:10px}
  .cot-doc-items th{background:#eee;border:1px solid #999;padding:5px 6px;font-size:10.5px;text-align:left}
  .cot-doc-items td{border:1px solid #ccc;padding:5px 6px;font-size:11px}
  .cot-doc-totals{margin-left:auto;width:260px}
  .cot-doc-tot-row{display:flex;justify-content:space-between;padding:3px 6px;font-size:11.5px}
  .cot-doc-tot-final{font-weight:800;font-size:13px;border-top:2px solid #111;margin-top:2px}
  .cot-doc-obs{margin-top:14px;font-size:10.5px;border-top:1px solid #ccc;padding-top:8px}
  .cot-doc-footer{margin-top:20px;font-size:9px;color:#777;text-align:center}
`;

// Arma el HTML del documento imprimible (cotización o pedido) a partir del
// formulario actual. Nunca incluye stock/costo/margen — eso es solo para
// el vendedor dentro del modal (ver cotItemHint).
function cotBuildDocHtml(){
  const snap = cotSnapshotForm();
  const items = COT_ITEMS.filter(it=>it.cod||it.desc);
  const subtotal = items.reduce((s,it)=>s+(Number(it.cant)||0)*(Number(it.precio)||0),0);
  const ivaOn = snap.iva;
  const iva = ivaOn ? subtotal*0.19 : 0;
  const total = subtotal+iva;
  const tipoLabel = snap.tipo==='PED' ? 'PEDIDO' : 'COTIZACIÓN';
  const fechaFmt = snap.fecha ? new Date(snap.fecha+'T00:00:00').toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';

  const rowsHtml = items.map(it=>{
    const sub=(Number(it.cant)||0)*(Number(it.precio)||0);
    return `<tr>
      <td>${escHtml(it.cod)}</td>
      <td>${escHtml(it.desc)}</td>
      <td style="text-align:center">${fmt(it.cant)}</td>
      <td style="text-align:right">${cop(Math.round(it.precio))}</td>
      <td style="text-align:right">${cop(Math.round(sub))}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;color:#999">Sin ítems</td></tr>`;

  const logoHtml = COT_CONFIG.logoBase64 ? `<img src="${COT_CONFIG.logoBase64}" style="max-height:60px;max-width:220px;display:block;margin-bottom:6px">` : '';

  const vehiculoRow = (snap.cli.modelo||snap.cli.placa||snap.cli.vin||snap.cli.km)
    ? `<tr><td><b>Vehículo:</b> ${escHtml(snap.cli.modelo||'')}${snap.cli.placa?' · Placa '+escHtml(snap.cli.placa):''}</td><td>${snap.cli.vin?'<b>VIN:</b> '+escHtml(snap.cli.vin):''}${snap.cli.km?' · KM '+escHtml(snap.cli.km):''}</td></tr>`
    : '';

  return `
  <div class="cot-doc">
    <div class="cot-doc-header">
      <div class="cot-doc-empresa">
        ${logoHtml}
        <div class="cot-doc-razon">${escHtml(COT_CONFIG.razonSocial||'')}</div>
        <div class="cot-doc-datos">
          ${COT_CONFIG.nit?`NIT: ${escHtml(COT_CONFIG.nit)}<br>`:''}
          ${COT_CONFIG.direccion?`${escHtml(COT_CONFIG.direccion)}<br>`:''}
          ${COT_CONFIG.telefono?`Tel: ${escHtml(COT_CONFIG.telefono)}`:''}
        </div>
      </div>
      <div class="cot-doc-tipo">
        <div class="cot-doc-tipo-label">${tipoLabel}</div>
        <div class="cot-doc-num">N° ${escHtml(snap.num||'')}</div>
        <div class="cot-doc-fecha">Fecha: ${fechaFmt}</div>
      </div>
    </div>

    <div class="cot-doc-cliente">
      <div class="cot-doc-cliente-title">Cliente</div>
      <table class="cot-doc-cliente-table">
        <tr><td><b>Nombre:</b> ${escHtml(snap.cli.nombre||'')}</td><td><b>Documento:</b> ${escHtml(snap.cli.doc||snap.cli.nit||'')}</td></tr>
        <tr><td><b>Teléfono:</b> ${escHtml(snap.cli.tel||'')}</td><td><b>Correo:</b> ${escHtml(snap.cli.email||'')}</td></tr>
        <tr><td colspan="2"><b>Dirección:</b> ${escHtml(snap.cli.dir||'')}</td></tr>
        ${vehiculoRow}
        ${snap.vendedor?`<tr><td colspan="2"><b>Vendedor:</b> ${escHtml(snap.vendedor)}</td></tr>`:''}
      </table>
    </div>

    <table class="cot-doc-items">
      <thead><tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div class="cot-doc-totals">
      <div class="cot-doc-tot-row"><span>Subtotal</span><span>${cop(Math.round(subtotal))}</span></div>
      ${ivaOn?`<div class="cot-doc-tot-row"><span>IVA (19%)</span><span>${cop(Math.round(iva))}</span></div>`:''}
      <div class="cot-doc-tot-row cot-doc-tot-final"><span>TOTAL</span><span>${cop(Math.round(total))}</span></div>
    </div>

    ${snap.obs?`<div class="cot-doc-obs"><b>Observaciones:</b><br>${escHtml(snap.obs).replace(/\n/g,'<br>')}</div>`:''}

    <div class="cot-doc-footer">Documento generado el ${new Date().toLocaleDateString('es-CO')} — válido según condiciones comerciales acordadas.</div>
  </div>`;
}

function cotPrint(){
  if(!COT_CONFIG.razonSocial || !COT_CONFIG.nit){
    if(!confirm('No has guardado la Razón social / NIT de la empresa (sección "Datos de la empresa" arriba). ¿Imprimir de todas formas?')) return;
  }
  cotSaveHistory();
  cotSaveClienteToDirectory({
    nombre: document.getElementById('cotCliNombre').value.trim(),
    doc: document.getElementById('cotCliDoc').value.trim(),
    nit: document.getElementById('cotCliNit').value.trim(),
    tel: document.getElementById('cotCliTel').value.trim(),
    email: document.getElementById('cotCliEmail').value.trim(),
    dir: document.getElementById('cotCliDir').value.trim()
  });
  const html=cotBuildDocHtml();
  const area=document.getElementById('rptPrintArea');
  if(area.parentElement!==document.body) document.body.appendChild(area);
  area.innerHTML=`<style>@media print{${COT_PRINT_CSS}.rpt-print-hide{display:none!important}}</style>`+html;
  area.style.display='block';
  setTimeout(()=>{window.print();setTimeout(()=>{area.innerHTML='';area.style.display='none';},500);},120);
}

function _rptBuildColDefs(){
  const g2=id=>document.getElementById(id);
  const defs=[];
  if(g2('rc-cod')?.checked)   defs.push({k:'cod',  h:'Código',          wch:16});
  if(g2('rc-desc')?.checked)  defs.push({k:'desc', h:'Descripción',      wch:42});
  if(g2('rc-stk')?.checked)   defs.push({k:'stk',  h:'Stock',            wch:9,  num:true});
  if(g2('rc-ubi')?.checked)   defs.push({k:'ubi',  h:'Ubicación',        wch:14});
  if(g2('rc-prc')?.checked)   defs.push({k:'prc',  h:'P.Mostr.+IVA',    wch:15, mny:true});
  if(g2('rc-pacc')?.checked)  defs.push({k:'pacc', h:'P.Acc.+IVA',      wch:14, mny:true});
  if(g2('rc-psin')?.checked)  defs.push({k:'psin', h:'P.sin IVA',       wch:13, mny:true});
  if(g2('rc-costo')?.checked) defs.push({k:'costo',h:'Costo',           wch:13, mny:true});
  if(g2('rc-abc')?.checked)   defs.push({k:'abc',  h:'ABC',             wch:6});
  if(g2('rc-grp')?.checked)   defs.push({k:'grp',  h:'Grupo',           wch:18});
  if(g2('rc-dias')?.checked)  defs.push({k:'dias', h:'Días inventario', wch:10, num:true});
  // Check columns always last
  if(g2('rc-check')?.checked)  defs.push({k:'chk', h:'Conteo 1', wch:10});
  if(g2('rc-check2')?.checked) defs.push({k:'chk2',h:'Conteo 2', wch:10});
  return rptApplyColOrder(defs);
}

function _rptRowValues(d, defs){
  return defs.map(c=>{
    if(c.k==='cod') return d.cod;
    if(c.k==='desc') return d.desc||'';
    if(c.k==='stk') return d.stk??'';
    if(c.k==='ubi') return d.ubi;
    if(c.k==='prc') return d.prc!=null?+(d.prc.toFixed(2)):'';
    if(c.k==='pacc') return d.prcAcc!=null?+(d.prcAcc.toFixed(2)):'';
    if(c.k==='psin') return d.prcSin!=null?+(d.prcSin.toFixed(2)):'';
    if(c.k==='costo') return d.costo!=null?+(d.costo.toFixed(2)):'';
    if(c.k==='abc') return d.abc||'';
    if(c.k==='grp') return d.grp||'';
    if(c.k==='dias') return d.dias!=null?Math.round(d.dias):'';
    return '';
  });
}

function rptExportExcel(){
  if(!window.XLSX){alert('La librería XLSX no está disponible.');return;}
  const data=rptGetData();
  const defs=_rptBuildColDefs();
  const g2=id=>document.getElementById(id);
  const useKpis=g2('rc-kpis')?.checked;
  const title=(g2('rptTitle')?.value||'Reporte');
  const now=new Date().toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'});

  let aoa=[];
  let dataStartRow=0;

  if(useKpis&&data.length){
    const totalRefs=data.length;
    const valorTotal=data.reduce((s,d)=>s+(d.prc!=null?d.prc*(d.stk??0):0),0);
    const conStock=data.filter(d=>(d.stk??0)>0).length;
    const sinUbi=data.filter(d=>!d.ubi||d.ubi==='Sin Ubicacion').length;
    aoa.push([title,'']);
    aoa.push(['Generado',now]);
    aoa.push(['']);
    aoa.push(['▸ RESUMEN','']);
    aoa.push(['Total referencias',totalRefs]);
    aoa.push(['Con stock',conStock]);
    aoa.push(['Sin stock',totalRefs-conStock]);
    aoa.push(['Sin ubicación',sinUbi]);
    aoa.push(['Valor inventario (c/IVA)',+(valorTotal.toFixed(2))]);
    aoa.push(['']);
    dataStartRow=aoa.length;
  }

  // Header row
  aoa.push(defs.map(c=>c.h));
  // Data rows — check columns get empty string for manual fill
  data.forEach(d=>{
    aoa.push(defs.map(c=>{
      if(c.k==='cod')  return d.cod;
      if(c.k==='desc') return d.desc||'';
      if(c.k==='stk')  return d.stk??'';
      if(c.k==='ubi')  return d.ubi;
      if(c.k==='prc')  return d.prc!=null?+(d.prc.toFixed(2)):'';
      if(c.k==='pacc') return d.prcAcc!=null?+(d.prcAcc.toFixed(2)):'';
      if(c.k==='psin') return d.prcSin!=null?+(d.prcSin.toFixed(2)):'';
      if(c.k==='costo')return d.costo!=null&&d.costo>0?+(d.costo.toFixed(2)):'';
      if(c.k==='abc')  return d.abc||'';
      if(c.k==='grp')  return d.grp||'';
      if(c.k==='dias') return d.dias!=null?Math.round(d.dias):'';
      if(c.k==='chk'||c.k==='chk2') return '';
      return '';
    }));
  });

  const ws=XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  ws['!cols']=defs.map(c=>({wch:c.wch||12}));

  // Number formats for data cells
  const hdrR=dataStartRow; // 0-based row index of header
  data.forEach((_,ri)=>{
    const wsRow=hdrR+1+ri;
    defs.forEach((c,ci)=>{
      const addr=XLSX.utils.encode_cell({r:wsRow,c:ci});
      const cell=ws[addr];
      if(!cell||cell.v==='') return;
      if(c.num) cell.z='#,##0';
      if(c.mny) cell.z='$#,##0.00';
    });
  });

  const wb=XLSX.utils.book_new();
  const sheetName=title.substring(0,31).replace(/[\/\*\[\]\?:]/g,'');
  XLSX.utils.book_append_sheet(wb,ws,sheetName||'Reporte');

  const fname=`reporte_${(g2('rptFilename')?.value||'inventario').replace(/[^a-zA-Z0-9_\-]/g,'_')}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`;
  XLSX.writeFile(wb,fname);
}
function rptExportCsv(){
  const data=rptGetData();
  const defs=_rptBuildColDefs();
  const g2=id=>document.getElementById(id);
  const escCsv=v=>{
    const s=String(v==null?'':v);
    if(s.includes(',')||s.includes('"')||s.includes('\n'))return'"'+s.replace(/"/g,'""')+'"';
    return s;
  };
  const lines=[defs.map(c=>escCsv(c.h)).join(','),...data.map(d=>_rptRowValues(d,defs).map(escCsv).join(','))];
  const csv='\uFEFF'+lines.join('\r\n'); // BOM for Excel compatibility
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`reporte_${(g2('rptFilename')?.value||'inventario').replace(/[^a-zA-Z0-9_\-]/g,'_')}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export { closeCotHistory, closeCotModal, cotAddItemRow, cotAddVendedor, cotCalcTotals, cotClearForm, cotClienteDropClose, cotClienteSearch, cotHistDeleteOne, cotHistDeleteSelected, cotHistToggleAll, cotHistToggleOne, cotImportFromPicklist, cotInvContext, cotItemCodeBlur, cotItemCodeInput, cotItemField, cotLoadFromHistory, cotLogoUpload, cotPickCliente, cotPickItem, cotPrint, cotRemoveItemRow, cotRemoveVendedor, cotSaveConfig, cotSetPriceType, cotSetTipo, openCotHistory, openCotModal, rptExportCsv, rptExportExcel };
