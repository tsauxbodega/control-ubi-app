import { qrDataUrl } from './qr-local.js';
import { ESTANTES, INV, QR_SELECTED, QR_SEL_MODE, UBI_TEO, set_QR_SEL_MODE } from './state-globals.js';
import { normCode } from './file-upload.js';
import { openQRShelfModal } from './modales-estante-panorama.js';
import { CRUCE_CONTEO_A, CRUCE_CONTEO_B, LAST_LABEL_CONTEXT, set_LAST_LABEL_CONTEXT } from './conteo.js';
import { abrirImpresionEtiquetaConteo, imprimirEtiquetaCruceConteo } from './cruce-conteo.js';
import { CRUCE_A, CRUCE_B, CRUCE_GUARDADOS } from './cruce-referencias.js';
import { getQRBaseURL, renderEstQRGrid } from './qr-estantes.js';
// ═══ js/qr-grid.js — extraído de index.html (líneas 15561–15913 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ── QR GRID SELECTION ───────────────────────────────────────────────────────
function toggleQRSelMode(){
  set_QR_SEL_MODE(!QR_SEL_MODE);
  QR_SELECTED.clear();
  renderEstQRGrid();
  const btn=document.getElementById('qrSelModeBtn');
  const pBtn=document.getElementById('qrPrintSelBtn');
  if(btn){btn.textContent=QR_SEL_MODE?'✕ Cancelar':'☑ Seleccionar';btn.classList.toggle('active',QR_SEL_MODE);}
  if(pBtn){pBtn.style.display=QR_SEL_MODE?'inline-flex':'none';pBtn.textContent=`🖨 Imprimir (0)`;}
}
function toggleQRCard(estCode){
  if(!QR_SEL_MODE){openQRShelfModal(estCode);return;}
  if(QR_SELECTED.has(estCode))QR_SELECTED.delete(estCode);
  else QR_SELECTED.add(estCode);
  document.querySelectorAll('.qr-card-wrap').forEach(w=>{
    if(w.dataset.est!==estCode)return;
    w.classList.toggle('qr-selected',QR_SELECTED.has(estCode));
    const ch=w.querySelector('.qr-card-check');
    if(ch)ch.textContent=QR_SELECTED.has(estCode)?'✓':'';
  });
  const pBtn=document.getElementById('qrPrintSelBtn');
  if(pBtn)pBtn.textContent=`🖨 Imprimir (${QR_SELECTED.size})`;
}
function printSelectedQRs(){
  if(!QR_SELECTED.size){alert('Selecciona al menos un estante.');return;}
  const selEst=ESTANTES.filter(e=>QR_SELECTED.has(e[0]));
  const base=getQRBaseURL();
  const now=new Date().toLocaleString('es-CO');
  const cards=selEst.map(e=>{
    const url=`${base}?estante=${encodeURIComponent(e[0])}`;
    const qrSrc=qrDataUrl(url,600);
    return `<div style="display:inline-flex;flex-direction:column;align-items:center;border:2px solid #c0392b;border-radius:10px;padding:10px 12px;margin:8px;width:160px;page-break-inside:avoid">
      <div style="font-size:8px;color:#888;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px">Toyota · Control UBI</div>
      <img src="${qrSrc}" width="140" height="140" style="border-radius:4px;display:block;margin-bottom:6px">
      <div style="font-size:20px;font-weight:800;color:#111;letter-spacing:.04em">${e[0]}</div>
      <div style="font-size:9px;color:#555;margin-top:2px">ESTANTE · ${e[1]} ubi</div>
    </div>`;
  }).join('');
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR Estantes Toyota</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#fff;padding:16px}
  h1{font-size:14px;color:#c0392b;margin-bottom:4px}.meta{font-size:9px;color:#888;margin-bottom:12px}
  .grid{display:flex;flex-wrap:wrap;justify-content:flex-start}
  img{image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges}
  @media print{@page{margin:8mm}h1,div{page-break-inside:avoid}}</style>
  </head><body>
  <h1>🏢 QR Estantes — Toyota Control UBI</h1>
  <div class="meta">Generado: ${now} · ${selEst.length} estante${selEst.length===1?'':'s'} seleccionado${selEst.length===1?'':'s'} · Escanear para auditoría rápida</div>
  <div class="grid">${cards}</div>
  </body></html>`);
  w.document.close();
  setTimeout(()=>{try{w.focus();w.print();}catch(e){}},800);
}

// Infiere la ubicación teórica de un código buscando en UBI_TEO
function inferUbiTeorica(cod){
  const c = normCode(cod);
  // 1. Buscar en UBI_TEO directamente
  const teo = UBI_TEO.find(r => normCode(r[1]) === c);
  if(teo) return teo[0];
  // 2. Buscar en INV todas las ubicaciones distintas de "Sin Ubicacion"
  const ubis = INV.filter(r => r[0]===c && r[3] && r[3]!=='Sin Ubicacion').map(r=>r[3]);
  return ubis[0] || null;
}

// Genera el plan de ventas/movimientos para resolver el cruce
// Lógica mejorada: calcula exactamente cuánto vender de una ref usando el código de la otra
// para que sistema_A = físico_A y sistema_B = físico_B (si se conocen los físicos)
// o bien, cómo liberar el espacio de la ubicación incorrecta
function generarPlanCruce(a, b, ubiTeoA, ubiTeoB){
  const stkA = Number(a.stock) || 0;
  const stkB = Number(b.stock) || 0;
  const steps = [];

  const aCruza = ubiTeoB && a.ubi === ubiTeoB; // A está en lugar de B
  const bCruza = ubiTeoA && b.ubi === ubiTeoA; // B está en lugar de A

  const cruzadoTotal = aCruza && bCruza;
  const cruzadoParcial = aCruza || bCruza;

  if(cruzadoTotal){
    // Cruce confirmado por sistema: A está en ubi de B y B está en ubi de A
    // Para resolver: hay que vaciar una de las ubicaciones y mover
    // Si A > B: vender de A lo suficiente para moverlo, luego mover B a su lugar, luego mover A al suyo
    // Cuánto vender de A con código de B para "equilibrar": no aplica aquí, aplica el mover físico
    const menorStk = Math.min(stkA, stkB);
    const mayorStk = Math.max(stkA, stkB);

    if(stkA > 0 || stkB > 0){
      // Paso 1: Registrar venta de la ref que tiene MENOS stock usando el código de la OTRA
      // Esto reduce el sistema de la "otra" al mismo nivel que su físico real
      if(stkA <= stkB && stkA > 0){
        steps.push({
          tipo:'vender', urgencia:'urgent', icono:'🛒',
          accion:`Registrar venta de ${stkA} und. de ${a.cod} usando código ${b.cod}`,
          detalle:`Abre la venta en el sistema con código <strong>${b.cod}</strong> por <strong>${stkA} und.</strong> — esto descuenta el stock de B en el sistema, acercándolo al real físico. Física y visualmente son unidades de <strong>${a.cod}</strong> en ubicación <strong>${a.ubi}</strong>.`,
          cantidad: stkA, ref: a.cod
        });
      } else if(stkB < stkA && stkB > 0){
        steps.push({
          tipo:'vender', urgencia:'urgent', icono:'🛒',
          accion:`Registrar venta de ${stkB} und. de ${b.cod} usando código ${a.cod}`,
          detalle:`Abre la venta en el sistema con código <strong>${a.cod}</strong> por <strong>${stkB} und.</strong> — esto descuenta el stock de A en el sistema, acercándolo al real físico. Física y visualmente son unidades de <strong>${b.cod}</strong> en ubicación <strong>${b.ubi}</strong>.`,
          cantidad: stkB, ref: b.cod
        });
      }
    }

    // Paso 2: Mover físicamente
    steps.push({
      tipo:'mover', urgencia:'ok', icono:'📦',
      accion:`Mover físicamente: ${a.cod} → ${ubiTeoA||'su ubicación'} · ${b.cod} → ${ubiTeoB||'su ubicación'}`,
      detalle:`Trasladar las unidades restantes a sus posiciones correctas. <strong>${a.cod}</strong> debe quedar en <strong>${ubiTeoA||'—'}</strong> · <strong>${b.cod}</strong> debe quedar en <strong>${ubiTeoB||'—'}</strong>`,
      cantidad:0, ref:null
    });

    // Paso 3: Corregir sistema
    steps.push({
      tipo:'sistema', urgencia:'ok', icono:'💻',
      accion:`Actualizar ubicaciones en el sistema`,
      detalle:`Corregir en ERP/WMS: <strong>${a.cod}</strong> → <strong>${ubiTeoA||'—'}</strong> · <strong>${b.cod}</strong> → <strong>${ubiTeoB||'—'}</strong>`,
      cantidad:0, ref:null
    });

  } else if(cruzadoParcial){
    // Solo una de las dos está en lugar incorrecto
    const mal = aCruza ? a : b;
    const bien = aCruza ? b : a;
    const malTeo = aCruza ? ubiTeoA : ubiTeoB;
    const stkMal = Number(mal.stock)||0;
    const stkBien = Number(bien.stock)||0;

    // Cuánto hay que vender de "bien" con código de "mal" para liberar la ubi
    // O cuánto de "mal" con código de "bien" para ajustar sistema
    const venderParaLiberar = stkMal > 0 ? stkMal : 0;

    if(venderParaLiberar > 0){
      steps.push({
        tipo:'vender', urgencia:'urgent', icono:'🛒',
        accion:`Registrar ${venderParaLiberar} und. de ${mal.cod} para liberar ubicación`,
        detalle:`${mal.cod} ocupa físicamente la ubicación <strong>${mal.ubi}</strong> que corresponde a <strong>${bien.cod}</strong>. Registrar la venta real o ajuste de <strong>${venderParaLiberar} und.</strong> de <strong>${mal.cod}</strong> para limpiar la posición.`,
        cantidad: venderParaLiberar, ref: mal.cod
      });
    }
    steps.push({
      tipo:'mover', urgencia:'ok', icono:'📦',
      accion:`Mover ${mal.cod} a su ubicación correcta`,
      detalle:`Trasladar <strong>${mal.cod}</strong> de <strong>${mal.ubi}</strong> a <strong>${malTeo||'su ubicación teórica'}</strong>`,
      cantidad:0, ref:null
    });
    steps.push({
      tipo:'sistema', urgencia:'ok', icono:'💻',
      accion:`Actualizar ubicación de ${mal.cod} en el sistema`,
      detalle:`Corregir en ERP/WMS: <strong>${mal.cod}</strong> → <strong>${malTeo||'—'}</strong>`,
      cantidad:0, ref:null
    });

  } else {
    // Cruce no confirmado por sistema — usar diferencias de stock para sugerir cuánto vender
    // Escenario: A y B pueden estar mezcladas sin que el sistema lo sepa
    // Estimamos cuánto vender de A con código de B para equilibrar
    const totalFisico = stkA + stkB; // total físico combinado
    const equilibrio  = Math.floor(totalFisico / 2);
    const venderAconB = stkA > equilibrio ? stkA - equilibrio : 0;
    const venderBconA = stkB > equilibrio ? stkB - equilibrio : 0;

    if(venderAconB > 0){
      steps.push({
        tipo:'vender', urgencia:'urgent', icono:'🛒',
        accion:`Registrar ${venderAconB} und. de ${a.cod} con código de ${b.cod}`,
        detalle:`Para equilibrar: A tiene ${stkA} und. y B tiene ${stkB} und. Registrar venta de <strong>${venderAconB} und.</strong> con código <strong>${b.cod}</strong> — esto descuenta el sistema de B acercando ambas al punto de equilibrio (${equilibrio} c/u).`,
        cantidad: venderAconB, ref: a.cod
      });
    } else if(venderBconA > 0){
      steps.push({
        tipo:'vender', urgencia:'urgent', icono:'🛒',
        accion:`Registrar ${venderBconA} und. de ${b.cod} con código de ${a.cod}`,
        detalle:`Para equilibrar: B tiene ${stkB} und. y A tiene ${stkA} und. Registrar venta de <strong>${venderBconA} und.</strong> con código <strong>${a.cod}</strong> — esto descuenta el sistema de A acercando ambas al punto de equilibrio (${equilibrio} c/u).`,
        cantidad: venderBconA, ref: b.cod
      });
    } else {
      steps.push({
        tipo:'sistema', urgencia:'ok', icono:'✓',
        accion:`Stock equivalente — verificar ubicaciones físicamente`,
        detalle:`Ambas referencias tienen stock similar (A: ${stkA}, B: ${stkB}). Confirmar visualmente cuál está en cada ubicación.`,
        cantidad:0, ref:null
      });
    }

    steps.push({
      tipo:'mover', urgencia:'ok', icono:'📦',
      accion:`Mover cada referencia a su ubicación correcta`,
      detalle:`Después de los ajustes: <strong>${a.cod}</strong> → <strong>${ubiTeoA||'Ver sistema'}</strong> · <strong>${b.cod}</strong> → <strong>${ubiTeoB||'Ver sistema'}</strong>`,
      cantidad:0, ref:null
    });
    steps.push({
      tipo:'sistema', urgencia:'ok', icono:'💻',
      accion:`Corregir ubicaciones en el sistema ERP/WMS`,
      detalle:`Actualizar: <strong>${a.cod}</strong> → <strong>${ubiTeoA||'—'}</strong> · <strong>${b.cod}</strong> → <strong>${ubiTeoB||'—'}</strong>`,
      cantidad:0, ref:null
    });
  }

  return steps;
}

// Imprimir etiqueta directamente desde el resultado calculado
function imprimirEtiquetaCruce(){
  if(!CRUCE_A || !CRUCE_B){
    alert('Calcula primero el cruce para generar la etiqueta.');
    return;
  }
  const ubiTeoA = inferUbiTeorica(CRUCE_A.cod);
  const ubiTeoB = inferUbiTeorica(CRUCE_B.cod);
  const plan = generarPlanCruce(CRUCE_A, CRUCE_B, ubiTeoA, ubiTeoB);
  mostrarPreviewEtiqueta(CRUCE_A, CRUCE_B, plan, ubiTeoA, ubiTeoB);
}

function mostrarPreviewEtiqueta(a, b, plan, ubiTeoA, ubiTeoB){
  set_LAST_LABEL_CONTEXT( { mode:'main', a, b, plan, ubiTeoA, ubiTeoB });
  const html = generarHTMLEtiqueta(a, b, plan, ubiTeoA, ubiTeoB, true);
  document.getElementById('labelPreviewContent').innerHTML = html;
  document.getElementById('labelPreviewOverlay').classList.add('on');
}

function closeLabelPreview(){
  document.getElementById('labelPreviewOverlay').classList.remove('on');
}

function printLabelFromPreview(){
  const ctx = LAST_LABEL_CONTEXT;
  if(!ctx || !ctx.a || !ctx.b) return;
  if(ctx.mode === 'conteo'){
    abrirImpresionEtiquetaConteo(ctx.a, ctx.b, ctx.plan, ctx.ubiTeoA, ctx.ubiTeoB);
    return;
  }
  abrirImpresionEtiqueta(ctx.a, ctx.b, ctx.plan, ctx.ubiTeoA, ctx.ubiTeoB);
}

function generarHTMLEtiqueta(a, b, plan, ubiTeoA, ubiTeoB, preview){
  const now = new Date().toLocaleString('es-CO');
  const stepsHtml = plan.map((s,i)=>`
    <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;padding:7px;border:1px solid #ddd;border-radius:4px;background:${s.urgencia==='urgent'?'#fff5f5':s.urgencia==='ok'?'#f0fff4':'#fff'}">
      <div style="width:20px;height:20px;border-radius:50%;background:${s.urgencia==='urgent'?'#c0392b':s.urgencia==='ok'?'#27ae60':'#666'};color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;color:#111;margin-bottom:2px">${s.accion}${s.cantidad>0?` (${s.cantidad} und.)`:''}</div>
        <div style="font-size:9px;color:#555">${s.detalle.replace(/<[^>]*>/g,'')}</div>
      </div>
    </div>`).join('');

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:380px;padding:${preview?'8px':'0'}">
      <div style="background:#c0392b;color:#fff;padding:8px 12px;border-radius:6px 6px 0 0;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:9px;letter-spacing:.18em;text-transform:uppercase;opacity:.8">Toyota · Control UBI</div>
          <div style="font-size:13px;font-weight:700;letter-spacing:.06em">⚠ CRUCE DE REFERENCIAS</div>
        </div>
        <div style="font-size:8px;opacity:.7;text-align:right">${now}</div>
      </div>
      <div style="border:2px solid #c0392b;border-top:none;border-radius:0 0 6px 6px;padding:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div style="background:#e8f4fd;border:1px solid #b8d4ea;border-radius:4px;padding:8px">
            <div style="font-size:8px;color:#555;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px">REF A</div>
            <div style="font-size:12px;font-weight:700;color:#1a365d">${a.cod}</div>
            <div style="font-size:9px;color:#333;margin:2px 0">${(a.desc||'').slice(0,40)}</div>
            <div style="font-size:9px;color:#c0392b">📍 Ahora: ${a.ubi||'?'}</div>
            <div style="font-size:9px;color:#27ae60">✓ Debe ir: ${ubiTeoA||'Ver sistema'}</div>
            <div style="font-size:9px;font-weight:700">Stock: ${a.stock}</div>
          </div>
          <div style="background:#fef9e7;border:1px solid #f0d68a;border-radius:4px;padding:8px">
            <div style="font-size:8px;color:#555;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px">REF B</div>
            <div style="font-size:12px;font-weight:700;color:#7d3c00">${b.cod}</div>
            <div style="font-size:9px;color:#333;margin:2px 0">${(b.desc||'').slice(0,40)}</div>
            <div style="font-size:9px;color:#c0392b">📍 Ahora: ${b.ubi||'?'}</div>
            <div style="font-size:9px;color:#27ae60">✓ Debe ir: ${ubiTeoB||'Ver sistema'}</div>
            <div style="font-size:9px;font-weight:700">Stock: ${b.stock}</div>
          </div>
        </div>
        <div style="font-size:9px;font-weight:700;color:#c0392b;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px">📋 PASOS A SEGUIR:</div>
        ${stepsHtml}
        <div style="margin-top:8px;padding:6px;background:#f8f8f8;border-radius:4px;font-size:8px;color:#888;text-align:center">
          Generado por Control UBI Toyota · Responsable: _________________ · Fecha inicio: _________________
        </div>
      </div>
    </div>`;
}

function abrirImpresionEtiqueta(a, b, plan, ubiTeoA, ubiTeoB){
  const w = window.open('','_blank');
  const now = new Date().toLocaleString('es-CO');
  const body = generarHTMLEtiqueta(a, b, plan, ubiTeoA, ubiTeoB, false);
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Etiqueta Cruce - ${a.cod} / ${b.cod}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;padding:16px}
      @media print{
        body{padding:4px}
        @page{size:A5 landscape;margin:8mm}
      }
    </style>
  </head><body>
    ${body}
  </body></html>`);
  w.document.close();
  setTimeout(()=>{try{w.focus();w.print();}catch(e){}},300);
}

// Exportar etiqueta desde el select en la pestaña Exportar
function actualizarSelectCruces(){
  const sel = document.getElementById('labelCruceSelect');
  if(!sel) return;
  if(!CRUCE_GUARDADOS.length){
    sel.innerHTML = '<option value="">— No hay cruces guardados todavía —</option>';
    return;
  }
  sel.innerHTML = '<option value="">— Selecciona un cruce guardado —</option>' +
    CRUCE_GUARDADOS.map((c,i)=>
      `<option value="${i}">${c.fecha} · ${c.refA.cod} / ${c.refB.cod}</option>`
    ).join('');
}

function exportEtiquetaCruce(){
  if(CRUCE_CONTEO_A && CRUCE_CONTEO_B){
    imprimirEtiquetaCruceConteo();
    return;
  }
  const sel = document.getElementById('labelCruceSelect');
  const idx = parseInt(sel?.value);
  if(isNaN(idx) || !CRUCE_GUARDADOS[idx]){
    if(CRUCE_A && CRUCE_B){
      imprimirEtiquetaCruce();
    } else {
      alert('Primero calcula un cruce en la pestaña Conteo o selecciona uno guardado.');
    }
    return;
  }
  const c = CRUCE_GUARDADOS[idx];
  abrirImpresionEtiqueta(c.refA, c.refB, c.plan, c.ubiTeoA, c.ubiTeoB);
}

// Nota: CRUCE_GUARDADOS ahora se carga en hydrateUserCloudData(), tras autenticar
// (actualizarSelectCruces se llama cuando el panel de exportar se activa)



// Init theme on load
(function(){
  const saved=localStorage.getItem('ctrl_ubi_theme');
  const preferLight=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme=saved||(preferLight?'light':'dark');
  document.documentElement.setAttribute('data-theme',theme);
})();

export { actualizarSelectCruces, closeLabelPreview, exportEtiquetaCruce, inferUbiTeorica, printLabelFromPreview, printSelectedQRs, toggleQRCard, toggleQRSelMode };
