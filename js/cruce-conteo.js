import { escHtml, jsAttrSafe, setAlert } from './utils.js';
import { CONTEO_CURRENT, CRUCE_CONTEO_A, CRUCE_CONTEO_B, LAST_LABEL_CONTEXT, renderConteo, set_CRUCE_CONTEO_A, set_CRUCE_CONTEO_B, set_LAST_LABEL_CONTEXT } from './conteo.js';
import { inferUbiTeorica } from './qr-grid.js';
// ═══ js/cruce-conteo.js — extraído de index.html (líneas 14841–15230 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== CRUCE DESDE CONTEO =====================
function toggleConteoSelCruce(idx){
  const d = CONTEO_CURRENT[idx];
  const item = { cod:d.cod, desc:d.desc, sistema:d.sistema, conteo:d.conteo, ubi:d.ubi, idx };

  const isA = CRUCE_CONTEO_A && CRUCE_CONTEO_A.cod===d.cod && CRUCE_CONTEO_A.ubi===d.ubi;
  const isB = CRUCE_CONTEO_B && CRUCE_CONTEO_B.cod===d.cod && CRUCE_CONTEO_B.ubi===d.ubi;

  if(isA){ set_CRUCE_CONTEO_A(null); }
  else if(isB){ set_CRUCE_CONTEO_B(null); }
  else if(!CRUCE_CONTEO_A){ set_CRUCE_CONTEO_A(item); }
  else if(!CRUCE_CONTEO_B){ set_CRUCE_CONTEO_B(item); }
  else {
    // Ya hay 2: reemplazar A
    set_CRUCE_CONTEO_A(item);
  }

  renderCruceTray();
  renderConteo(); // re-render para actualizar botones de selección
}

function updateCruceTraySlot(slot){
  const item = slot==='A'?CRUCE_CONTEO_A:CRUCE_CONTEO_B;
  if(!item) return;
  // Actualizar con el conteo actual del store
  const d = CONTEO_CURRENT.find(x=>x.cod===item.cod&&x.ubi===item.ubi);
  if(d){ if(slot==='A') CRUCE_CONTEO_A.conteo=d.conteo; else CRUCE_CONTEO_B.conteo=d.conteo; }
  renderCruceTray();
}

function renderCruceTray(){
  const tray = document.getElementById('cruceTray');
  const btn  = document.getElementById('cruceTrayCalcBtn');
  const hasA = !!CRUCE_CONTEO_A, hasB = !!CRUCE_CONTEO_B;
  tray.classList.toggle('on', hasA||hasB);

  const slotAel = document.getElementById('cruceTraySlotA');
  const slotBel = document.getElementById('cruceTraySlotB');

  if(hasA){
    slotAel.classList.add('filled-a');
    document.getElementById('cruceTrayCodeA').textContent = CRUCE_CONTEO_A.cod;
    document.getElementById('cruceTrayNumsA').textContent =
      `Sist: ${CRUCE_CONTEO_A.sistema} · Físico: ${CRUCE_CONTEO_A.conteo??'—'} · Ubi: ${CRUCE_CONTEO_A.ubi}`;
  } else {
    slotAel.classList.remove('filled-a');
    document.getElementById('cruceTrayCodeA').textContent='— sin seleccionar —';
    document.getElementById('cruceTrayNumsA').textContent='';
  }
  if(hasB){
    slotBel.classList.add('filled-b');
    document.getElementById('cruceTrayCodeB').textContent = CRUCE_CONTEO_B.cod;
    document.getElementById('cruceTrayNumsB').textContent =
      `Sist: ${CRUCE_CONTEO_B.sistema} · Físico: ${CRUCE_CONTEO_B.conteo??'—'} · Ubi: ${CRUCE_CONTEO_B.ubi}`;
  } else {
    slotBel.classList.remove('filled-b');
    document.getElementById('cruceTrayCodeB').textContent='— sin seleccionar —';
    document.getElementById('cruceTrayNumsB').textContent='';
  }

  btn.disabled = !(hasA&&hasB);
}

function limpiarCruceTray(){
  set_CRUCE_CONTEO_A(null); set_CRUCE_CONTEO_B(null);
  renderCruceTray();
  document.getElementById('cruceMatchResult').classList.remove('on');
  if(CONTEO_CURRENT.length) renderConteo();
}

// ── CÁLCULO DEL CRUCE DESDE CONTEO ──────────────────────────────────────
// Lógica: Registrar ventas de una ref usando el código de la otra
// para que al final: sistema_A = fisico_A  y  sistema_B = fisico_B
// Principio: si A tiene más en sistema que en físico Y B tiene menos,
// es probable que se hayan vendido B con código A (o viceversa).
// Se calcula la cantidad a "pasar" de una a otra mediante ajuste de venta.
function construirAnalisisCruceConteo(a, b){
  const sA = Number(a?.sistema)||0;
  const sB = Number(b?.sistema)||0;
  const fA = a?.conteo!==null && a?.conteo!==undefined ? Number(a.conteo) : null;
  const fB = b?.conteo!==null && b?.conteo!==undefined ? Number(b.conteo) : null;
  const diffA = fA!==null ? fA - sA : null;
  const diffB = fB!==null ? fB - sB : null;

  const out = {
    a, b, sA, sB, fA, fB, diffA, diffB,
    tipo: 'sin_datos',
    cruce: 0,
    cruceSimetrico: false,
    diagnostico: '',
    pasos: []
  };

  if(diffA===null || diffB===null){
    out.diagnostico = 'Ingresa el conteo físico de ambas referencias para calcular el cruce.';
    return out;
  }

  if(diffA < 0 && diffB >= 0){
    const cant = Math.min(-diffA, diffB);
    out.tipo = 'A_USA_B';
    out.cruce = cant;
    out.cruceSimetrico = (-diffA === diffB);
    out.diagnostico = `${a.cod} tiene ${Math.abs(diffA)} und. faltantes en sistema y ${b.cod} tiene ${diffB} und. sobrantes físicas. El sobrante físico de <strong>${b.cod}</strong> corresponde a unidades de <strong>${a.cod}</strong> despachadas con código incorrecto. La corrección es registrar salida física de <strong>${b.cod}</strong> usando el código de <strong>${a.cod}</strong> — esto descuenta el sistema de <strong>${a.cod}</strong> y empata con su físico real.`;
  } else if(diffA >= 0 && diffB < 0){
    const cant = Math.min(diffA, -diffB);
    out.tipo = 'B_USA_A';
    out.cruce = cant;
    out.cruceSimetrico = (diffA === -diffB);
    out.diagnostico = `${a.cod} tiene ${diffA} und. sobrantes físicas y ${b.cod} tiene ${Math.abs(diffB)} und. faltantes en sistema. El sobrante físico de <strong>${a.cod}</strong> corresponde a unidades de <strong>${b.cod}</strong> despachadas con código incorrecto. La corrección es registrar salida física de <strong>${a.cod}</strong> usando el código de <strong>${b.cod}</strong> — esto descuenta el sistema de <strong>${b.cod}</strong> y empata con su físico real.`;
  } else if(diffA < 0 && diffB < 0){
    out.tipo = 'ajuste_individual';
    out.diagnostico = `Ambas referencias tienen faltante físico respecto al sistema (${a.cod}: ${Math.abs(diffA)} und.; ${b.cod}: ${Math.abs(diffB)} und.). No hay cruce claro entre ambas; conviene revisar ajustes o ventas independientes.`;
  } else if(diffA > 0 && diffB > 0){
    out.tipo = 'sobran_ambas';
    out.diagnostico = `Ambas referencias tienen sobrante físico respecto al sistema (${a.cod}: ${diffA} und.; ${b.cod}: ${diffB} und.). No hay cruce claro entre ambas; revisa ingresos no registrados.`;
  } else {
    out.tipo = 'ok';
    out.diagnostico = `No hay un cruce evidente. Una de las referencias ya está cuadrada o ambas están alineadas con el sistema.`;
  }

  out.pasos = generarPasosCruceConteo(out);
  return out;
}

function calcularCruceDesdeConteo(){
  const a = CRUCE_CONTEO_A, b = CRUCE_CONTEO_B;
  if(!a||!b){ setAlert('conteoAlert','alw',true,'⚠️ Selecciona 2 referencias primero.'); return; }

  const result = document.getElementById('cruceMatchResult');
  result.classList.add('on');

  const analisis = construirAnalisisCruceConteo(a, b);
  const diffA = analisis.diffA;
  const diffB = analisis.diffB;
  const sA = analisis.sA;
  const sB = analisis.sB;
  const fA = analisis.fA;
  const fB = analisis.fB;
  const pasos = analisis.pasos || [];

  const stepsHtml = pasos.map((s,i)=>`
    <div class="cruce-conteo-step ${s.urgencia||''}">
      <div class="cruce-conteo-step-num">${i+1}</div>
      <div class="cruce-conteo-step-body">
        <div class="cruce-conteo-step-action">${s.icono||''} ${s.accion}${s.cantidad>0?`<span class="cruce-qty-pill">${s.cantidad} und.</span>`:''}</div>
        <div class="cruce-conteo-step-detail">${s.detalle}</div>
      </div>
    </div>`).join('');

  result.innerHTML = `
    <div class="cruce-match-collapse-hdr" onclick="toggleCruceMatchCollapse(this)" aria-expanded="true">
      <div class="cruce-match-collapse-title">
        <span>🔀</span> Análisis de cruce — ${a.cod} ⇄ ${b.cod}
        ${analisis.cruceSimetrico?'<span style="background:rgba(31,199,106,.15);color:var(--green);border:1px solid rgba(31,199,106,.3);padding:2px 8px;border-radius:10px;font-size:9px">✓ CRUCE PERFECTO</span>':''}
      </div>
      <span class="cruce-match-collapse-arrow">▼</span>
    </div>
    <div class="cruce-match-body" id="cruceMatchBody">

    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px;font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.6">
      🔍 <strong>Diagnóstico:</strong> ${analisis.diagnostico}
    </div>

    <div class="cruce-match-grid">
      <div class="cruce-match-card">
        <div class="cruce-match-card-lbl">Ref A</div>
        <div class="cruce-match-card-code" style="display:flex;align-items:center;gap:4px">${escHtml(a.cod)}<button class="pcpy-sm" type="button" onclick="copyCode('${jsAttrSafe(a.cod)}',this)" title="Copiar código">⎘</button></div>
        <div style="font-size:10px;color:var(--text3);margin-bottom:6px">${(a.desc||'').slice(0,45)}</div>
        <div class="cruce-match-card-nums">
          <div class="cruce-match-num-row"><span>Ubi</span><span>${a.ubi||'—'}</span></div>
          <div class="cruce-match-num-row"><span>Sistema</span><span>${sA}</span></div>
          <div class="cruce-match-num-row ${fA!==null?(sA===fA?'ok':sA>fA?'highlight':'ok'):''}"><span>Físico</span><span>${fA??'—'}</span></div>
          <div class="cruce-match-num-row ${diffA===null?'':diffA>0?'highlight':diffA<0?'ok':''}"><span>Diferencia</span><span>${diffA===null?'—':diffA>0?'+'+diffA:diffA}</span></div>
        </div>
      </div>
      <div class="cruce-match-card">
        <div class="cruce-match-card-lbl">Ref B</div>
        <div class="cruce-match-card-code" style="display:flex;align-items:center;gap:4px;color:var(--purple)">${escHtml(b.cod)}<button class="pcpy-sm" type="button" onclick="copyCode('${jsAttrSafe(b.cod)}',this)" title="Copiar código">⎘</button></div>
        <div style="font-size:10px;color:var(--text3);margin-bottom:6px">${(b.desc||'').slice(0,45)}</div>
        <div class="cruce-match-card-nums">
          <div class="cruce-match-num-row"><span>Ubi</span><span>${b.ubi||'—'}</span></div>
          <div class="cruce-match-num-row"><span>Sistema</span><span>${sB}</span></div>
          <div class="cruce-match-num-row ${fB!==null?(sB===fB?'ok':sB>fB?'highlight':'ok'):''}"><span>Físico</span><span>${fB??'—'}</span></div>
          <div class="cruce-match-num-row ${diffB===null?'':diffB>0?'highlight':diffB<0?'ok':''}"><span>Diferencia</span><span>${diffB===null?'—':diffB>0?'+'+diffB:diffB}</span></div>
        </div>
      </div>
    </div>

    ${stepsHtml.length?`
    <div style="font-family:var(--mono);font-size:9px;color:var(--amber);letter-spacing:.1em;text-transform:uppercase;margin-bottom:7px">📋 PASOS A SEGUIR</div>
    <div class="cruce-conteo-steps">${stepsHtml}</div>`:''}

    <div class="cruce-conteo-tag-row">
      <button class="cruce-tag-btn" onclick="imprimirEtiquetaCruceConteo()">🏷️ Imprimir etiqueta para bodega</button>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text3)">Los datos del conteo se usan como stock físico real</span>
    </div>
    </div>`;
}

function generarPasosCruceConteo(analisis){
  const {a, b, sA, sB, fA, fB, diffA, diffB, tipo, cruce} = analisis;
  const pasos = [];
  const addResidual = (ref, diff)=>{
    if(diff===null || diff===0) return;
    if(diff < 0){
      pasos.push({
        urgencia:'urgent', icono:'⚠️',
        accion:`Queda faltante pendiente en ${ref.cod}: ${Math.abs(diff)} und.`,
        detalle:`Después del cruce parcial, todavía faltan ${Math.abs(diff)} und. para cuadrar ${ref.cod}. Revisa si existe otra referencia que absorbió estas salidas o si hace falta un ajuste individual.`,
        cantidad: Math.abs(diff)
      });
    } else {
      pasos.push({
        urgencia:'ok', icono:'📥',
        accion:`Queda sobrante pendiente en ${ref.cod}: ${diff} und.`,
        detalle:`Después del cruce parcial, todavía sobran ${diff} und. en ${ref.cod}. Revisa ingresos no registrados o movimientos duplicados.`,
        cantidad: diff
      });
    }
  };

  if(tipo==='A_USA_B'){
    // A tiene faltante (sist>fis), B tiene sobrante físico (fis>sist).
    // El sobrante de B son unidades de A mal registradas.
    // Acción: tomar físicamente del sobrante de B y registrar la salida con código de A.
    // Esto reduce el sistema de A (acercándolo a su físico real).
    const qty = cruce > 0 ? cruce : Math.abs(diffA || 0);
    if(qty > 0){
      const fisB_final = (fB !== null ? fB : sB) - qty;
      const sistA_final = Math.max(0, sA - qty);
      pasos.push({
        urgencia:'urgent', icono:'🛒',
        accion:`Registrar salida de ${b.cod} usando código ${a.cod}`,
        detalle:`Tomar físicamente ${qty} und. del sobrante de <strong>${b.cod}</strong> (Físico: ${fB ?? sB} → ${fisB_final}) y registrar la salida en el sistema bajo el código <strong>${a.cod}</strong>. Esto descuenta el sistema de <strong>${a.cod}</strong> de ${sA} a ${sistA_final}. Al cierre: <strong>${a.cod}</strong> = Sist ${sistA_final} · Físico ${fA ?? 0} · <strong>${b.cod}</strong> = Sist ${sB} · Físico ${fisB_final}`,
        cantidad: qty
      });
    }
    addResidual(a, diffA + qty);
  } else if(tipo==='B_USA_A'){
    // B tiene faltante (sist>fis), A tiene sobrante físico (fis>sist).
    // El sobrante de A son unidades de B mal registradas.
    // Acción: tomar físicamente del sobrante de A y registrar la salida con código de B.
    // Esto reduce el sistema de B (acercándolo a su físico real).
    const qty = cruce > 0 ? cruce : Math.abs(diffB || 0);
    if(qty > 0){
      const fisA_final = (fA !== null ? fA : sA) - qty;
      const sistB_final = Math.max(0, sB - qty);
      pasos.push({
        urgencia:'urgent', icono:'🛒',
        accion:`Registrar salida de ${a.cod} usando código ${b.cod}`,
        detalle:`Tomar físicamente ${qty} und. del sobrante de <strong>${a.cod}</strong> (Físico: ${fA ?? sA} → ${fisA_final}) y registrar la salida en el sistema bajo el código <strong>${b.cod}</strong>. Esto descuenta el sistema de <strong>${b.cod}</strong> de ${sB} a ${sistB_final}. Al cierre: <strong>${a.cod}</strong> = Sist ${sA} · Físico ${fisA_final} · <strong>${b.cod}</strong> = Sist ${sistB_final} · Físico ${fB ?? 0}`,
        cantidad: qty
      });
    }
    addResidual(b, diffB + qty);
  } else if(tipo==='sobran_ambas'){
    if(diffA>0) pasos.push({ urgencia:'urgent', icono:'⚙️', accion:`Ajuste de salida en ${a.cod}: ${diffA} und.`, detalle:`El sistema tiene ${diffA} und. más que el físico. Registrar ajuste de salida para dejar ${a.cod} cuadrado.`, cantidad: diffA });
    if(diffB>0) pasos.push({ urgencia:'urgent', icono:'⚙️', accion:`Ajuste de salida en ${b.cod}: ${diffB} und.`, detalle:`El sistema tiene ${diffB} und. más que el físico. Registrar ajuste de salida para dejar ${b.cod} cuadrado.`, cantidad: diffB });
  } else if(tipo==='ajuste_individual'){
    if(diffA<0) pasos.push({ urgencia:'urgent', icono:'⚙️', accion:`Revisar faltante en ${a.cod}: ${Math.abs(diffA)} und.`, detalle:`No encaja con un cruce limpio. Verifica si ${a.cod} tiene salidas registradas con otro código o una diferencia independiente.`, cantidad: Math.abs(diffA) });
    if(diffB<0) pasos.push({ urgencia:'urgent', icono:'⚙️', accion:`Revisar faltante en ${b.cod}: ${Math.abs(diffB)} und.`, detalle:`No encaja con un cruce limpio. Verifica si ${b.cod} tiene salidas registradas con otro código o una diferencia independiente.`, cantidad: Math.abs(diffB) });
  } else {
    pasos.push({ urgencia:'ok', icono:'✓', accion:'No se requiere cruce', detalle:'El inventario físico coincide con el sistema o no existe un patrón claro de cruce entre estas dos referencias.', cantidad:0 });
  }

  // Calcular valores finales de sistema y físico para cada ref
  let finalA_sist, finalA_fis, finalB_sist, finalB_fis;

  if(tipo==='A_USA_B' && cruce > 0){
    // Se toman físico de B y se registra bajo código A → baja sist A y baja fis B
    finalA_sist = Math.max(0, sA - cruce);
    finalA_fis  = fA !== null ? fA : 0;
    finalB_sist = sB;
    finalB_fis  = (fB !== null ? fB : sB) - cruce;
  } else if(tipo==='B_USA_A' && cruce > 0){
    // Se toman físico de A y se registra bajo código B → baja sist B y baja fis A
    finalA_sist = sA;
    finalA_fis  = (fA !== null ? fA : sA) - cruce;
    finalB_sist = Math.max(0, sB - cruce);
    finalB_fis  = fB !== null ? fB : 0;
  } else {
    finalA_sist = fA !== null ? fA : sA;
    finalA_fis  = fA !== null ? fA : sA;
    finalB_sist = fB !== null ? fB : sB;
    finalB_fis  = fB !== null ? fB : sB;
  }

  pasos.push({
    urgencia:'info', icono:'💻',
    accion:'Verificar y cerrar en el sistema ERP/WMS',
    detalle:`Confirmar que al finalizar la venta cruzada de <strong>${cruce}</strong> und., el sistema quede: <strong>${a.cod}</strong> = Sist ${finalA_sist} · Físico ${finalA_fis} · <strong>${b.cod}</strong> = Sist ${finalB_sist} · Físico ${finalB_fis}`,
    cantidad:0
  });
  return pasos;
}

function imprimirEtiquetaCruceConteo(){
  if(!CRUCE_CONTEO_A||!CRUCE_CONTEO_B){ alert('Calcula primero el cruce.'); return; }
  const a = { cod:CRUCE_CONTEO_A.cod, desc:CRUCE_CONTEO_A.desc, stock:CRUCE_CONTEO_A.sistema, ubi:CRUCE_CONTEO_A.ubi };
  const b = { cod:CRUCE_CONTEO_B.cod, desc:CRUCE_CONTEO_B.desc, stock:CRUCE_CONTEO_B.sistema, ubi:CRUCE_CONTEO_B.ubi };
  const ubiTeoA = inferUbiTeorica(a.cod);
  const ubiTeoB = inferUbiTeorica(b.cod);

  const analisis = construirAnalisisCruceConteo(CRUCE_CONTEO_A, CRUCE_CONTEO_B);
  const aEt = {...a, fisico: CRUCE_CONTEO_A.conteo };
  const bEt = {...b, fisico: CRUCE_CONTEO_B.conteo };
  mostrarPreviewEtiquetaConteo(aEt, bEt, analisis.pasos, ubiTeoA, ubiTeoB);
}

function mostrarPreviewEtiquetaConteo(a, b, plan, ubiTeoA, ubiTeoB){
  set_LAST_LABEL_CONTEXT( { mode:'conteo', a, b, plan, ubiTeoA, ubiTeoB });
  const html = generarHTMLEtiquetaConteo(a, b, plan, ubiTeoA, ubiTeoB, true);
  document.getElementById('labelPreviewContent').innerHTML = html;
  document.getElementById('labelPreviewOverlay').classList.add('on');
}

function abrirImpresionEtiquetaConteo(a, b, plan, ubiTeoA, ubiTeoB){
  const w = window.open('','_blank');
  const body = generarHTMLEtiquetaConteo(a, b, plan, ubiTeoA, ubiTeoB, false);
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Etiqueta Cruce Conteo - ${a.cod} / ${b.cod}</title>
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

function generarHTMLEtiquetaConteo(a, b, plan, ubiTeoA, ubiTeoB, preview){
  const now = new Date().toLocaleString('es-CO');
  const stepsHtml = plan.map((s,i)=>`
    <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;padding:7px;border:1px solid #ddd;border-radius:4px;background:${s.urgencia==='urgent'?'#fff5f5':s.urgencia==='ok'?'#f0fff4':s.urgencia==='info'?'#f0f5ff':'#fff'}">
      <div style="width:20px;height:20px;border-radius:50%;background:${s.urgencia==='urgent'?'#c0392b':s.urgencia==='ok'?'#27ae60':'#5577bb'};color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;color:#111;margin-bottom:2px">${s.icono||''} ${s.accion}${s.cantidad>0?` (${s.cantidad} und.)`:''}</div>
        <div style="font-size:9px;color:#555">${s.detalle.replace(/<[^>]*>/g,'')}</div>
      </div>
    </div>`).join('');

  const fisA = a.fisico!==undefined&&a.fisico!==null?` · Físico: ${a.fisico}`:'';
  const fisB = b.fisico!==undefined&&b.fisico!==null?` · Físico: ${b.fisico}`:'';

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:380px;padding:${preview?'8px':'0'}">
      <div style="background:#c0392b;color:#fff;padding:8px 12px;border-radius:6px 6px 0 0;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:9px;letter-spacing:.18em;text-transform:uppercase;opacity:.8">Toyota · Control UBI · Conteo</div>
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
            <div style="font-size:9px;color:#c0392b">📍 Ubi: ${a.ubi||'?'}</div>
            <div style="font-size:9px;font-weight:700">Sist: ${a.stock}${fisA}</div>
          </div>
          <div style="background:#fef9e7;border:1px solid #f0d68a;border-radius:4px;padding:8px">
            <div style="font-size:8px;color:#555;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px">REF B</div>
            <div style="font-size:12px;font-weight:700;color:#7d3c00">${b.cod}</div>
            <div style="font-size:9px;color:#333;margin:2px 0">${(b.desc||'').slice(0,40)}</div>
            <div style="font-size:9px;color:#c0392b">📍 Ubi: ${b.ubi||'?'}</div>
            <div style="font-size:9px;font-weight:700">Sist: ${b.stock}${fisB}</div>
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

// Init store from localStorage on page load
// Nota: la carga de CONTEO_STORE ahora ocurre en hydrateUserCloudData(),
// después de autenticar, para que cada usuario recupere su propio estado.

export { abrirImpresionEtiquetaConteo, calcularCruceDesdeConteo, imprimirEtiquetaCruceConteo, limpiarCruceTray, toggleConteoSelCruce, updateCruceTraySlot };
