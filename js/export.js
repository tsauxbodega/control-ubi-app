import { ESTANTES, INV, NOSTOCK_UBI, PICKLIST, PRICES, UBI_TEO } from './state-globals.js';
import { getPriceRow } from './file-upload.js';
import { getBusListPrice } from './precios-divisor.js';
import { fmt } from './utils.js';
import { loadChanges, novFmtCOP } from './radar-cambios.js';
import { mcPartialCodes, mcResults_data } from './multi-codigo.js';
import { buildConteoshelfGrid, getConteoDiffs } from './conteo.js';
// ═══ js/export.js — extraído de index.html (líneas 14138–14339 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== EXPORT =====================
function exportXlsx(type){
  if(!window.XLSX){alert('Librería XLSX no disponible');return;}
  let wb, data, sheetName, filename;

  if(type==='inv'){
    if(!INV.length){alert('Sin datos de inventario.');return;}
    data=[['Código','Descripción','Stock','Ubicación','ABC','Grupo'],...INV.map(r=>[r[0],r[1],r[2],r[3],r[4],r[6]])];
    sheetName='Inventario'; filename='inventario_completo.xlsx';
  } else if(type==='ubi'){
    if(!UBI_TEO.length){alert('Sin datos de ubicaciones teóricas.');return;}
    data=[['Ubicación','Código','Descripción','Stock','Estado'],...UBI_TEO.map(r=>[r[0],r[1],r[2],r[3],r[4]])];
    sheetName='UBI_Teoricas'; filename='ubicaciones_teoricas.xlsx';
  } else if(type==='estantes'){
    if(!ESTANTES.length){alert('Sin datos de estantes.');return;}
    data=[['Estante','Total Ubi','Ocupadas','Libres','% Libre','Notas'],...ESTANTES.map(r=>[r[0],r[1],r[2],r[3],Math.round(r[4]*100)+'%',r[5]])];
    sheetName='Estantes'; filename='reporte_estantes.xlsx';
  } else if(type==='nostock'){
    if(!NOSTOCK_UBI.length){alert('Sin datos de referencias sin stock.');return;}
    data=[['Código','Descripción','Ubicación','Stock'],...NOSTOCK_UBI.map(r=>[r[0],r[1],r[2],r[3]])];
    sheetName='SinStock_ConUbi'; filename='nostock_con_ubicacion.xlsx';
  } else if(type==='precios'){
    const entries=Object.entries(PRICES);
    if(!entries.length){alert('Sin datos de precios.');return;}
    data=[['Código','Descripción','Precio Mostrador','Precio Accesorios','Mos+IVA','Acc+IVA','Costo'],
      ...entries.map(([k,v])=>{const costo=v[3]||0;return[k,v[2],v[0],v[1],+(v[0]*1.19).toFixed(2),+(v[1]*1.19).toFixed(2),costo||''];})];
    sheetName='Precios'; filename='lista_precios.xlsx';
  } else if(type==='pick'){
    const arr=[...PICKLIST.values()];
    if(!arr.length){alert('El tray está vacío.');return;}
    data=[['Código','Descripción','Stock','Ubicación','Precio'],
      ...arr.map(it=>[it.cod,it.desc,it.stock,it.ubi,it.price===null||it.price===undefined?'':it.price])];
    sheetName='Picking'; filename='lista_picking.xlsx';
  } else if(type==='diffs'){
    const diffs = getConteoDiffs();
    if(!diffs.length){alert('Sin diferencias de conteo registradas.');return;}
    data=[['Código','Descripción','Ubicación','Stock Sistema','Conteo Físico','Diferencia'],
      ...diffs.map(d=>[d.cod,d.desc,d.ubi,d.sistema,d.conteo,d.diff])];
    sheetName='Diferencias'; filename='diferencias_conteo.xlsx';
  } else if(type==='multicod'){
    const entries=Object.entries(mcResults_data);
    if(!entries.length){alert('No hay resultados de Multi-Código para exportar. Busca primero.');return;}
    data=[['Código buscado','Estado','Código real','Descripción','Stock total','Ubicación(es)','Precio c/IVA']];
    entries.forEach(([code,val])=>{
      if(val==='NOT_FOUND'){ data.push([code,'No encontrado','','','','','']); return; }
      const totalStock=val.reduce((a,r)=>a+r[2],0);
      const ubis=[...new Set(val.map(r=>r[3]).filter(u=>u&&u!=='Sin Ubicacion'))].join(', ');
      const pr=getPriceRow(val[0][0]);
      const ep=pr?getBusListPrice(pr,val[0][6]):null;
      data.push([code, mcPartialCodes.has(code)?'Parcial':'Encontrado', val[0][0], val[0][1]||'', totalStock, ubis, ep!=null?+(ep*1.19).toFixed(2):'']);
    });
    sheetName='MultiCodigo'; filename='multicodigo_resultados.xlsx';
  } else if(type==='novedades'){
    const changes=loadChanges();
    if(!changes.length){alert('El Radar de Cambios no tiene nada registrado todavía.');return;}
    const TIPO_LBL={PRECIO_UP:'Precio subió',PRECIO_DOWN:'Precio bajó',COSTO_UP:'Costo subió',COSTO_DOWN:'Costo bajó',
      AGOTADO:'Agotado',AGOTADO_NEG:'Stock negativo',STOCK_UP:'Stock subió',STOCK_DOWN:'Stock bajó',
      NUEVO:'Nueva referencia',UBI:'Cambio de ubicación',REMOVIDO:'Removido'};
    data=[['Tipo','Código','Descripción','Antes','Después','Δ','%','Veces','Primera detección','Última detección']];
    changes.slice().sort((a,b)=>b.ts-a.ts).forEach(c=>{
      const antes = c.oldPrice!=null?c.oldPrice:(c.oldStock!=null?c.oldStock:(c.oldUbi||''));
      const despues = c.newPrice!=null?c.newPrice:(c.newStock!=null?c.newStock:(c.newUbi||(c.type==='AGOTADO'?0:'')));
      data.push([
        TIPO_LBL[c.type]||c.type, c.cod, c.desc||'', antes, despues,
        c.delta!=null?c.delta:'', c.pct!=null?c.pct+'%':'',
        c.occurrences||1,
        c.firstTs?new Date(c.firstTs).toLocaleString('es-CO'):'',
        new Date(c.ts).toLocaleString('es-CO')
      ]);
    });
    sheetName='Radar_Cambios'; filename='radar_de_cambios.xlsx';
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  // Auto column width
  const cols = data[0].map((_,ci)=>{
    const max = Math.max(...data.map(r=>String(r[ci]||'').length));
    return {wch: Math.min(Math.max(max, 8), 50)};
  });
  ws['!cols']=cols;
  wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function exportPDF(type){
  const w = window.open('','_blank');
  let body='', title='';

  const style=`<style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:18px}
    h1{font-size:16px;font-weight:700;margin-bottom:4px;color:#c0392b}
    .meta{font-size:9px;color:#666;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    thead th{background:#c0392b;color:#fff;padding:6px 9px;text-align:left;font-size:9px;letter-spacing:.1em;text-transform:uppercase}
    tbody tr:nth-child(even){background:#f8f8f8}
    tbody tr{border-bottom:1px solid #eee}
    td{padding:5px 9px;font-size:10px;vertical-align:middle}
    .chk{width:16px;height:16px;border:1.5px solid #999;display:inline-block;border-radius:2px}
    .diff-pos{color:#0a8040;font-weight:700}
    .diff-neg{color:#c00;font-weight:700}
    .zero{color:#999}
    @media print{body{padding:8px}h1{color:#c0392b!important}thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style>`;
  const now = new Date().toLocaleString('es-CO');

  if(type==='pick'){
    const arr=[...PICKLIST.values()];
    if(!arr.length){w.close();alert('El tray está vacío.');return;}
    title='Lista de Picking — Control UBI Toyota';
    const rows = arr.map((it,i)=>`<tr><td><span class="chk"></span></td><td>${i+1}</td><td><b>${it.cod}</b></td><td>${it.desc||'—'}</td><td>${it.ubi||'—'}</td><td>${fmt(it.stock)}</td></tr>`).join('');
    body=`<h1>🧺 Lista de Picking</h1><div class="meta">Generado: ${now} · ${arr.length} referencias</div>
      <table><thead><tr><th>✓</th><th>#</th><th>Código</th><th>Descripción</th><th>Ubicación</th><th>Stock</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  } else if(type==='conteo'){
    const estante = document.getElementById('expEstanteSelect')?.value||'';
    let data = estante
      ? INV.filter(r=>r[3]&&r[3].toUpperCase().startsWith(estante.toUpperCase())&&r[3]!=='Sin Ubicacion')
      : INV.filter(r=>r[3]&&r[3]!=='Sin Ubicacion');
    data.sort((a,b)=>a[3].localeCompare(b[3]));
    if(!data.length){w.close();alert('Sin datos para generar la hoja.');return;}
    title='Hoja de Conteo — Control UBI Toyota';
    const rows = data.map((r,i)=>`<tr>
      <td>${i+1}</td><td><b>${r[0]}</b></td><td>${r[1]||'—'}</td>
      <td style="color:#0055a5">${r[3]}</td><td>${fmt(r[2])}</td>
      <td style="border:1.5px solid #bbb;min-width:60px">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>
      <td style="border:1.5px solid #bbb;min-width:60px">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>
    </tr>`).join('');
    body=`<h1>📋 Hoja de Conteo Físico${estante?' — Estante '+estante:''}</h1>
      <div class="meta">Generado: ${now} · ${data.length} referencias · Operario: _________________ Fecha: _________________</div>
      <table><thead><tr><th>#</th><th>Código</th><th>Descripción</th><th>Ubicación</th><th>Stk Sistema</th><th>Conteo 1</th><th>Conteo 2</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  } else if(type==='diffs'){
    const diffs=getConteoDiffs();
    if(!diffs.length){w.close();alert('Sin diferencias de conteo para exportar.');return;}
    title='Reporte de Diferencias — Conteo Físico';
    const rows=diffs.map((d,i)=>`<tr>
      <td>${i+1}</td><td><b>${d.cod}</b></td><td>${d.desc||'—'}</td>
      <td style="color:#0055a5">${d.ubi||'—'}</td><td>${d.sistema}</td><td><b>${d.conteo}</b></td>
      <td class="${d.diff>0?'diff-pos':d.diff<0?'diff-neg':'zero'}">${d.diff>0?'+':''}${d.diff}</td>
    </tr>`).join('');
    body=`<h1>📊 Reporte de Diferencias de Conteo</h1><div class="meta">Generado: ${now} · ${diffs.length} diferencias encontradas</div>
      <table><thead><tr><th>#</th><th>Código</th><th>Descripción</th><th>Ubicación</th><th>Stk Sistema</th><th>Conteo Físico</th><th>Diferencia</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  } else if(type==='novedades'){
    const changes=loadChanges().slice().sort((a,b)=>b.ts-a.ts);
    if(!changes.length){w.close();alert('El Radar de Cambios no tiene nada registrado todavía.');return;}
    const TIPO_LBL={PRECIO_UP:'Precio subió',PRECIO_DOWN:'Precio bajó',COSTO_UP:'Costo subió',COSTO_DOWN:'Costo bajó',
      AGOTADO:'Agotado',AGOTADO_NEG:'Stock negativo',STOCK_UP:'Stock subió',STOCK_DOWN:'Stock bajó',
      NUEVO:'Nueva referencia',UBI:'Cambio de ubicación',REMOVIDO:'Removido'};
    title='Radar de Cambios — Control UBI Toyota';
    const rows=changes.map((c,i)=>{
      const antes = c.oldPrice!=null?'$'+novFmtCOP(c.oldPrice):(c.oldStock!=null?c.oldStock:(c.oldUbi||'—'));
      const despues = c.newPrice!=null?'$'+novFmtCOP(c.newPrice):(c.newStock!=null?c.newStock:(c.newUbi||(c.type==='AGOTADO'?'0':'—')));
      const deltaCls = (c.delta>0 && (c.type.includes('UP')||c.type==='STOCK_UP')) ? (c.type.startsWith('PRECIO')||c.type.startsWith('COSTO')?'diff-neg':'diff-pos')
                      : (c.delta<0 ? (c.type.startsWith('PRECIO')||c.type.startsWith('COSTO')?'diff-pos':'diff-neg') : 'zero');
      return `<tr>
        <td>${i+1}</td><td>${TIPO_LBL[c.type]||c.type}</td><td><b>${c.cod}</b></td><td>${c.desc||'—'}</td>
        <td>${antes}</td><td>${despues}</td>
        <td class="${deltaCls}">${c.pct!=null?(c.pct>0?'+':'')+c.pct+'%':(c.delta!=null?(c.delta>0?'+':'')+c.delta:'—')}</td>
        <td>${c.occurrences>1?'×'+c.occurrences:'—'}</td>
        <td>${new Date(c.ts).toLocaleDateString('es-CO')}</td>
      </tr>`;
    }).join('');
    body=`<h1>📡 Radar de Cambios</h1><div class="meta">Generado: ${now} · ${changes.length} cambios registrados</div>
      <table><thead><tr><th>#</th><th>Tipo</th><th>Código</th><th>Descripción</th><th>Antes</th><th>Después</th><th>Δ</th><th>Veces</th><th>Última vez</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>${style}</head><body>${body}</body></html>`);
  w.document.close();
  setTimeout(()=>{try{w.focus();w.print();}catch(e){}},300);
}

function populateEstanteSelects(){
  // Build estante list from ESTANTES data or fallback to inferring from inventory
  let estList = [];
  if(ESTANTES.length){
    estList = ESTANTES.slice().sort((a,b)=>a[0].localeCompare(b[0])).map(e=>e[0]);
  } else if(INV.length){
    const prefixes = new Set(
      INV.map(r=>r[3]).filter(u=>u&&u!=='Sin Ubicacion')
        .map(u=>{ const m=u.match(/^([A-Za-z]+\d*)/); return m?m[1]:u.slice(0,2); })
        .filter(Boolean)
    );
    estList = [...prefixes].sort();
  }

  // Populate legacy selects (expEstanteSelect still used in Exportar)
  ['expEstanteSelect'].forEach(id=>{
    const sel=document.getElementById(id);
    if(!sel)return;
    const prev=sel.value;
    sel.innerHTML='<option value="">— Todos los estantes —</option>'+
      estList.map(e=>`<option value="${e}">${e}</option>`).join('');
    if(prev && estList.includes(prev)) sel.value=prev;
  });

  // Build conteo shelf mosaic
  buildConteoshelfGrid();
}

export { exportPDF, exportXlsx, populateEstanteSelects };
