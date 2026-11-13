import { ESTANTES, INV, PICKLIST, UBI_TEO, busRes } from './state-globals.js';
import { getPriceRow } from './file-upload.js';
import { getEffectivePrice } from './precios-divisor.js';
import { cop, escHtml, fmt, jsAttrSafe } from './utils.js';
import { rptExportCsv, rptExportExcel } from './cotizador.js';
// ═══ js/reporte-imprimible.js — extraído de index.html (líneas 15914–16754 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
/* ═══════════════ REPORTE IMPRIMIBLE — MOTOR v2 ═══════════════ */

/* ── Estado del motor de reportes ── */
let _rptFmt='print'; // 'print' | 'xlsx' | 'csv'
// Personalización de columnas del reporte: ancho/nombre/alineación por
// columna (rptColOverride, clave = mismo 'k' que en rptDefaultCols) y
// tamaño de la casilla visual de Conteo (rptChkSize). Se guardan en
// localStorage para que la personalización se mantenga entre sesiones.
let rptColOverride={};
let rptColOrder=[]; // orden custom de columnas (array de 'k'), fijado por
                     // drag&drop en el panel "Personalizar columnas".
                     // Vacío = orden natural (el de los checkboxes arriba).
let rptChkSize={w:42,h:15};
let _rptLastColSig=''; // firma de columnas activas, para no re-renderizar
                        // el panel de personalización en cada tecla y así
                        // no perder el foco mientras el usuario escribe.

/* ── Helpers de UI ── */
function rptSetSrc(val, el){
  // Update hidden radios
  const radio=document.getElementById('rptSrc-'+val);
  if(radio) radio.checked=true;
  // Update card styles
  document.querySelectorAll('.rpt-src-card').forEach(c=>c.classList.remove('sel'));
  if(el) el.classList.add('sel');
  // Show/hide sub-selects
  const estWrap=document.getElementById('rptEstanteWrap');
  const abcWrap=document.getElementById('rptAbcSrcWrap');
  if(estWrap) estWrap.style.display=val==='byEstante'?'block':'none';
  if(abcWrap) abcWrap.style.display=val==='abcFilter'?'flex':'none';
  rptPreview();
}

function rptSetOrient(val, el){
  const radio=document.getElementById('rptOrient-'+val);
  if(radio) radio.checked=true;
  document.querySelectorAll('[id^="rptOrientCard-"]').forEach(c=>c.classList.remove('sel'));
  if(el) el.classList.add('sel');
  rptPreview();
}

function rptSetDensity(val, el){
  const radio=document.getElementById('rptDensity-'+val);
  if(radio) radio.checked=true;
  document.querySelectorAll('[id^="rptDensityCard-"]').forEach(c=>c.classList.remove('sel'));
  if(el) el.classList.add('sel');
  rptPreview();
}

function rptSetGroup(val, el){
  const sel=document.getElementById('rptGroupBy');
  if(sel) sel.value=val;
  document.querySelectorAll('[id^="rptGrpCard-"]').forEach(c=>c.classList.remove('sel'));
  if(el) el.classList.add('sel');
  rptPreview();
}

function rptSetFmt(fmt, el){
  _rptFmt=fmt;
  document.querySelectorAll('.rpt-fmt-btn').forEach(b=>b.classList.remove('sel'));
  if(el) el.classList.add('sel');
  // Update action button label and ext
  const btn=document.getElementById('rptActionBtn');
  const ext=document.getElementById('rptFilenameExt');
  if(fmt==='print'){ if(btn){btn.style.background='rgba(74,142,240,.12)';btn.style.borderColor='rgba(74,142,240,.4)';btn.style.color='var(--blue)';btn.textContent='🖨 Imprimir / PDF';} if(ext)ext.textContent='_YYYYMMDD.pdf'; }
  else if(fmt==='xlsx'){ if(btn){btn.style.background='rgba(76,217,123,.1)';btn.style.borderColor='rgba(76,217,123,.4)';btn.style.color='#4cd97b';btn.textContent='📥 Exportar Excel';} if(ext)ext.textContent='_YYYYMMDD.xlsx'; }
  else if(fmt==='csv'){ if(btn){btn.style.background='rgba(155,109,255,.1)';btn.style.borderColor='rgba(155,109,255,.4)';btn.style.color='var(--purple)';btn.textContent='📋 Exportar CSV';} if(ext)ext.textContent='_YYYYMMDD.csv'; }
}

function rptExecute(){
  if(_rptFmt==='print') rptPrint();
  else if(_rptFmt==='xlsx') rptExportExcel();
  else if(_rptFmt==='csv') rptExportCsv();
}

/* ── Plantillas rápidas ── */
function rptApplyPreset(preset){
  // Clear all preset active states
  document.querySelectorAll('.rpt-preset').forEach(p=>p.classList.remove('active'));
  const pEl=document.getElementById('preset-'+preset);
  if(pEl) pEl.classList.add('active');

  const g2=id=>document.getElementById(id);
  // Reset all columns first
  ['cod','desc','stk','ubi','prc','pacc','psin','costo','abc','grp','dias','check','check2'].forEach(k=>{
    const el=g2('rc-'+k); if(el) el.checked=false;
  });
  g2('rptStkMin').value=''; g2('rptStkMax').value='';
  g2('rptPrcMin').value=''; g2('rptPrcMax').value='';
  g2('rptTopN').value='';
  g2('rptNota').value='';
  g2('rptSortBy').value='';
  g2('rptGrpFilter').value='';

  if(preset==='picking'){
    g2('rptTitle').value='Lista de Picking — Selection Tray';
    rptSetSrc('tray',document.getElementById('rsc-tray'));
    ['cod','desc','stk','ubi','prc','check'].forEach(k=>{ const el=g2('rc-'+k); if(el)el.checked=true; });
    g2('rptSortBy').value='ubi';
    rptSetGroup('ubi',document.getElementById('rptGrpCard-ubi'));
    rptSetDensity('compact',document.getElementById('rptDensityCard-compact'));
  } else if(preset==='valorizacion'){
    g2('rptTitle').value='Valorización de Inventario';
    rptSetSrc('inv',document.getElementById('rsc-inv'));
    ['cod','desc','stk','prc','pacc','costo','abc'].forEach(k=>{ const el=g2('rc-'+k); if(el)el.checked=true; });
    g2('rptSortBy').value='prc_desc';
    g2('rc-totales').checked=true;
    g2('rc-kpis').checked=true;
    rptSetGroup('abc',document.getElementById('rptGrpCard-abc'));
    rptSetOrient('landscape',document.getElementById('rptOrientCard-landscape'));
  } else if(preset==='criticos'){
    g2('rptTitle').value='Alertas Críticas — Sin Stock / Sin Ubicación';
    // Fuente combinada (stock=0 O sin ubicación): no tiene tarjeta propia en el grid,
    // se marcan ambos criterios visualmente y se usa el radio oculto 'criticos'.
    document.querySelectorAll('.rpt-src-card').forEach(c=>c.classList.remove('sel'));
    document.getElementById('rsc-nostock')?.classList.add('sel');
    document.getElementById('rsc-sinubi')?.classList.add('sel');
    const critRadio=document.getElementById('rptSrc-criticos');
    if(critRadio) critRadio.checked=true;
    ['cod','desc','stk','ubi','abc','dias'].forEach(k=>{ const el=g2('rc-'+k); if(el)el.checked=true; });
    g2('rptSortBy').value='abc';
    g2('rptNota').value='Referencias con stock = 0 y/o sin ubicación asignada en bodega.';
  } else if(preset==='conteo'){
    g2('rptTitle').value='Hoja de Conteo Físico';
    rptSetSrc('inv',document.getElementById('rsc-inv'));
    ['cod','desc','stk','ubi','check','check2'].forEach(k=>{ const el=g2('rc-'+k); if(el)el.checked=true; });
    g2('rptSortBy').value='ubi';
    rptSetGroup('ubi',document.getElementById('rptGrpCard-ubi'));
    rptSetDensity('compact',document.getElementById('rptDensityCard-compact'));
    g2('rptNota').value='CONTEO 1 y CONTEO 2: anotar conteo físico real en cada columna. Reportar diferencias al supervisor.';
  }
  rptPreview();
}

/* ── Helpers para construir KPI block ── */
function rptBuildKpiBlock(data){
  const totalRefs=data.length;
  const conStock=data.filter(d=>(d.stk??0)>0).length;
  const sinStock=totalRefs-conStock;
  const sinUbi=data.filter(d=>!d.ubi||d.ubi==='Sin Ubicacion'||d.ubi==='—'||d.ubi==='-').length;
  // Valor de venta: usa el precio efectivo (d.prc ya resuelve Mostrador vs Accesorio
  // según el grupo del ítem) — es independiente de qué columnas de precio estén
  // marcadas en el reporte, porque este bloque es un resumen ejecutivo, no una
  // vista de detalle.
  const valorTotal=data.reduce((s,d)=>s+(d.prc!=null?d.prc*(d.stk??0):0),0);
  // Valor de costo: métrica aparte (sin IVA, base de inversión) — antes no existía
  // en este bloque, así que un reporte enfocado en costos no reflejaba nada aquí.
  const costoTotal=data.reduce((s,d)=>s+(d.costo!=null&&d.costo>0?d.costo*(d.stk??0):0),0);
  const abcColors2={A:'#0e8a4a',B:'#b8790a',C:'#6a4fc0',D:'#c23838',E:'#7a2020'};
  const abcCount={A:0,B:0,C:0,D:0,E:0};
  data.forEach(d=>{ const k=(d.abc||'').toUpperCase(); if(abcColors2[k]) abcCount[k]++; });
  const pctStock=totalRefs>0?Math.round(conStock/totalRefs*100):0;
  const pctSinUbi=totalRefs>0?Math.round(sinUbi/totalRefs*100):0;

  const abcChips=Object.entries(abcCount).filter(([,v])=>v>0)
    .map(([k,v])=>`<div class="rpt-abc-chip" style="background:${abcColors2[k]}15;border:1px solid ${abcColors2[k]}50;color:${abcColors2[k]}"><span>${k}</span><span style="font-weight:400;opacity:.7;margin-left:4px">${v}</span></div>`).join('');

  const valorItem=valorTotal>0?`<div class="rpt-kpi-item"><div class="rpt-kpi-lbl">Valor c/IVA</div><div class="rpt-kpi-val" style="color:#0e8a4a;font-size:11px">${cop(valorTotal)}</div></div>`:'';
  const costoItem=costoTotal>0?`<div class="rpt-kpi-item"><div class="rpt-kpi-lbl">Valor costo</div><div class="rpt-kpi-val" style="color:#b0402f;font-size:11px">${cop(costoTotal)}</div></div>`:'';

  return`<div class="rpt-kpi-bar">
    <div class="rpt-kpi-item"><div class="rpt-kpi-lbl">Total refs</div><div class="rpt-kpi-val" style="color:#1a3060">${fmt(totalRefs)}</div></div>
    <div class="rpt-kpi-item"><div class="rpt-kpi-lbl">Con stock</div><div class="rpt-kpi-val" style="color:#0e8a4a">${fmt(conStock)}</div><div class="rpt-kpi-sub">${pctStock}% del total</div></div>
    <div class="rpt-kpi-item"><div class="rpt-kpi-lbl">Sin stock</div><div class="rpt-kpi-val" style="color:#c23838">${fmt(sinStock)}</div><div class="rpt-kpi-sub">${100-pctStock}% del total</div></div>
    <div class="rpt-kpi-item"><div class="rpt-kpi-lbl">Sin ubicación</div><div class="rpt-kpi-val" style="color:#b8790a">${fmt(sinUbi)}</div><div class="rpt-kpi-sub">${pctSinUbi}% del total</div></div>
    ${valorItem}
    ${costoItem}
  </div>
  ${abcChips?`<div class="rpt-abc-bar">${abcChips}</div>`:''}`;
}
/* ── openRptModal ── */
function openRptModal(){
  rptLoadCustomization();
  // Populate grupo filter
  const grpSel=document.getElementById('rptGrpFilter');
  if(grpSel&&INV.length){
    const grps=[...new Set(INV.map(r=>r[6]||'').filter(Boolean))].sort();
    grpSel.innerHTML='<option value="">— Todos los grupos —</option>'+grps.map(g=>`<option value="${escHtml(g)}">${escHtml(g)}</option>`).join('');
  }
  // Populate estante select — misma fuente que la pestaña Estantes (ESTANTES),
  // con el mismo fallback que usa el filtro de Ubicaciones si no hay datos de Estantes.
  const estSel=document.getElementById('rptEstanteSelect');
  if(estSel){
    let ests;
    if(ESTANTES.length){
      ests=ESTANTES.slice().sort((a,b)=>a[0].localeCompare(b[0])).map(e=>e[0]);
    } else if(UBI_TEO.length){
      ests=[...new Set(UBI_TEO.map(r=>{const m=r[0].match(/^[A-Za-z]+\d+/);return m?m[0]:(r[0].slice(0,2)||r[0][0]);}))].sort();
    } else {
      ests=[];
    }
    estSel.innerHTML='<option value="">— Seleccionar estante —</option>'+ests.map(e=>`<option value="${escHtml(e)}">Estante ${escHtml(e)}</option>`).join('');
  }
  // Update source card counts
  const g2=id=>document.getElementById(id);
  if(g2('rsc-tray-cnt')) g2('rsc-tray-cnt').textContent=PICKLIST.size>0?PICKLIST.size+' ítem'+(PICKLIST.size===1?'':'s'):'vacío';
  if(g2('rsc-busqueda-cnt')) g2('rsc-busqueda-cnt').textContent=(busRes||[]).length>0?(busRes.length)+' refs':'sin búsqueda';
  if(g2('rsc-inv-cnt')) g2('rsc-inv-cnt').textContent=INV.length>0?fmt(INV.length)+' refs':'sin datos';
  if(g2('rsc-nostock-cnt')) g2('rsc-nostock-cnt').textContent=INV.length>0?fmt(INV.filter(r=>(r[2]??0)===0).length)+' refs':'—';
  if(g2('rsc-negstock-cnt')) g2('rsc-negstock-cnt').textContent=INV.length>0?fmt(INV.filter(r=>Number(r[2]??0)<0).length)+' refs':'—';
  if(g2('rsc-sinubi-cnt')) g2('rsc-sinubi-cnt').textContent=INV.length>0?fmt(INV.filter(r=>{const u=String(r[3]||'').trim();return !u||u==='-'||u==='—'||u.toLowerCase()==='sin ubicacion';}).length)+' refs':'—';
  if(g2('rsc-sinprecio-cnt')) g2('rsc-sinprecio-cnt').textContent=INV.length>0?fmt(INV.filter(r=>!getPriceRow(r[0])).length)+' refs':'—';

  document.getElementById('rptOverlay').classList.add('on');
  rptSetupColResize(); // idempotente: solo ata los listeners de arrastre la primera vez
  rptPreview();
}

function closeRptModal(){document.getElementById('rptOverlay').classList.remove('on');}

// Kept for backward compatibility
function rptOnSrcChange(){
  const src=document.querySelector('input[name="rptSrc"]:checked')?.value||'tray';
  const estWrap=document.getElementById('rptEstanteWrap');
  const abcWrap=document.getElementById('rptAbcSrcWrap');
  if(estWrap) estWrap.style.display=src==='byEstante'?'block':'none';
  if(abcWrap) abcWrap.style.display=src==='abcFilter'?'flex':'none';
  rptPreview();
}

function rptGetData(){
  const src=document.querySelector('input[name="rptSrc"]:checked')?.value||'tray';
  const g2=id=>document.getElementById(id);

  const mapInvRow=r=>{
    const pr=getPriceRow(r[0]);
    const grp=r[6]||'';
    const epMost=pr?pr[0]:null;
    const epAcc=pr?pr[1]:null;
    const ep=getEffectivePrice(pr,grp);
    return{
      cod:r[0], desc:r[1]||'',
      stk:r[2]??null, stkFmt:r[2]!=null?fmt(r[2]):'—',
      ubi:r[3]||'—', abc:r[4]||'', grp,
      dias:r[5]!=null?Number(r[5]):null,
      prcMost:epMost!=null?epMost*1.19:null,
      prcAcc:epAcc!=null?epAcc*1.19:null,
      prcSin:ep,
      prc:ep!=null?ep*1.19:null,
      costo:pr&&pr[3]>0?pr[3]:null,
    };
  };

  let rows=[];
  if(src==='tray'){
    rows=[...PICKLIST.values()].map(it=>{
      const pr=getPriceRow(it.cod); const grp='';
      const epMost=pr?pr[0]:null; const epAcc=pr?pr[1]:null;
      const ep=it.price!=null?Number(it.price):null;
      return{
        cod:it.cod, desc:it.desc,
        stk:it.stock!=null?Number(it.stock):null, stkFmt:it.stock!=null?fmt(Number(it.stock||0)):'—',
        ubi:it.ubi||'—', abc:'', grp, dias:null,
        prcMost:epMost!=null?epMost*1.19:null,
        prcAcc:epAcc!=null?epAcc*1.19:null,
        prcSin:ep!=null?ep/1.19:null,
        prc:ep,
        costo:pr&&pr[3]>0?pr[3]:null,
      };
    });
  } else if(src==='busqueda'){ rows=(busRes||[]).map(mapInvRow);
  } else if(src==='nostock'){ rows=INV.filter(r=>(r[2]??0)===0).map(mapInvRow);
  } else if(src==='negstock'){ rows=INV.filter(r=>Number(r[2]??0)<0).map(mapInvRow);
  } else if(src==='sinubi'){ rows=INV.filter(r=>{const u=String(r[3]||'').trim();return !u||u==='-'||u==='—'||u.toLowerCase()==='sin ubicacion';}).map(mapInvRow);
  } else if(src==='sinprecio'){ rows=INV.filter(r=>!getPriceRow(r[0])).map(mapInvRow);
  } else if(src==='criticos'){ rows=INV.filter(r=>{const stk=Number(r[2]??0);const u=String(r[3]||'').trim();const sinUbi=!u||u==='-'||u==='—'||u.toLowerCase()==='sin ubicacion';return stk===0||sinUbi;}).map(mapInvRow);
  } else if(src==='byEstante'){
    const est=(g2('rptEstanteSelect')?.value||'').trim().toUpperCase();
    rows=(est?INV.filter(r=>String(r[3]||'').trim().toUpperCase().startsWith(est)):INV).map(mapInvRow);
  } else if(src==='abcFilter'){
    const picked=['A','B','C','D','E'].filter(l=>g2('rptAbcSrc'+l)?.checked);
    rows=INV.filter(r=>picked.includes((r[4]||'').toUpperCase())).map(mapInvRow);
  } else { rows=INV.map(mapInvRow); }

  // Filtros
  const stkMin=g2('rptStkMin')?.value!==''?Number(g2('rptStkMin').value):null;
  const stkMax=g2('rptStkMax')?.value!==''?Number(g2('rptStkMax').value):null;
  const prcMin=g2('rptPrcMin')?.value!==''?Number(g2('rptPrcMin').value):null;
  const prcMax=g2('rptPrcMax')?.value!==''?Number(g2('rptPrcMax').value):null;
  const grpFil=(g2('rptGrpFilter')?.value||'').trim();
  if(stkMin!==null) rows=rows.filter(r=>r.stk!=null&&r.stk>=stkMin);
  if(stkMax!==null) rows=rows.filter(r=>r.stk!=null&&r.stk<=stkMax);
  if(prcMin!==null) rows=rows.filter(r=>r.prc!=null&&r.prc>=prcMin);
  if(prcMax!==null) rows=rows.filter(r=>r.prc!=null&&r.prc<=prcMax);
  if(grpFil) rows=rows.filter(r=>r.grp===grpFil);

  // Orden
  const sortBy=g2('rptSortBy')?.value||'';
  if(sortBy) rows.sort((a,b)=>{
    if(sortBy==='cod') return String(a.cod).localeCompare(String(b.cod));
    if(sortBy==='desc') return String(a.desc).localeCompare(String(b.desc));
    if(sortBy==='stk_asc') return (a.stk??-Infinity)-(b.stk??-Infinity);
    if(sortBy==='stk_desc') return (b.stk??-Infinity)-(a.stk??-Infinity);
    if(sortBy==='prc_asc') return (a.prc??-Infinity)-(b.prc??-Infinity);
    if(sortBy==='prc_desc') return (b.prc??-Infinity)-(a.prc??-Infinity);
    if(sortBy==='ubi') return String(a.ubi).localeCompare(String(b.ubi));
    if(sortBy==='abc') return String(a.abc).localeCompare(String(b.abc));
    if(sortBy==='dias_asc') return (a.dias??Infinity)-(b.dias??Infinity);
    if(sortBy==='dias_desc') return (b.dias??Infinity)-(a.dias??Infinity);
    return 0;
  });

  // Top N
  const topN=g2('rptTopN')?.value!==''?parseInt(g2('rptTopN').value):null;
  if(topN&&topN>0) rows=rows.slice(0,topN);
  return rows;
}

// Definición BASE de columnas (antes de aplicar personalización): qué
// columnas están activas según los checkboxes de arriba, con su nombre,
// ancho y alineación por defecto. La usan rptBuildHtml() (para armar la
// tabla real) y rptRenderColCustomizer() (para saber qué mostrar en el
// panel de personalización) — así ambos quedan siempre sincronizados.
function rptDefaultCols(){
  const g2=id=>document.getElementById(id);
  const cols=[];
  if(g2('rc-cod')?.checked)    cols.push({k:'cod',  label:'Código',       w:'110px'});
  if(g2('rc-desc')?.checked)   cols.push({k:'desc', label:'Descripción',   w:''});
  if(g2('rc-stk')?.checked)    cols.push({k:'stk',  label:'Stock',         w:'56px', al:'center'});
  if(g2('rc-ubi')?.checked)    cols.push({k:'ubi',  label:'Ubicación',     w:'90px'});
  if(g2('rc-prc')?.checked)    cols.push({k:'prc',  label:'P.Mostrador',   w:'100px',al:'right'});
  if(g2('rc-pacc')?.checked)   cols.push({k:'pacc', label:'P.Accesorio',   w:'96px', al:'right'});
  if(g2('rc-psin')?.checked)   cols.push({k:'psin', label:'P.sin IVA',     w:'88px', al:'right'});
  if(g2('rc-costo')?.checked)  cols.push({k:'costo',label:'Costo',         w:'88px', al:'right'});
  if(g2('rc-abc')?.checked)    cols.push({k:'abc',  label:'ABC',           w:'40px', al:'center'});
  if(g2('rc-grp')?.checked)    cols.push({k:'grp',  label:'Grupo',         w:'88px'});
  if(g2('rc-dias')?.checked)   cols.push({k:'dias', label:'Días inv.',     w:'52px', al:'center'});
  if(g2('rc-check')?.checked)  cols.push({k:'chk',  label:'Conteo 1',      w:'70px', al:'center'});
  if(g2('rc-check2')?.checked) cols.push({k:'chk2', label:'Conteo 2',      w:'70px', al:'center'});
  return rptApplyColOrder(cols);
}

// Reordena un array de columnas según rptColOrder (fijado con el drag&drop
// del panel "Personalizar columnas"). Las columnas activas que no estén
// todavía en rptColOrder (recién marcadas, o antes de reordenar nunca)
// se agregan al final, respetando su orden natural entre ellas.
function rptApplyColOrder(cols){
  if(!rptColOrder.length) return cols;
  const byKey={};
  cols.forEach(c=>{byKey[c.k]=c;});
  const ordered=[];
  rptColOrder.forEach(k=>{
    if(byKey[k]){ ordered.push(byKey[k]); delete byKey[k]; }
  });
  cols.forEach(c=>{ if(byKey[c.k]) ordered.push(c); });
  return ordered;
}

/* ── Panel "Personalizar columnas" ──
   Se re-renderiza solo cuando cambia el CONJUNTO de columnas activas
   (se activó/desactivó un checkbox arriba) — no en cada tecla — para no
   robarle el foco a un input mientras el usuario está escribiendo un
   ancho o un nombre nuevo. */
function rptRenderColCustomizer(){
  const wrap=document.getElementById('rptColCustomizer');
  if(!wrap) return;
  rptSetupColDrag(wrap); // idempotente: solo ata los listeners la primera vez
  const cols=rptDefaultCols();
  const sig=cols.map(c=>c.k).join(',');
  if(sig===_rptLastColSig) return;
  _rptLastColSig=sig;
  if(!cols.length){
    wrap.innerHTML='<div class="rpt-colcust-hint">Activa al menos una columna arriba para poder personalizarla.</div>';
    return;
  }
  wrap.innerHTML=cols.map(c=>{
    const o=rptColOverride[c.k]||{};
    const wVal=(o.w!=null)?o.w:(parseInt(c.w)||'');
    const alVal=o.al||c.al||'left';
    const nameVal=(o.label!=null)?o.label:c.label;
    return `<div class="rpt-colcust-row" data-colkey="${c.k}">
      <span class="rpt-colcust-handle" title="Arrastra para reordenar">⠿</span>
      <input class="rpt-input" value="${escHtml(nameVal)}" placeholder="${escHtml(c.label)}"
        oninput="rptColOverrideSet('${jsAttrSafe(c.k)}','label',this.value)" title="Nombre de la columna ${escHtml(c.label)}">
      <input class="rpt-input" type="number" min="20" value="${wVal}" placeholder="auto"
        oninput="rptColOverrideSet('${jsAttrSafe(c.k)}','w',this.value)" title="Ancho en px">
      <select class="fsel" onchange="rptColOverrideSet('${jsAttrSafe(c.k)}','al',this.value)" title="Alineación">
        <option value="left"${alVal==='left'?' selected':''}>◀ Izq</option>
        <option value="center"${alVal==='center'?' selected':''}>◆ Centro</option>
        <option value="right"${alVal==='right'?' selected':''}>▶ Der</option>
      </select>
    </div>`;
  }).join('');
}
/* ── Drag & drop para reordenar columnas ──
   Se ata UNA sola vez sobre el contenedor #rptColCustomizer (delegación),
   así sigue funcionando aunque su innerHTML se reconstruya cada vez que
   cambia el conjunto de columnas activas. Usa Pointer Events para que
   funcione igual con mouse (desktop) y con el dedo (móvil/tablet). */
function rptSetupColDrag(wrap){
  if(wrap._dragBound) return;
  wrap._dragBound=true;
  let dragEl=null;
  wrap.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('.rpt-colcust-handle');
    if(!handle) return;
    const row=handle.closest('.rpt-colcust-row');
    if(!row) return;
    e.preventDefault();
    dragEl=row;
    row.classList.add('dragging');
    try{ handle.setPointerCapture(e.pointerId); }catch(err){}
  });
  wrap.addEventListener('pointermove',e=>{
    if(!dragEl) return;
    const rows=[...wrap.querySelectorAll('.rpt-colcust-row')].filter(r=>r!==dragEl);
    for(const r of rows){
      const rect=r.getBoundingClientRect();
      if(e.clientY>rect.top && e.clientY<rect.bottom){
        const before=e.clientY<rect.top+rect.height/2;
        wrap.insertBefore(dragEl, before?r:r.nextSibling);
        break;
      }
    }
  });
  const endDrag=()=>{
    if(!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl=null;
    rptColOrder=[...wrap.querySelectorAll('.rpt-colcust-row')].map(r=>r.dataset.colkey);
    rptSaveCustomization();
    _rptLastColSig=''; // el orden cambió: refleja el nuevo orden también en la vista previa
    rptPreview();
  };
  wrap.addEventListener('pointerup',endDrag);
  wrap.addEventListener('pointercancel',endDrag);
}
function rptColOverrideSet(key,field,val){
  if(!rptColOverride[key]) rptColOverride[key]={};
  if(field==='w') rptColOverride[key].w = val===''?null:Math.max(20,parseInt(val)||0);
  else rptColOverride[key][field]=val;
  rptSaveCustomization();
  rptPreviewDebounced(120);
}
function rptChkSizeChange(){
  const w=parseInt(document.getElementById('rptChkW').value)||42;
  const h=parseInt(document.getElementById('rptChkH').value)||15;
  rptChkSize={w,h};
  rptSaveCustomization();
  rptPreviewDebounced(120);
}
function rptResetCustomization(){
  rptColOverride={};
  rptColOrder=[];
  rptChkSize={w:42,h:15};
  try{ localStorage.removeItem('rptColOverride'); localStorage.removeItem('rptColOrder'); localStorage.removeItem('rptChkSize'); }catch(e){}
  const wEl=document.getElementById('rptChkW'); if(wEl) wEl.value='';
  const hEl=document.getElementById('rptChkH'); if(hEl) hEl.value='';
  _rptLastColSig=''; // fuerza re-render del panel con valores por defecto
  rptRenderColCustomizer();
  rptPreview();
}
function rptSaveCustomization(){
  try{
    localStorage.setItem('rptColOverride', JSON.stringify(rptColOverride));
    localStorage.setItem('rptColOrder', JSON.stringify(rptColOrder));
    localStorage.setItem('rptChkSize', JSON.stringify(rptChkSize));
  }catch(e){ console.warn('[Reporte] No se pudo guardar la personalización:', e); }
}
function rptLoadCustomization(){
  try{
    const o=localStorage.getItem('rptColOverride'); if(o) rptColOverride=JSON.parse(o)||{};
    const ord=localStorage.getItem('rptColOrder'); if(ord) rptColOrder=JSON.parse(ord)||[];
    const c=localStorage.getItem('rptChkSize'); if(c) rptChkSize=JSON.parse(c)||{w:42,h:15};
  }catch(e){ rptColOverride={}; rptColOrder=[]; rptChkSize={w:42,h:15}; }
  const wEl=document.getElementById('rptChkW'); if(wEl) wEl.value=(rptChkSize.w!==42)?rptChkSize.w:'';
  const hEl=document.getElementById('rptChkH'); if(hEl) hEl.value=(rptChkSize.h!==15)?rptChkSize.h:'';
}

function rptBuildHtml(data,forPrint){
  const g2=id=>document.getElementById(id);
  const useCod=g2('rc-cod').checked, useDesc=g2('rc-desc').checked,
        useStk=g2('rc-stk').checked, useUbi=g2('rc-ubi').checked,
        usePrc=g2('rc-prc').checked, usePacc=g2('rc-pacc')?.checked,
        usePsin=g2('rc-psin')?.checked, useCosto=g2('rc-costo')?.checked,
        useAbc=g2('rc-abc').checked,
        useGrp=g2('rc-grp').checked, useDias=g2('rc-dias')?.checked,
        useFecha=g2('rc-fecha').checked, useChk=g2('rc-check').checked, useChk2=g2('rc-check2')?.checked,
        useTotales=g2('rc-totales')?.checked, useKpis=g2('rc-kpis')?.checked;

  const title=g2('rptTitle').value||'Reporte';
  const compact=document.querySelector('input[name="rptDensity"]:checked')?.value==='compact';
  const groupBy=g2('rptGroupBy')?.value||'';
  const nota=(g2('rptNota')?.value||'').trim();
  const now=new Date().toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'});

  /* ── Definición de columnas (check van AL FINAL) ──
     La base (nombre/ancho/alineación por defecto) vive en rptDefaultCols();
     aquí se le aplica cualquier personalización guardada en rptColOverride. */
  const cols=rptDefaultCols().map(c=>{
    const o=rptColOverride[c.k];
    if(!o) return c;
    return {
      k:c.k,
      label:(o.label!=null&&o.label!=='')?o.label:c.label,
      w:(o.w!=null&&o.w!=='')?(o.w+'px'):c.w,
      al:o.al||c.al
    };
  });
  const nc=cols.length||1;

  // ¿El usuario personalizó manualmente el ancho de alguna columna (con el
  // campo numérico o arrastrando el borde en la vista previa)? Si es así,
  // la impresión/PDF también respeta esos anchos al pixel (table-layout
  // fixed, como en la vista previa). Si nunca se tocó ningún ancho, la
  // impresión se queda con el comportamiento de siempre: cada columna se
  // ensancha sola para que su contenido quepa (table-layout auto).
  const hasWidthOverride=Object.values(rptColOverride).some(o=>o&&o.w!=null&&o.w!=='');
  const layoutFixed=!forPrint||hasWidthOverride;

  const pad=compact?'3px 6px':'6px 10px';
  const fsize=compact?'8.5px':'10px';
  const lh=compact?'1.2':'1.4';

  /* ── Bloque de estilos embebido (una sola vez, no inline) ──
     Diseño unificado: la vista previa y la hoja impresa usan exactamente
     la misma identidad visual clara y profesional — ya no hay una versión
     "oscura" para configurar y otra "clara" solo al imprimir. */
  const ABC_COLORS={A:'#0e8a4a',B:'#b8790a',C:'#6a4fc0',D:'#c23838',E:'#7a2020'};
  const orientVal=document.querySelector('input[name="rptOrient"]:checked')?.value||'portrait';
  const style=`<style>
    .rpt-wrap{font-family:'Segoe UI',Arial,Helvetica,sans-serif;background:#fff;color:#1a2333;border-radius:${forPrint?'0':'8px'};overflow:hidden;${forPrint?'':'box-shadow:0 2px 20px rgba(0,0,0,.4);'}}
    .rpt-hdr{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;padding:${compact?'12px 16px 9px':'16px 20px 12px'};border-bottom:2.5px solid #1a3060}
    .rpt-hdr-eyebrow{font-size:7.5px;letter-spacing:.18em;color:#5a7090;text-transform:uppercase;margin-bottom:4px;font-weight:700}
    .rpt-hdr-title{font-size:${compact?'15px':'19px'};font-weight:800;color:#0f1d33;line-height:1.2}
    .rpt-hdr-meta{font-size:8.5px;color:#5a7090;letter-spacing:.02em;text-align:right;white-space:nowrap;line-height:1.5}
    .rpt-tbl-wrap{position:relative;overflow-x:auto;-webkit-overflow-scrolling:touch}
    table.rpt{width:100%;border-collapse:collapse;table-layout:${layoutFixed?'fixed':'auto'};font-size:${fsize}}
    table.rpt thead tr{background:#eef2fa;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    table.rpt th{position:relative;padding:${compact?'5px 7px':'7px 10px'};color:#1a3060;font-size:${compact?'7.5px':'8.5px'};font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-bottom:2px solid #1a3060;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* ── Overlay de redimensión ──
       En vez de una asa pegada solo al encabezado, esto pone una franja
       arrastrable de ALTO COMPLETO (cabecera + todas las filas) sobre
       cada borde de columna, para poder ajustar el ancho agarrando desde
       cualquier fila, no solo desde arriba. Se posiciona con JS después
       de insertar la tabla (rptLayoutResizeOverlay), midiendo el borde
       real de cada <th>. Solo existe en la vista previa interactiva. */
    .rpt-resize-overlay{position:absolute;top:0;left:0;pointer-events:none;z-index:6}
    .rpt-resize-bar{position:absolute;top:0;width:9px;margin-left:-4px;cursor:col-resize;pointer-events:auto;touch-action:none}
    .rpt-resize-bar:hover,.rpt-resize-bar.active{background:rgba(0,120,220,.22)}
    table.rpt td{padding:${pad};border-bottom:1px solid #e4e9f2;vertical-align:middle;line-height:${lh};color:#1a2333;${layoutFixed?'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0':''}}
    table.rpt tr.rpt-even td{background:#fff}
    table.rpt tr.rpt-odd td{background:#f7f9fc;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    table.rpt tr.rpt-grphdr td{background:#e3ebfa;color:#1a3060;font-size:${compact?'8px':'9px'};font-weight:700;letter-spacing:.05em;border-bottom:1px solid #b8c8e4;border-top:2px solid #1a3060;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    table.rpt tr.rpt-subtot td{background:#f0f4fc;border-top:1px solid #b8c8e4;border-bottom:2px solid #b8c8e4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    table.rpt tr.rpt-total td{background:#e3ebfa;border-top:2px solid #1a3060;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .rpt-tc{color:#1a5fa8;font-family:Consolas,monospace;letter-spacing:.02em;font-weight:600}
    .rpt-stk{color:#9a6a10;font-family:Consolas,monospace;text-align:center;font-weight:700}
    .rpt-ubi{color:#0f7a8c;letter-spacing:.02em;font-weight:600}
    .rpt-prc{color:#1a8a4a;font-family:Consolas,monospace;text-align:right;font-weight:600}
    .rpt-pacc{color:#b0700f;font-family:Consolas,monospace;text-align:right}
    .rpt-psin{color:#5a6b85;font-family:Consolas,monospace;text-align:right}
    .rpt-costo{color:#b0402f;font-family:Consolas,monospace;text-align:right}
    .rpt-dias{color:#6a4fc0;font-family:Consolas,monospace;text-align:center}
    .rpt-grp{font-size:${compact?'7.5px':'9px'};color:#5a6b85}
    .rpt-abc-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:${compact?'7px':'8px'};font-weight:800;letter-spacing:.05em}
    .rpt-chk-box{display:inline-block;width:${rptChkSize.w||42}px;height:${rptChkSize.h||15}px;border:1.4px solid #1a3060;border-radius:2px;background:#fff}
    .rpt-tot-lbl{font-size:${compact?'7.5px':'8.5px'};color:#1a3060;text-align:right;padding:${compact?'4px 10px':'6px 12px'};font-family:Consolas,monospace;font-weight:700}
    .rpt-tot-val{color:#1a3060;font-weight:800}
    .rpt-tot-money{color:#0e8a4a;font-weight:800}
    .rpt-nota{padding:8px 16px;border-top:1px solid #dbe3f0;font-size:${compact?'7.5px':'9px'};color:#5a6b85}
    .rpt-foot{padding:${compact?'5px 16px':'7px 18px'};text-align:right;font-size:7.5px;color:#8092ac;letter-spacing:.03em;border-top:1px solid #e4e9f2}
    /* KPI: franja delgada de una sola línea (antes eran tarjetas grandes que
       se envolvían a varias filas y ocupaban media hoja al imprimir) */
    .rpt-kpi-bar{display:flex;flex-wrap:wrap;background:#f7f9fc;border-bottom:1px solid #dbe3f0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .rpt-kpi-item{flex:1 1 0;min-width:82px;padding:${compact?'6px 12px':'7px 14px'};border-right:1px solid #dbe3f0}
    .rpt-kpi-item:last-child{border-right:none}
    .rpt-kpi-lbl{font-size:6.5px;letter-spacing:.08em;color:#7086a8;text-transform:uppercase;margin-bottom:1px;font-weight:700}
    .rpt-kpi-val{font-size:${compact?'12px':'13.5px'};font-weight:800;line-height:1.15;color:#0f1d33}
    .rpt-kpi-sub{font-size:6.5px;color:#8092ac}
    .rpt-abc-bar{display:flex;flex-wrap:wrap;gap:5px;padding:${compact?'6px 14px':'7px 16px'};background:#fff;border-bottom:1px solid #dbe3f0}
    .rpt-abc-chip{display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:8px;font-weight:700;letter-spacing:.03em}
    @media print{
      @page{margin:10mm;size:A4 ${orientVal}}
      html,body{background:#fff!important}
      table.rpt tr{page-break-inside:avoid}
      .rpt-hdr,table.rpt thead{page-break-after:avoid}
    }
  </style>`;

  /* ── Helpers ── */
  const abcBadge=abc=>{
    const cl=ABC_COLORS[abc]||'#606080';
    return`<span class="rpt-abc-badge" style="background:${cl}20;border:1px solid ${cl}60;color:${cl}">${escHtml(abc)}</span>`;
  };

  /* ── Renderizar fila ── */
  const renderRow=(d,rowIdx)=>
    `<tr class="${rowIdx%2===0?'rpt-even':'rpt-odd'}">`+
    cols.map(c=>{
      if(c.k==='cod')   return`<td class="rpt-tc">${escHtml(d.cod)}</td>`;
      if(c.k==='desc')  return`<td>${escHtml(d.desc||'—')}</td>`;
      if(c.k==='stk')   return`<td class="rpt-stk">${d.stk!=null?escHtml(String(d.stkFmt)):'—'}</td>`;
      if(c.k==='ubi')   return`<td class="rpt-ubi">${escHtml(d.ubi)}</td>`;
      if(c.k==='prc')   return`<td class="rpt-prc">${d.prc!=null?cop(d.prc):'—'}</td>`;
      if(c.k==='pacc')  return`<td class="rpt-pacc">${d.prcAcc!=null?cop(d.prcAcc):'—'}</td>`;
      if(c.k==='psin')  return`<td class="rpt-psin">${d.prcSin!=null?cop(d.prcSin):'—'}</td>`;
      if(c.k==='costo') return`<td class="rpt-costo">${d.costo!=null&&d.costo>0?cop(d.costo):'—'}</td>`;
      if(c.k==='abc')   return`<td style="text-align:center">${d.abc?abcBadge(d.abc):'<span style="color:#404060">—</span>'}</td>`;
      if(c.k==='grp')   return`<td class="rpt-grp">${escHtml(d.grp||'—')}</td>`;
      if(c.k==='dias')  return`<td class="rpt-dias">${d.dias!=null?Math.round(d.dias):'—'}</td>`;
      if(c.k==='chk'||c.k==='chk2') return`<td style="text-align:center"><span class="rpt-chk-box"></span></td>`;
      return'<td>—</td>';
    }).join('')+
    '</tr>';

  /* ── Fila de totales ── */
  const totRow=(items,label,cls='rpt-total')=>{
    const ts=items.reduce((s,d)=>s+(d.stk??0),0);
    const stockCell=`Stock: <span class="rpt-tot-val">${fmt(ts)}</span>`;

    // Identifica qué valor de venta corresponde según las columnas de precio
    // realmente activas — antes solo se activaba con "P. Mostr. +IVA" y quedaba
    // en blanco si el usuario solo marcaba Accesorio o Sin IVA.
    let valCell='';
    if(usePrc||usePacc){
      const tv=items.reduce((s,d)=>s+(d.prc!=null?d.prc*(d.stk??0):0),0);
      if(tv>0) valCell=` &nbsp;·&nbsp; Valor c/IVA: <span class="rpt-tot-money">${cop(tv)}</span>`;
    } else if(usePsin){
      const tvSin=items.reduce((s,d)=>s+(d.prcSin!=null?d.prcSin*(d.stk??0):0),0);
      if(tvSin>0) valCell=` &nbsp;·&nbsp; Valor sin IVA: <span class="rpt-tot-money">${cop(tvSin)}</span>`;
    }

    // Valor de costo es una métrica aparte (no lleva IVA, es base de inversión):
    // nunca se mezcla con el valor de venta y solo aparece si Costo está activo.
    let costCell='';
    if(useCosto){
      const tc=items.reduce((s,d)=>s+(d.costo!=null?d.costo*(d.stk??0):0),0);
      if(tc>0) costCell=` &nbsp;·&nbsp; Valor costo: <span class="rpt-tot-money" style="color:#b0402f">${cop(tc)}</span>`;
    }

    const cntCell=` &nbsp;·&nbsp; <span style="color:#4a6a90">${items.length} ref${items.length===1?'':'s'}</span>`;
    return`<tr class="${cls}"><td colspan="${nc}" class="rpt-tot-lbl">${escHtml(label)} &nbsp;&nbsp;${stockCell}${valCell}${costCell}${cntCell}</td></tr>`;
  };

  /* ── Cabecera de tabla ──
     colgroup + data-colkey en cada <th>: le da a cada columna un ancho
     explícito y direccionable. Se agrega siempre que el layout sea fijo
     (layoutFixed) — es decir, en la vista previa siempre, y también al
     imprimir/exportar PDF si el usuario personalizó algún ancho. El
     "resizer" en sí (la franja arrastrable) se arma aparte, como overlay
     de alto completo — ver rptLayoutResizeOverlay(). */
  const colgroup=layoutFixed?`<colgroup>${cols.map(c=>`<col data-colkey="${c.k}" style="width:${c.w||'auto'}">`).join('')}</colgroup>`:'';
  const thRow=`<thead>${colgroup}<tr>${cols.map(c=>
    `<th data-colkey="${c.k}" style="width:${c.w||''};text-align:${c.al||'left'}">${escHtml(c.label)}</th>`
  ).join('')}</tr></thead>`;

  /* ── Cuerpo con agrupación ── */
  let tbody='';
  let globalIdx=0;
  if(groupBy&&data.length){
    const getGK=d=>{
      if(groupBy==='abc') return d.abc||'Sin ABC';
      if(groupBy==='grp'){
        const g=String(d.grp||'').trim();
        if(!g) return 'Sin grupo';
        const pre=g.split(/[-/]/)[0].trim();
        return pre||g;
      }
      if(groupBy==='ubi'){const u=String(d.ubi||'—').trim();return(u==='-'||u===''||u==='—')?'Sin ubicación':u.split('-')[0];}
      return'';
    };
    const groups=new Map();
    data.forEach(d=>{const k=getGK(d);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(d);});
    const abcCol=groupBy==='abc';
    groups.forEach((items,gk)=>{
      const gcol=abcCol?(ABC_COLORS[gk]||'#3a5f96'):'#1a3060';
      const badge=abcCol&&ABC_COLORS[gk]?`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${gcol};margin-right:6px;vertical-align:middle"></span>`:'▸ ';
      tbody+=`<tr class="rpt-grphdr"><td colspan="${nc}" style="color:${gcol}">${badge}${escHtml(gk)} <span style="font-weight:400;opacity:.6">(${items.length})</span></td></tr>`;
      items.forEach(d=>{tbody+=renderRow(d,globalIdx++);});
      if(useTotales) tbody+=totRow(items,'Subtotal '+gk,'rpt-subtot');
    });
  } else {
    data.forEach(d=>{tbody+=renderRow(d,globalIdx++);});
  }
  if(useTotales&&data.length) tbody+=totRow(data,'TOTAL GENERAL');

  /* ── KPI block ── */
  const kpiBlock=(useKpis&&data.length)?rptBuildKpiBlock(data):'';

  /* ── Nota ── */
  const notaBlock=nota?`<div class="rpt-nota"><span style="font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:#3a5070">Notas · </span>${escHtml(nota)}</div>`:'';

  /* ── Footer ── */
  const foot=`<div class="rpt-foot">CONTROL UBI &nbsp;·&nbsp; ${now} &nbsp;·&nbsp; ${data.length} ítem${data.length===1?'':'s'}</div>`;

  /* ── Ensamble ── */
  return`${style}
<div class="rpt-wrap">
  <div class="rpt-hdr">
    <div>
      <div class="rpt-hdr-eyebrow">BODEGA &nbsp;·&nbsp; CONTROL DE INVENTARIO</div>
      <div class="rpt-hdr-title">${escHtml(title)}</div>
    </div>
    ${useFecha?`<div class="rpt-hdr-meta">${now}<br>${data.length} referencia${data.length===1?'':'s'}</div>`:''}
  </div>
  ${kpiBlock}
  <div class="rpt-tbl-wrap">
    <table class="rpt">${thRow}<tbody>${tbody}</tbody></table>
    ${forPrint?'':'<div class="rpt-resize-overlay" id="rptResizeOverlay"></div>'}
  </div>
  ${notaBlock}
  ${foot}
</div>`;
}
let _rptPreviewTimer=null;
function rptPreviewDebounced(delay=180){
  // Los campos de texto/número del formulario (título, notas, mín/máx, top N)
  // llamaban a rptPreview() en cada tecla, y rptPreview() vuelve a filtrar TODO
  // el inventario y reconstruye el HTML completo del reporte — con inventarios
  // grandes esto se sentía lento al escribir. Se agrupan las llamadas aquí.
  clearTimeout(_rptPreviewTimer);
  _rptPreviewTimer=setTimeout(rptPreview, delay);
}
function rptPreview(){
  rptRenderColCustomizer();
  const data=rptGetData();
  document.getElementById('rptPreviewInner').innerHTML=rptBuildHtml(data,false);
  rptLayoutResizeOverlay();
  // Enhanced count with value
  const valorTotal=data.reduce((s,d)=>s+(d.prc!=null?d.prc*(d.stk??0):0),0);
  const countEl=document.getElementById('rptRowCount');
  if(countEl) countEl.textContent=data.length+' referencia'+(data.length===1?'':'s')+(valorTotal>0?' · '+cop(valorTotal)+' valor total':'');
}
/* ── Overlay de redimensión de columnas (alto completo) ──
   Arma, dentro de #rptResizeOverlay, una franja arrastrable por cada
   borde de columna, midiendo la posición real de cada <th>. Así se puede
   agarrar el borde de una columna desde CUALQUIER fila del cuerpo, no
   solo desde el encabezado. Se llama de nuevo cada vez que se reconstruye
   la tabla entera (rptPreview) — durante un arrastre en curso NO se
   reconstruye (rompería la captura del puntero); en su lugar las franjas
   se reposicionan a mano, ver rptSetupColResize(). */
function rptLayoutResizeOverlay(){
  const box=document.getElementById('rptPreviewInner');
  const wrap=box?.querySelector('.rpt-tbl-wrap');
  const table=wrap?.querySelector('table.rpt');
  const overlay=document.getElementById('rptResizeOverlay');
  if(!wrap||!table||!overlay) return; // impresión, o sin datos: no hay nada que arrastrar
  const wrapRect=wrap.getBoundingClientRect();
  const tableRect=table.getBoundingClientRect();
  overlay.style.height=tableRect.height+'px';
  overlay.style.width=tableRect.width+'px';
  const ths=[...table.querySelectorAll('thead th[data-colkey]')];
  overlay.innerHTML=ths.map(th=>{
    const r=th.getBoundingClientRect();
    const left=(r.left-wrapRect.left)+wrap.scrollLeft+r.width;
    return `<div class="rpt-resize-bar" data-colkey="${th.dataset.colkey}" style="left:${left}px;height:${tableRect.height}px" title="Arrastra para cambiar el ancho"></div>`;
  }).join('');
}
/* ── Redimensionar columnas arrastrando (mouse o dedo) ──
   Delegado UNA sola vez sobre #rptPreviewInner: su innerHTML (y el de
   #rptResizeOverlay dentro) se reconstruye por completo en cada
   rptPreview(), pero el contenedor exterior no cambia, así que el
   listener delegado sigue funcionando sin volver a atarlo.
   Durante el arrastre en sí NO se reconstruye el overlay (eso perdería
   la captura del puntero a mitad de camino) — en cada pointermove se
   reposicionan a mano solo la franja arrastrada y las que están a su
   derecha (que se corren la misma distancia, porque angostar/ensanchar
   una columna empuja todo lo que viene después). */
function rptSetupColResize(){
  const box=document.getElementById('rptPreviewInner');
  if(!box || box._resizeBound) return;
  box._resizeBound=true;
  let state=null;
  box.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('.rpt-resize-bar');
    if(!handle) return;
    e.preventDefault();
    const overlay=document.getElementById('rptResizeOverlay');
    const table=box.querySelector('table.rpt');
    const key=handle.dataset.colkey;
    const th=table?.querySelector(`th[data-colkey="${CSS.escape(key)}"]`);
    const col=table?.querySelector(`col[data-colkey="${CSS.escape(key)}"]`);
    if(!th||!col||!overlay) return;
    const bars=[...overlay.querySelectorAll('.rpt-resize-bar')];
    const dragIdx=bars.indexOf(handle);
    state={
      startX:e.clientX,
      startW:th.getBoundingClientRect().width,
      col, liveW:null,
      // franjas desde la que se arrastra en adelante, con su posición inicial
      trailing:bars.slice(dragIdx).map(b=>({el:b,left:parseFloat(b.style.left)||0})),
      key
    };
    handle.classList.add('active');
    try{ handle.setPointerCapture(e.pointerId); }catch(err){}
  });
  box.addEventListener('pointermove',e=>{
    if(!state) return;
    const dx=e.clientX-state.startX;
    const newW=Math.max(24,Math.round(state.startW+dx));
    state.col.style.width=newW+'px';
    state.liveW=newW;
    // La franja arrastrada y todas las de su derecha se corren dx px —
    // sin reconstruir el overlay, para no perder la captura del puntero.
    const appliedDx=newW-state.startW;
    state.trailing.forEach(t=>{ t.el.style.left=(t.left+appliedDx)+'px'; });
  });
  const finish=()=>{
    if(!state) return;
    const {key,liveW}=state;
    document.querySelectorAll('#rptResizeOverlay .rpt-resize-bar.active').forEach(h=>h.classList.remove('active'));
    state=null;
    if(liveW!=null){
      rptColOverrideSet(key,'w',String(liveW));
      // Refleja el nuevo ancho también en el campo numérico del panel
      // "Personalizar columnas" sin esperar a que se re-renderice solo
      // (el panel solo se reconstruye cuando cambia el CONJUNTO de
      // columnas, no en cada resize). rptColOverrideSet ya dispara el
      // preview con debounce, que reconstruye el overlay entero y deja
      // todo exactamente alineado al pixel.
      const row=document.querySelector(`#rptColCustomizer .rpt-colcust-row[data-colkey="${CSS.escape(key)}"]`);
      const wInput=row?row.querySelector('input[type="number"]'):null;
      if(wInput) wInput.value=liveW;
    }
  };
  box.addEventListener('pointerup',finish);
  box.addEventListener('pointercancel',finish);
  // Si cambia el tamaño de la ventana (o gira el teléfono) con el modal
  // abierto, las franjas quedarían desalineadas del borde real de cada
  // columna — se reposicionan solas.
  window.addEventListener('resize',()=>{
    if(document.getElementById('rptOverlay')?.classList.contains('on')) rptLayoutResizeOverlay();
  });
}

function rptPrint(){
  const data=rptGetData();
  const html=rptBuildHtml(data,true);
  const orient=document.querySelector('input[name="rptOrient"]:checked')?.value||'portrait';
  const area=document.getElementById('rptPrintArea');
  // Blindaje: el motor de impresión depende de que #rptPrintArea sea hijo directo de <body>
  // (ver CSS "body>*{display:none}" + "#rptPrintArea{display:block}" en @media print).
  // Si alguna vez queda anidado dentro de #appShell u otro contenedor, el reporte
  // saldría en blanco al imprimir — por eso se reubica aquí antes de cada impresión.
  if(area.parentElement!==document.body) document.body.appendChild(area);
  area.innerHTML=`<style>@media print{@page{size:A4 ${orient};margin:8mm}.rpt-print-hide{display:none!important}}</style>`+html;
  area.style.display='block';
  setTimeout(()=>{window.print();setTimeout(()=>{area.innerHTML='';area.style.display='none';},500);},120);
}

export { closeRptModal, openRptModal, rptApplyColOrder, rptApplyPreset, rptChkSizeChange, rptColOverrideSet, rptExecute, rptGetData, rptPreview, rptPreviewDebounced, rptResetCustomization, rptSetDensity, rptSetFmt, rptSetGroup, rptSetOrient, rptSetSrc };
