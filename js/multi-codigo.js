import { INV, PICKLIST } from './state-globals.js';
import { getPriceRow, normCode } from './file-upload.js';
import { getBusListPrice } from './precios-divisor.js';
import { cop, escHtml, jsAttrSafe, pickKeyFromItem, pickSave, renderPickUI, setAlert, togglePick } from './utils.js';
// ═══ js/multi-codigo.js — extraído de index.html (líneas 13933–14137 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== MULTI-CÓDIGO =====================
let mcResults_data = {}; // { code: [rows] | 'NOT_FOUND' }
let mcPartialCodes = new Set(); // códigos resueltos por coincidencia parcial (no exacta)
let mcFilter = 'all';

function mcParseCodes(raw){
  return [...new Set(
    raw.split(/[\n,;\t]+/)
      .map(s=>normCode(s))
      .filter(s=>s.length>2)
  )];
}
function mcUpdateCount(){
  const raw = document.getElementById('mcInput').value;
  const n = raw.trim() ? mcParseCodes(raw).length : 0;
  document.getElementById('mcCountHint').textContent = n+' código'+(n===1?'':'s')+' detectado'+(n===1?'':'s');
}
async function mcPasteClipboard(){
  try{
    const text = await navigator.clipboard.readText();
    if(!text) return;
    const ta = document.getElementById('mcInput');
    ta.value = ta.value.trim() ? ta.value.replace(/\n*$/,'\n')+text : text;
    mcUpdateCount();
  }catch(e){
    alert('No se pudo leer el portapapeles. Puedes pegar manualmente con Ctrl+V dentro del cuadro.');
  }
}
function mcLoadFile(input){
  const file = input.files && input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e=>{
    const ta = document.getElementById('mcInput');
    ta.value = String(e.target.result||'');
    mcUpdateCount();
  };
  reader.onerror = ()=>alert('No se pudo leer el archivo.');
  reader.readAsText(file);
  input.value='';
}

function doMultiCod(){
  const raw = document.getElementById('mcInput').value;
  if(!raw.trim()){clearMultiCod();return;}
  if(!INV.length){setAlert('bAlert','ae',true,'⚠️ Carga un Excel primero');return;}

  const codes = mcParseCodes(raw);

  // Índice código→filas, construido una sola vez (rápido incluso con listas grandes)
  const byCode = new Map();
  for(const r of INV){
    const k = normCode(r[0]);
    if(!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(r);
  }

  mcResults_data = {};
  mcPartialCodes = new Set();
  let found=0, notFound=0, valorTotal=0;

  codes.forEach(code=>{
    let rows = byCode.get(code);
    if(!rows||!rows.length){
      // Fallback: coincidencia parcial (solo si el código pegado es razonablemente específico)
      if(code.length>=4){
        rows = INV.filter(r=>normCode(r[0]).includes(code));
        if(rows.length) mcPartialCodes.add(code);
      }
    }
    if(rows&&rows.length){
      mcResults_data[code]=rows; found++;
      const pr=getPriceRow(rows[0][0]);
      // Usar MOSTRADOR_SIN_DCTO / ACCESORIOS_SIN_DCTO según grupo (r[6]),
      // no el primer tipo de precio que haya en el Excel (pr[0] crudo).
      const ep=pr?getBusListPrice(pr,rows[0][6]):null;
      if(ep!=null) valorTotal += ep*1.19*rows.reduce((a,r)=>a+(r[2]>0?r[2]:0),0);
    } else { mcResults_data[code]='NOT_FOUND'; notFound++; }
  });

  document.getElementById('mcStatBar').style.display='flex';
  document.getElementById('mcTotBuscados').textContent = codes.length;
  document.getElementById('mcEncontrados').textContent = found;
  document.getElementById('mcNoEncontrados').textContent = notFound;
  document.getElementById('mcValorTotal').textContent = cop(valorTotal);
  document.getElementById('mcAddAllBtn').style.display = found>0?'':'none';
  document.getElementById('mcExportBtn').style.display = codes.length>0?'':'none';
  document.getElementById('mcCopyNFBtn').style.display = notFound>0?'':'none';
  document.getElementById('mcFilterRow').style.display = codes.length>0?'':'none';
  mcFilter='all'; updateMcFilterButtons();

  let html='';
  Object.entries(mcResults_data).forEach(([code, val])=>{
    if(val==='NOT_FOUND'){
      html+=`<div class="mc-group" data-status="notfound">
        <div class="mc-group-hdr" style="background:var(--red2);border-bottom-color:rgba(232,64,64,.25)">
          <div class="mc-group-code" style="color:var(--red)">${escHtml(code)}<button class="pcpy-sm" type="button" onclick="copyCode('${jsAttrSafe(code)}',this)" title="Copiar código">⎘</button></div>
          <span class="mc-group-meta" style="color:var(--red)">❌ No encontrado</span>
        </div>
      </div>`;
      return;
    }
    const totalStock = val.reduce((a,r)=>a+r[2],0);
    const ubis = [...new Set(val.map(r=>r[3]).filter(u=>u&&u!=='Sin Ubicacion'))];
    const pr = getPriceRow(val[0][0]);
    // MOSTRADOR_SIN_DCTO / ACCESORIOS_SIN_DCTO según grupo — igual que el Buscador principal
    const effPrice = pr ? getBusListPrice(pr, val[0][6]) : null;
    const priceStr = effPrice!=null ? cop(effPrice*1.19) : '—';
    const isPartial = mcPartialCodes.has(code);
    html+=`<div class="mc-group" data-status="found">
      <div class="mc-group-hdr">
        <div class="mc-group-left">
          <div class="mc-group-code">${escHtml(val[0][0])}<button class="pcpy-sm" type="button" onclick="copyCode('${jsAttrSafe(val[0][0])}',this)" title="Copiar código">⎘</button></div>
          <div class="mc-group-meta">${escHtml(val[0][1]||'—')}</div>
          ${isPartial?`<span class="chip" style="padding:2px 7px;color:var(--amber2);border-color:rgba(212,52,30,.35)" title="No hubo coincidencia exacta para '${escHtml(code)}'; se muestra la coincidencia parcial más cercana">≈ parcial</span>`:''}
        </div>
        <div class="mc-group-right">
          <span class="chip g" style="padding:3px 9px">Stock: <span class="n">${totalStock}</span></span>
          <span class="chip" style="padding:3px 9px;color:var(--cyan)">${ubis.length?ubis.join(', '):'Sin ubi'}</span>
          ${effPrice!=null?`<span class="chip" style="padding:3px 9px;color:var(--gold2)">${priceStr}</span>`:''}
          <button class="cpbtn" onclick="diagBuscar('${jsAttrSafe(val[0][0])}')" title="Ver en el buscador" style="font-size:11px;padding:2px 7px">🔍</button>
          <button class="cpbtn" onclick="addMcToPick('${jsAttrSafe(code)}')" title="Agregar al tray" style="font-size:11px;padding:2px 7px;border-color:var(--green);color:var(--green)">＋</button>
        </div>
      </div>
      ${val.length>1?`<div class="tscr" style="max-height:180px"><table style="width:100%"><thead><tr>
        <th class="nosort" style="border-top:none">#</th>
        <th style="border-top:none">Ubicación</th>
        <th style="border-top:none">Stock</th>
        <th style="border-top:none">ABC</th>
      </tr></thead><tbody>${val.map((r,i)=>`<tr><td style="color:var(--text3);font-size:9px">${i+1}</td><td style="color:var(--cyan);font-family:var(--mono);font-size:10px">${r[3]||'—'}</td><td class="tnum ${r[2]>0?'pos':'zero'}">${r[2]}</td><td>${r[4]?`<span class="badge b${r[4]}">${r[4]}</span>`:''}</td></tr>`).join('')}</tbody></table></div>`:''}
    </div>`;
  });
  document.getElementById('mcResults').innerHTML = html || '<div class="mc-empty-hint">Sin resultados.</div>';
}

function updateMcFilterButtons(){
  ['all','found','notfound'].forEach(f=>{
    const btn=document.getElementById('mcf-'+f);
    if(btn) btn.classList.toggle('on', f===mcFilter);
  });
}
function mcSetFilter(f){
  mcFilter=f;
  updateMcFilterButtons();
  document.querySelectorAll('#mcResults .mc-group').forEach(el=>{
    const st=el.dataset.status;
    el.style.display = (f==='all'||f===st) ? '' : 'none';
  });
}

function mcCopyNotFound(){
  const codes = Object.entries(mcResults_data).filter(([,v])=>v==='NOT_FOUND').map(([k])=>k);
  if(!codes.length) return;
  const text = codes.join('\n');
  navigator.clipboard.writeText(text).then(()=>{
    const btn=document.getElementById('mcCopyNFBtn');
    if(btn){const old=btn.textContent;btn.textContent='¡Copiado!';setTimeout(()=>btn.textContent=old,1400);}
  }).catch(()=>{
    const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');}catch(e){}
    ta.remove();
  });
}

function addMcToPick(code){
  const rows = mcResults_data[code];
  if(!rows||rows==='NOT_FOUND')return;
  rows.forEach(r=>{
    const pr=getPriceRow(r[0]);
    const ep=pr?getBusListPrice(pr,r[6]):null;
    togglePick({cod:r[0],desc:r[1],stock:r[2],ubi:r[3],price:ep},null);
  });
}

function addAllMultiToPick(){
  Object.entries(mcResults_data).forEach(([code,val])=>{
    if(val==='NOT_FOUND')return;
    val.forEach(r=>{
      const pr=getPriceRow(r[0]);
      const ep=pr?getBusListPrice(pr,r[6]):null;
      const key=pickKeyFromItem({cod:r[0],ubi:r[3],desc:r[1]});
      if(!PICKLIST.has(key)){
        PICKLIST.set(key,{cod:r[0],desc:r[1],stock:r[2],ubi:r[3],price:ep});
      }
    });
  });
  pickSave();renderPickUI();
  const btn=document.getElementById('mcAddAllBtn');
  if(btn){const old=btn.textContent;btn.textContent='¡Agregados!';btn.style.color='var(--green)';setTimeout(()=>{btn.textContent=old;},1200);}
}

function clearMultiCod(){
  document.getElementById('mcInput').value='';
  document.getElementById('mcStatBar').style.display='none';
  document.getElementById('mcFilterRow').style.display='none';
  document.getElementById('mcResults').innerHTML='';
  document.getElementById('mcAddAllBtn').style.display='none';
  document.getElementById('mcExportBtn').style.display='none';
  document.getElementById('mcCopyNFBtn').style.display='none';
  document.getElementById('mcCountHint').textContent='0 códigos detectados';
  mcResults_data={};
  mcPartialCodes=new Set();
  mcFilter='all';
}

export { addAllMultiToPick, addMcToPick, clearMultiCod, doMultiCod, mcCopyNotFound, mcLoadFile, mcPartialCodes, mcPasteClipboard, mcResults_data, mcSetFilter, mcUpdateCount };
