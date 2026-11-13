import { goTab } from './ui-header-tabs.js';
import { jsAttrSafe } from './utils.js';
// ═══ js/etiquetas.js — extraído de index.html (líneas 19072–19858 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ═══════════════════════════════════════════════════════════════════════════
// ██████████████  MÓDULO ETIQUETAS  ██████████████
// Integrado directamente en new.html (Opción A).
// Lee INV y PRICES del sistema principal cuando ya están cargados,
// pero funciona también con catálogo propio si aún no hay Excel.
//
// Fuente combustible: Toyota Colombia oficial + concesionarios verificados
// Fuente specs: PDF GS-Yuasa For_General_passenger_cars + fotos reales almacén
// ═══════════════════════════════════════════════════════════════════════════

// ── CATÁLOGO DE BATERÍAS ─────────────────────────────────────────────────
// comb: 'GAS'=Gasolina, 'DSL'=Diesel, 'HEV'=Híbrido, 'MIX'=ambos según versión
// Fuente combustible verificada en toyota.com.co / yokomotor.com.co / autoamerica.com.co
let ETQ_BAT_CAT = {
  // YUASA JIS
  '2880080D3L': { desc:'BATERÍA YUASA Y5-80D23L', aplic:'Corolla Gas / RAV4 Gas',
    v:'12', ah:'67', cca:'520', tipo:'SMF', marca:'YUASA', modelo:'Y5-80D23L',
    tipo_caja:'D23L', comb:'GAS', _src:'foto+GS-Yuasa' },
  '2880080D26L':{ desc:'BATERÍA YUASA 95D26L', aplic:'4Runner / Fortuner Gas / Prado 150 Gas',
    v:'12', ah:'72', cca:'600', tipo:'SMF', marca:'YUASA', modelo:'95D26L',
    tipo_caja:'D26L', comb:'GAS', _src:'foto+GS-Yuasa' },
  '28800574HL': { desc:'BATERÍA YUASA 57412', aplic:'Fortuner Diesel / Hilux 4x4 DSL',
    v:'12', ah:'74', cca:'700', tipo:'SMF', marca:'YUASA', modelo:'57412',
    tipo_caja:'DIN74', comb:'DSL', _src:'GS-Yuasa' },
  '28800115D3': { desc:'BATERÍA YUASA 105D31L', aplic:'Prado 150/250 Diesel / LC78',
    v:'12', ah:'92', cca:'700', tipo:'SMF', marca:'YUASA', modelo:'105D31L',
    tipo_caja:'D31L', comb:'DSL', _src:'GS-Yuasa' },
  // YUASA LN
  '2880038B24': { desc:'BATERÍA YUASA Y6-390LN4', aplic:'LC300 Diesel / Prado 250 Diesel',
    v:'12', ah:'80', cca:'740', tipo:'SMF', marca:'YUASA', modelo:'Y6-390LN4',
    tipo_caja:'LN4', comb:'DSL', _src:'foto+doc' },
  '2880038B23': { desc:'BATERÍA YUASA Y6-380LN3', aplic:'LC300 Gas / Prado 250 Gas',
    v:'12', ah:'70', cca:'650', tipo:'SMF', marca:'YUASA', modelo:'Y6-380LN3',
    tipo_caja:'LN3', comb:'GAS', _src:'doc' },
  '2880038B40': { desc:'BATERÍA YUASA Y6-340LN0', aplic:'Yaris Cross HEV',
    v:'12', ah:'32', cca:'300', tipo:'SMF', marca:'YUASA', modelo:'Y6-340LN0',
    tipo_caja:'LN0', comb:'HEV', _src:'doc' },
  '2880038B42': { desc:'BATERÍA YUASA Y6-375LN2', aplic:'Corolla Cross Gas / Hilux Gas',
    v:'12', ah:'60', cca:'540', tipo:'SMF', marca:'YUASA', modelo:'Y6-375LN2',
    tipo_caja:'LN2', comb:'GAS', _src:'lista-precios' },
  '2880038B44': { desc:'BATERÍA YUASA Y6-355LN1 EFB', aplic:'Corolla Cross HEV / Yaris HB CVT',
    v:'12', ah:'50', cca:'480', tipo:'EFB', marca:'YUASA', modelo:'Y6-355LN1',
    tipo_caja:'LN1', comb:'HEV', _src:'req-tecnico' },
  '2880044H1L': { desc:'BATERÍA YUASA 54459', aplic:'Corolla Cross Gas / Yaris / Yaris HB',
    v:'12', ah:'44', cca:'420', tipo:'SMF', marca:'YUASA', modelo:'54459',
    tipo_caja:'LN1', comb:'GAS', _src:'foto+GS-Yuasa' },
  '2880056H2L': { desc:'BATERÍA YUASA 56216', aplic:'Hilux 2017+ Gas 2.7 / SW4 4x4',
    v:'12', ah:'62', cca:'540', tipo:'SMF', marca:'YUASA', modelo:'56216',
    tipo_caja:'LN2', comb:'GAS', _src:'doc' },
  // HELLA
  '2880000201': { desc:'BATERÍA HELLA L1 EFB', aplic:'Corolla Cross / Yaris HB CVT / GR-S',
    v:'12', ah:'50', cca:'430', tipo:'EFB', marca:'HELLA', modelo:'EFB-L1',
    tipo_caja:'LN1', comb:'HEV', _src:'doc+lista-precios' },
  '2880000351': { desc:'BATERÍA HELLA 55 800/56219', aplic:'Hilux 4x4 Gas 2.7 / Fortuner SRV Gas',
    v:'12', ah:'55', cca:'560', tipo:'XCELERATE', marca:'HELLA', modelo:'56219-13',
    tipo_caja:'LN2', comb:'GAS', _src:'doc' },
  '2880000671': { desc:'BATERÍA HELLA 48 1050/57820', aplic:'Hilux DC 4x4 Diesel / Fortuner SRV DSL',
    v:'12', ah:'70', cca:'750', tipo:'XCELERATE', marca:'HELLA', modelo:'57820-15',
    tipo_caja:'LN4', comb:'DSL', _src:'doc' },
  '2880000141': { desc:'BATERÍA HELLA NS60 450L-14', aplic:'Varios NS60',
    v:'12', ah:'35', cca:'450', tipo:'XCELERATE', marca:'HELLA', modelo:'NS60 450L-14',
    tipo_caja:'NS60', comb:'GAS', _src:'doc' },
  '2880000781': { desc:'BATERÍA HELLA 650L (35/780)', aplic:'Varios',
    v:'12', ah:'35', cca:'450', tipo:'XCELERATE', marca:'HELLA', modelo:'450L',
    tipo_caja:'NS60', comb:'GAS', _src:'doc' },
  '2880001081': { desc:'BATERÍA HELLA 27 1200/900L-17', aplic:'Land Cruiser 79 / LC300',
    v:'12', ah:'90', cca:'900', tipo:'XCELERATE', marca:'HELLA', modelo:'900L-17',
    tipo_caja:'D31L', comb:'DSL', _src:'doc' },
  '2880001191': { desc:'BATERÍA HELLA 24 1100/700L-16', aplic:'Land Cruiser 79 / FJ Cruiser',
    v:'12', ah:'83', cca:'700', tipo:'XCELERATE', marca:'HELLA', modelo:'700L-16',
    tipo_caja:'D26L', comb:'GAS', _src:'doc' },
  '2880038B22': { desc:'BATERÍA HELLA EFB-L4', aplic:'LC300 Diesel / Prado 250 Diesel',
    v:'12', ah:'70', cca:'680', tipo:'EFB', marca:'HELLA', modelo:'EFB-L4',
    tipo_caja:'LN4', comb:'DSL', _src:'doc' },
  '2880038B21': { desc:'BATERÍA HELLA AGM-L30', aplic:'LC300 Gas / Prado 250 Gas TX',
    v:'12', ah:'80', cca:'800', tipo:'AGM', marca:'HELLA', modelo:'AGM-L30',
    tipo_caja:'LN3', comb:'GAS', _src:'doc' },
  '2880038B27': { desc:'BATERÍA HELLA AGM-L4', aplic:'Tundra 4x4 V6 3.4 AT',
    v:'12', ah:'80', cca:'800', tipo:'AGM', marca:'HELLA', modelo:'AGM-L4',
    tipo_caja:'LN4', comb:'GAS', _src:'doc' },
  '2880038B41': { desc:'BATERÍA HELLA 54018-LN0', aplic:'Yaris Cross XLS HEV',
    v:'12', ah:'40', cca:'350', tipo:'XCELERATE', marca:'HELLA', modelo:'54018-8',
    tipo_caja:'LN0', comb:'HEV', _src:'doc' },
  '2880001193': { desc:'BATERÍA HELLA 700L-16', aplic:'FJ Cruiser / Prado 150 Gas V6',
    v:'12', ah:'83', cca:'700', tipo:'XCELERATE', marca:'HELLA', modelo:'700L-16',
    tipo_caja:'D26L', comb:'GAS', _src:'doc' },
};
const ETQ_BAT_CAT_BASE = JSON.parse(JSON.stringify(ETQ_BAT_CAT));

// KITS DE CARRETERA — datos corregidos por el equipo (26/08/2026)
const ETQ_KIT_CAT = {
  'B0001KC044': { desc:'KIT CARRETERA UNIVERSAL', aplic:'Universal',
    items:['Extintor','Botiquín de primeros auxilios','Chaleco reflectante y guantes','Linterna y herramientas','Tacos (×2)','Conos reflectivos (×2)','Maletín Toyota'] },
  'B080KBL540': { desc:'KIT CARRETERA HILUX', aplic:'HILUX',
    items:['Extintor','Tacos (×2)','Linterna y guantes','Conos reflectivos (×2)','Botiquín de primeros auxilios','Herramientas','Chaleco reflectivo','Maletín Toyota'] },
};

// LLANTAS
const ETQ_LLANTA_CAT = {
  '084326565R17':{ desc:'LLANTA 265/65R17', aplic:'Hilux / Fortuner',ancho:265,perfil:65,aro:17,ic:112,vel:'S',tipo:'OE Toyota' },
  '084422550R18':{ desc:'LLANTA 225/50R18', aplic:'Corolla Cross',   ancho:225,perfil:50,aro:18,ic:99, vel:'V',tipo:'OE Toyota' },
};

// ── CORRECCIONES (localStorage) ────────────────────────────────────────────
const ETQ_LS='toyota_etq_correcciones_v1';
function etqLoadCorr(){ try{return JSON.parse(localStorage.getItem(ETQ_LS)||'[]');}catch{return[];} }
function etqSaveCorr(a){ localStorage.setItem(ETQ_LS,JSON.stringify(a)); }
function etqApplyCorr(){
  const base=JSON.parse(JSON.stringify(ETQ_BAT_CAT_BASE));
  etqLoadCorr().forEach(c=>{
    if(c.tipo==='mod'&&c.ref&&c.campo&&c.valor&&base[c.ref]) base[c.ref][c.campo]=c.valor;
    if(c.tipo==='new'&&c.ref&&c.datos&&!base[c.ref]) base[c.ref]=Object.assign({},c.datos);
  });
  Object.assign(ETQ_BAT_CAT,base);
}
etqApplyCorr();

function etqGetSust(ref){
  return etqLoadCorr().filter(c=>(c.tipo==='sust'||c.tipo==='alt')&&(c.ref===ref||c.ref2===ref))
    .map(c=>({ ref: c.ref===ref?c.ref2:c.ref, tipo:c.tipo, nota:c.nota||'' }));
}

// ── UTILS ─────────────────────────────────────────────────────────────────
function etqEsc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function etqToday(){ return new Date().toISOString().split('T')[0]; }
function etqFmtDate(d){
  if(!d) return '—';
  if(typeof d==='string'&&d.length>=10){const[y,m,da]=d.split('-');return`${da}/${m}/${y}`;}
  return String(d);
}
function etqFmtMesAno(d){
  if(!d) return '—';
  if(typeof d==='string'&&d.length>=7){const[y,m]=d.split('-');return`${m}/${y}`;}
  return String(d);
}
function etqTipoCol(t){ return {AGM:'#9b59b6',EFB:'#2980b9',SMF:'#27ae60',XCELERATE:'#c0392b'}[t]||'#666'; }
function etqCombLabel(c){
  return {GAS:'⛽ GASOLINA',DSL:'🔵 DIESEL',HEV:'⚡ HÍBRIDO',MIX:'⛽/🔵 GAS ó DSL'}[c]||'';
}
function etqCombClass(c){ return {GAS:'gas',DSL:'dsl',HEV:'hev',MIX:'mix'}[c]||'gas'; }

// ── SUB-TABS ──────────────────────────────────────────────────────────────
const ETQ_SUB_IDS=['bat','kit','llanta','equiv','correc'];
function etqGoSub(id){
  document.querySelectorAll('#panel-etiquetas .etq-tab').forEach((t,i)=>
    t.classList.toggle('on',ETQ_SUB_IDS[i]===id));
  document.querySelectorAll('#panel-etiquetas .etq-sub').forEach(s=>s.classList.remove('on'));
  const sub=document.getElementById('etqsub-'+id);
  if(sub) sub.classList.add('on');
  if(id==='equiv') etqEquivRenderAll();
  if(id==='correc') etqEdRenderList();
}

// ── BATERÍAS ──────────────────────────────────────────────────────────────
let ETQ_BAT_ROWS=[];

function etqBatOptions(){
  return Object.entries(ETQ_BAT_CAT).sort((a,b)=>a[0].localeCompare(b[0])).map(([ref,d])=>
    `<option value="${etqEsc(ref)}">${etqEsc(ref)} — ${etqEsc(d.desc)}</option>`).join('');
}

function etqBatAddRow(ref='',qty=1){
  const id='ebr'+Date.now()+Math.random().toString(36).slice(2,5);
  ETQ_BAT_ROWS.push(id);
  const wrap=document.getElementById('etq-bat-queue');
  const div=document.createElement('div');
  div.className='etq-row'; div.id=id;
  div.innerHTML=`
    <select style="flex:2;min-width:200px" id="${id}-ref" onchange="etqBatRefChange('${jsAttrSafe(id)}')">
      <option value="">— Seleccionar referencia —</option>${etqBatOptions()}
    </select>
    <span class="qty-lbl">CANT.</span>
    <input type="number" id="${id}-qty" min="1" max="500" value="${qty}" style="width:62px">
    <span id="${id}-info" class="etq-info-chip"></span>
    <button class="etq-del" onclick="etqBatDelRow('${jsAttrSafe(id)}')">×</button>`;
  wrap.appendChild(div);
  if(ref){ document.getElementById(`${id}-ref`).value=ref; etqBatRefChange(id); }
}

function etqBatRefChange(id){
  const ref=document.getElementById(`${id}-ref`)?.value;
  const el=document.getElementById(`${id}-info`);
  if(!el) return;
  const d=ref?ETQ_BAT_CAT[ref]:null;
  if(d) el.textContent=`${d.ah}Ah · ${d.cca}A · ${d.tipo_caja||'—'} · ${etqCombLabel(d.comb)}`;
  else el.textContent='';
}

function etqBatDelRow(id){
  document.getElementById(id)?.remove();
  ETQ_BAT_ROWS=ETQ_BAT_ROWS.filter(r=>r!==id);
}

function etqBatGenerar(){
  const fecha=document.getElementById('etq-bat-fecha').value||etqToday();
  const obs=document.getElementById('etq-bat-obs').value.trim();
  const showEquiv=document.getElementById('etq-bat-showequiv').value==='1';
  const area=document.getElementById('etq-bat-preview');
  area.innerHTML=''; let total=0;
  ETQ_BAT_ROWS.forEach(id=>{
    const ref=document.getElementById(`${id}-ref`)?.value;
    const qty=parseInt(document.getElementById(`${id}-qty`)?.value)||1;
    if(!ref) return;
    const d=ETQ_BAT_CAT[ref]; if(!d) return;
    for(let i=0;i<qty;i++){ area.innerHTML+=etqBatLabelHTML(ref,d,fecha,obs,showEquiv); total++; }
  });
  if(!total){ area.innerHTML='<div class="empty"><div class="ei">🔋</div><div class="em">Agrega al menos una referencia</div></div>'; return; }
  const chip=document.getElementById('etq-bat-count');
  chip.style.display=''; chip.textContent=`✓ ${total} etiqueta${total!==1?'s':''} lista${total!==1?'s':''}`;
}

function etqBatLimpiar(){
  ETQ_BAT_ROWS=[];
  document.getElementById('etq-bat-queue').innerHTML='';
  document.getElementById('etq-bat-preview').innerHTML='';
  document.getElementById('etq-bat-count').style.display='none';
}

function etqBatLabelHTML(ref,d,fecha,obs,showEquiv){
  const tc=etqTipoCol(d.tipo);
  const combCls=etqCombClass(d.comb);
  const combLbl=etqCombLabel(d.comb);
  // Equivalencias de caja
  const equivArr=showEquiv&&d.tipo_caja
    ? Object.entries(ETQ_BAT_CAT).filter(([r,x])=>x.tipo_caja===d.tipo_caja&&r!==ref).slice(0,3)
    : [];
  const equivLine=equivArr.length
    ? `<div class="etq-equiv">🔄 Equiv.: ${equivArr.map(([r])=>etqEsc(r)).join(' · ')}</div>` : '';
  // Sustitutos marcados manualmente
  const sust=etqGetSust(ref).filter(s=>s.tipo==='sust').slice(0,2);
  const sustLine=sust.length
    ? `<div class="etq-equiv" style="background:#fff8e0;color:#8a5000;border-color:#f0d080">⚡ Sust.: ${sust.map(s=>etqEsc(s.ref)).join(' · ')}</div>` : '';
  const obsLine=obs?`<div class="etq-obs" style="padding:4px 12px;background:#fffde0;font-size:9px;font-weight:700;color:#8a5000;border-top:1px solid #f0e080;text-transform:uppercase">${etqEsc(obs)}</div>`:'';
  return `<div class="etq-lbl-wrap"><div class="etq-lbl etq-bat">
    <div class="etq-lbl-hdr">
      <div class="etq-t-logo">T</div>
      <div class="etq-t-brand">${etqEsc(d.marca)}</div>
      <div class="etq-t-type" style="background:${tc}33;color:${tc}">${etqEsc(d.tipo)}</div>
    </div>
    <div class="etq-cod">${etqEsc(ref)}</div>
    <div class="etq-desc">${etqEsc(d.desc)}</div>
    <div class="etq-specs">
      <div class="etq-spec-cell"><div class="etq-sl">Volt.</div><div class="etq-sv">${etqEsc(d.v)}V</div></div>
      <div class="etq-spec-cell"><div class="etq-sl">Capac.</div><div class="etq-sv blue">${etqEsc(d.ah)} Ah</div></div>
      <div class="etq-spec-cell"><div class="etq-sl">CCA SAE</div><div class="etq-sv red">${etqEsc(d.cca)} A</div></div>
      <div class="etq-spec-cell"><div class="etq-sl">Caja</div><div class="etq-sv grn" style="font-size:13px">${etqEsc(d.tipo_caja||'—')}</div></div>
    </div>
    <div class="etq-aplic">📍 ${etqEsc(d.aplic)}</div>
    ${combLbl?`<div class="etq-comb ${combCls}">${combLbl}</div>`:''}
    ${obsLine}${equivLine}${sustLine}
    <div class="etq-fecha">
      <span>Llegada: <span class="v">${etqFmtDate(fecha)}</span></span>
      <span style="color:rgba(255,255,255,.3)">${etqEsc(d.modelo)}</span>
    </div>
  </div></div>`;
}

// ── KITS ──────────────────────────────────────────────────────────────────
let ETQ_KIT_ROWS=[];
function etqKitOptions(){ return Object.entries(ETQ_KIT_CAT).map(([ref,d])=>`<option value="${etqEsc(ref)}">${etqEsc(ref)} — ${etqEsc(d.desc)}</option>`).join(''); }
function etqKitAddRow(ref='',qty=1){
  const id='ekr'+Date.now()+Math.random().toString(36).slice(2,5);
  ETQ_KIT_ROWS.push(id);
  const wrap=document.getElementById('etq-kit-queue');
  const div=document.createElement('div'); div.className='etq-row'; div.id=id;
  div.innerHTML=`<select style="flex:2;min-width:200px" id="${id}-ref"><option value="">— Seleccionar kit —</option>${etqKitOptions()}</select>
    <span class="qty-lbl">CANT.</span>
    <input type="number" id="${id}-qty" min="1" max="500" value="${qty}" style="width:62px">
    <button class="etq-del" onclick="etqKitDelRow('${jsAttrSafe(id)}')">×</button>`;
  wrap.appendChild(div);
  if(ref) document.getElementById(`${id}-ref`).value=ref;
}
function etqKitDelRow(id){ document.getElementById(id)?.remove(); ETQ_KIT_ROWS=ETQ_KIT_ROWS.filter(r=>r!==id); }
function etqKitGenerar(){
  const fecha=document.getElementById('etq-kit-fecha').value||etqToday();
  const venc=document.getElementById('etq-kit-venc').value;
  const area=document.getElementById('etq-kit-preview'); area.innerHTML=''; let total=0;
  ETQ_KIT_ROWS.forEach(id=>{
    const ref=document.getElementById(`${id}-ref`)?.value;
    const qty=parseInt(document.getElementById(`${id}-qty`)?.value)||1;
    if(!ref) return; const d=ETQ_KIT_CAT[ref]; if(!d) return;
    for(let i=0;i<qty;i++){ area.innerHTML+=etqKitLabelHTML(ref,d,fecha,venc); total++; }
  });
  if(!total){ area.innerHTML='<div class="empty"><div class="ei">🧰</div><div class="em">Agrega al menos un kit</div></div>'; return; }
  const chip=document.getElementById('etq-kit-count'); chip.style.display=''; chip.textContent=`✓ ${total} etiqueta${total!==1?'s':''}`;
}
function etqKitLimpiar(){ ETQ_KIT_ROWS=[]; document.getElementById('etq-kit-queue').innerHTML=''; document.getElementById('etq-kit-preview').innerHTML=''; document.getElementById('etq-kit-count').style.display='none'; }
// Medidor de presión del extintor — leyenda de los 3 estados posibles
// (Descargado/Cargado/Sobrecargado), como en el kit físico. Se recrea en
// SVG vectorial (no como imagen) para que salga nítido a cualquier tamaño
// y no gaste tinta de más al imprimir: el aro y la aguja son solo trazo
// negro, y el único color real son las 3 cuñas rojo/verde/rojo — ahí SÍ
// hace falta el color porque es literalmente lo que el medidor comunica
// (rojo=fuera de rango, verde=correcto), así que esta pieza queda exenta
// de la regla "todo negro puro" del resto de la etiqueta al imprimir.
function etqGaugeSVG(kind){
  const tip={desc:[22.48,37],ok:[45,24],sobre:[67.52,37]}[kind];
  return `<svg viewBox="0 0 90 55" width="100%" style="display:block;print-color-adjust:exact;-webkit-print-color-adjust:exact">
    <path d="M45,50 L15,50 A30,30 0 0,1 30,24.02 Z" fill="#e74c3c" stroke="#000" stroke-width="1"/>
    <path d="M45,50 L30,24.02 A30,30 0 0,1 60,24.02 Z" fill="#2ecc71" stroke="#000" stroke-width="1"/>
    <path d="M45,50 L60,24.02 A30,30 0 0,1 75,50 Z" fill="#e74c3c" stroke="#000" stroke-width="1"/>
    <line x1="15" y1="50" x2="75" y2="50" stroke="#000" stroke-width="1.5"/>
    <line x1="45" y1="50" x2="${tip[0]}" y2="${tip[1]}" stroke="#111" stroke-width="3" stroke-linecap="round"/>
    <circle cx="45" cy="50" r="4" fill="#111" stroke="#000" stroke-width="1"/>
  </svg>`;
}
// Checkbox — se dibuja en los 3 estados por igual (efecto "se revisaron los
// 3"), pero solo el de Cargado llega marcado (efecto "y se determinó que
// este es el estado actual"). Vacío = solo trazo negro, casi sin tinta;
// marcado = mismo verde que la cuña "Cargado" del medidor, para que se lea
// de un vistazo cuál de los tres quedó seleccionado.
function etqCheckboxSVG(checked){
  return `<svg viewBox="0 0 14 14" width="12" height="12" style="display:block;print-color-adjust:exact;-webkit-print-color-adjust:exact">
    <rect x="1" y="1" width="12" height="12" rx="2.5" fill="${checked?'#1a7a3c':'#fff'}" stroke="#000" stroke-width="1.3"/>
    ${checked?'<path d="M3.5,7.2 L6,9.7 L10.5,4.2" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>':''}
  </svg>`;
}
function etqGaugeItem(kind,label){
  const checked=kind==='ok';
  return `<div style="width:72px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:3px">
    ${etqGaugeSVG(kind)}
    <div style="font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.02em;color:#333;text-align:center;line-height:1.15">${label}</div>
    ${etqCheckboxSVG(checked)}
  </div>`;
}
function etqMedicionRow(){
  return `<div class="etq-medicion">
    <div class="etq-medicion-title">📟 Medición extintor</div>
    <div style="display:flex;justify-content:center;gap:12px;padding:2px 10px 8px">
      ${etqGaugeItem('desc','Descargado')}
      ${etqGaugeItem('ok','Cargado')}
      ${etqGaugeItem('sobre','Sobrecargado')}
    </div>
  </div>`;
}
function etqKitLabelHTML(ref,d,fecha,venc){
  return `<div class="etq-lbl-wrap"><div class="etq-lbl etq-kit">
    <div class="etq-lbl-hdr"><div class="etq-t-logo">T</div><div class="etq-t-brand">KIT CARRETERA</div><div class="etq-t-type" style="background:rgba(34,212,212,.12);color:#22d4d4">Toyota OEM</div></div>
    <div class="etq-cod">${etqEsc(ref)}</div>
    <div class="etq-desc">${etqEsc(d.desc)}</div>
    <div class="etq-kit-body">
      ${(d.items||[]).map(it=>`<div class="etq-kit-row"><span class="etq-kit-k">${etqEsc(it)}</span><span class="etq-kit-v">✓</span></div>`).join('')}
      <div class="etq-kit-row"><span class="etq-kit-k">Aplicabilidad</span><span class="etq-kit-v">${etqEsc(d.aplic)}</span></div>
    </div>
    ${etqMedicionRow()}
    <div class="etq-fecha">
      <span>Llegada: <span class="v">${etqFmtDate(fecha)}</span></span>
      ${venc?`<span>Vence: <span class="v">${etqFmtMesAno(venc)}</span></span>`:''}
    </div>
  </div></div>`;
}

// ── LLANTAS ────────────────────────────────────────────────────────────────
let ETQ_LLANTA_ROWS=[];
function etqLlantaOptions(){ return Object.entries(ETQ_LLANTA_CAT).map(([ref,d])=>`<option value="${etqEsc(ref)}">${etqEsc(ref)} — ${etqEsc(d.desc)}</option>`).join(''); }
function etqLlantaAddRow(ref='',qty=1){
  const id='elr'+Date.now()+Math.random().toString(36).slice(2,5);
  ETQ_LLANTA_ROWS.push(id);
  const wrap=document.getElementById('etq-llanta-queue');
  const div=document.createElement('div'); div.className='etq-row'; div.id=id;
  div.innerHTML=`<select style="flex:2;min-width:200px" id="${id}-ref"><option value="">— Seleccionar llanta —</option>${etqLlantaOptions()}</select>
    <span class="qty-lbl">CANT.</span>
    <input type="number" id="${id}-qty" min="1" max="500" value="${qty}" style="width:62px">
    <button class="etq-del" onclick="etqLlantaDelRow('${jsAttrSafe(id)}')">×</button>`;
  wrap.appendChild(div);
  if(ref) document.getElementById(`${id}-ref`).value=ref;
}
function etqLlantaDelRow(id){ document.getElementById(id)?.remove(); ETQ_LLANTA_ROWS=ETQ_LLANTA_ROWS.filter(r=>r!==id); }
function etqLlantaGenerar(){
  const fecha=document.getElementById('etq-llanta-fecha').value||etqToday();
  const area=document.getElementById('etq-llanta-preview'); area.innerHTML=''; let total=0;
  ETQ_LLANTA_ROWS.forEach(id=>{
    const ref=document.getElementById(`${id}-ref`)?.value;
    const qty=parseInt(document.getElementById(`${id}-qty`)?.value)||1;
    if(!ref) return; const d=ETQ_LLANTA_CAT[ref]; if(!d) return;
    for(let i=0;i<qty;i++){ area.innerHTML+=etqLlantaLabelHTML(ref,d,fecha); total++; }
  });
  if(!total){ area.innerHTML='<div class="empty"><div class="ei">🔵</div><div class="em">Agrega al menos una llanta</div></div>'; return; }
  const chip=document.getElementById('etq-llanta-count'); chip.style.display=''; chip.textContent=`✓ ${total} etiqueta${total!==1?'s':''}`;
}
function etqLlantaLimpiar(){ ETQ_LLANTA_ROWS=[]; document.getElementById('etq-llanta-queue').innerHTML=''; document.getElementById('etq-llanta-preview').innerHTML=''; document.getElementById('etq-llanta-count').style.display='none'; }
function etqLlantaLabelHTML(ref,d,fecha){
  return `<div class="etq-lbl-wrap"><div class="etq-lbl etq-llanta">
    <div class="etq-lbl-hdr"><div class="etq-t-logo">T</div><div class="etq-t-brand">LLANTA OEM</div>
      <div class="etq-t-type" style="background:rgba(31,199,106,.15);color:#1fc76a">${etqEsc(d.tipo)}</div></div>
    <div class="etq-cod">${etqEsc(ref)}</div>
    <div class="etq-desc">${etqEsc(d.desc)}</div>
    <div class="etq-ll-specs">
      <div class="etq-spec-cell"><div class="etq-sl">Ancho</div><div class="etq-sv">${d.ancho}mm</div></div>
      <div class="etq-spec-cell"><div class="etq-sl">Perfil</div><div class="etq-sv">${d.perfil}%</div></div>
      <div class="etq-spec-cell"><div class="etq-sl">Aro</div><div class="etq-sv grn">R${d.aro}</div></div>
      <div class="etq-spec-cell"><div class="etq-sl">Carga/Vel</div><div class="etq-sv">${d.ic}${d.vel}</div></div>
    </div>
    <div class="etq-aplic" style="background:#f0fdf4;font-size:9px;padding:5px 12px;color:#555;font-weight:700">📍 ${etqEsc(d.aplic)}</div>
    <div class="etq-fecha"><span>Llegada: <span class="v">${etqFmtDate(fecha)}</span></span></div>
  </div></div>`;
}

// ── IMPRESIÓN ──────────────────────────────────────────────────────────────
// El motor de impresión global de la app oculta TODO hijo directo de <body>
// (@media print → body>*{display:none!important}) y solo deja visible
// #rptPrintArea, que vive fuera de #appShell justo para esto (ver nota al
// final del archivo, junto al div #rptPrintArea). Como #panel-etiquetas está
// DENTRO de #appShell, llamar a window.print() directo desde ahí imprimía
// una hoja en blanco: por más display:flex!important que se le pusiera al
// preview, su ancestro #appShell seguía oculto y ningún hijo puede
// "reaparecer" si el padre está en display:none. Por eso, en vez de imprimir
// el panel en sitio, clonamos el contenido ya generado dentro de
// #rptPrintArea (las clases .etq-lbl/.etq-lbl-wrap siguen tomando su CSS del
// <style> global, así que no hace falta reinyectar estilos) y recién ahí
// llamamos a window.print().
function etqPrint(previewId){
  const src=document.getElementById(previewId);
  if(!src||!src.innerHTML.trim()){ alert('Genera al menos una etiqueta antes de imprimir.'); return; }
  const area=document.getElementById('rptPrintArea');
  if(area.parentElement!==document.body) document.body.appendChild(area);
  // Hoja de corte estilo imprenta: etiquetas pegadas, sin márgenes, con marcas
  // de corte en los bordes de la hoja (ver CSS .etq-sheet / .etq-k).
  // 2 columnas para todos los tipos (con 3 los kits se apretaban y cortaban texto).
  const labels=[...src.querySelectorAll(':scope > .etq-lbl-wrap')];
  if(!labels.length){ alert('Genera al menos una etiqueta antes de imprimir.'); return; }
  const cols=2;
  const kH=(side)=>`<i class="etq-k etq-k-h etq-k-h${side}"></i>`;
  // Fila de marcas verticales (arriba = thead, abajo = tfoot): una raya en el
  // borde izquierdo de cada columna y otra en el borde derecho de la última.
  let edge='',edgeFoot='';
  for(let c=0;c<cols;c++){
    const v='<i class="etq-k etq-k-v etq-k-vl"></i>'+(c===cols-1?'<i class="etq-k etq-k-v etq-k-vr"></i>':'');
    edge+=`<td class="etq-edge">${v}</td>`;
    // en el tfoot además van las rayas horizontales que cierran la última fila
    edgeFoot+=`<td class="etq-edge">${v}${c===0?kH('l'):''}${c===cols-1?kH('r'):''}</td>`;
  }
  let rows='';
  for(let i=0;i<labels.length;i+=cols){
    let tds='';
    for(let j=0;j<cols;j++){
      const l=labels[i+j];
      const marks=(j===0?kH('l'):'')+(j===cols-1?kH('r'):'');
      tds+=l?`<td class="etq-c">${marks}${l.outerHTML}</td>`:`<td class="etq-c">${marks}</td>`;
    }
    rows+=`<tr>${tds}</tr>`;
  }
  area.innerHTML=`<div class="etq-sheet-hint">✂ Cortar por las marcas del margen (centro de la línea negra): primero horizontales, luego verticales.</div>
    <div class="etq-sheet-wrap"><table class="etq-sheet${previewId==='etq-kit-preview'?' etq-sheet--kit':''}">
      <thead><tr>${edge}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>${edgeFoot}</tr></tfoot>
    </table></div>`;
  area.style.display='block';
  setTimeout(()=>{
    window.print();
    setTimeout(()=>{ area.innerHTML=''; area.style.display='none'; },500);
  },120);
}

// ── EQUIVALENCIAS ──────────────────────────────────────────────────────────
function etqGetEquivGroup(tipo_caja){
  return Object.entries(ETQ_BAT_CAT).filter(([,d])=>d.tipo_caja===tipo_caja).map(([ref,d])=>({ref,d}));
}
function etqEquivSearch(raw){
  const q=(raw||'').trim().toUpperCase();
  const el=document.getElementById('etq-equiv-result');
  if(!q){el.innerHTML='';return;}
  let ref=null,d=null;
  if(ETQ_BAT_CAT[q]){ref=q;d=ETQ_BAT_CAT[q];}
  else{
    const entry=Object.entries(ETQ_BAT_CAT).find(([r,x])=>
      r.toUpperCase()===q||(x.modelo&&x.modelo.toUpperCase().includes(q))||x.tipo_caja===q);
    if(entry){[ref,d]=entry;}
  }
  // búsqueda directa por tipo_caja
  const directGroup=d?etqGetEquivGroup(d.tipo_caja):
    (Object.values(ETQ_BAT_CAT).some(x=>x.tipo_caja===q)?etqGetEquivGroup(q):null);
  const cajaNombre=d?d.tipo_caja:q;
  if(!directGroup||!directGroup.length){
    el.innerHTML=`<div class="alert ae" style="margin:10px 0">Sin resultados para "${etqEsc(q)}"</div>`;return;
  }
  el.innerHTML=etqEquivGroupHTML(cajaNombre,directGroup,ref);
}
function etqEquivGroupHTML(caja,grupo,selfRef){
  const cards=grupo.map(({ref,d})=>{
    const isSelf=ref===selfRef;
    const tc=etqTipoCol(d.tipo);
    return `<div class="etq-equiv-card${isSelf?' self':''}">
      <div style="font-family:var(--mono);font-size:11px;color:var(--text);font-weight:700">${etqEsc(ref)}</div>
      <div style="font-size:9px;color:var(--text2);margin-top:2px">${etqEsc(d.marca)} · ${etqEsc(d.modelo)}</div>
      <div style="font-size:8.5px;color:var(--text3)">${etqEsc(d.aplic)}</div>
      <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">
        <span style="font-size:7.5px;padding:2px 5px;border-radius:3px;background:${tc}22;color:${tc};border:1px solid ${tc}44">${etqEsc(d.tipo)}</span>
        <span style="font-size:7.5px;padding:2px 5px;border-radius:3px;background:var(--bg3);color:var(--text3);border:1px solid var(--border)">${etqEsc(d.ah)}Ah · ${etqEsc(d.cca)}A · ${etqCombLabel(d.comb)}</span>
        ${isSelf?'<span style="font-size:7.5px;padding:2px 5px;border-radius:3px;background:rgba(34,212,212,.15);color:var(--cyan);border:1px solid rgba(34,212,212,.3)">↑ BUSCADA</span>':''}
      </div>
    </div>`;
  }).join('');
  return `<div class="sbox"><div class="slbl">Tipo de caja: <span style="color:var(--cyan)">${etqEsc(caja)}</span>
    <span class="etq-badge etq-badge-alt" style="margin-left:6px">${grupo.length} ref${grupo.length!==1?'s':''} intercambiables</span></div>
    <div style="color:var(--text3);font-size:9px;margin-bottom:10px;font-family:var(--mono)">
      Mismo largo, ancho, alto y posición de bornes — 100% intercambiables físicamente.</div>
    <div class="etq-equiv-group">${cards}</div>
  </div>`;
}
function etqEquivClear(){ document.getElementById('etq-equiv-q').value=''; document.getElementById('etq-equiv-result').innerHTML=''; }
function etqEquivRenderAll(){
  const groups={};
  Object.entries(ETQ_BAT_CAT).forEach(([ref,d])=>{
    if(!d.tipo_caja) return;
    if(!groups[d.tipo_caja]) groups[d.tipo_caja]=[];
    groups[d.tipo_caja].push({ref,d});
  });
  const el=document.getElementById('etq-equiv-all');
  if(!el) return;
  el.innerHTML=Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([caja,arr])=>`
    <div style="margin-bottom:12px">
      <div style="font-family:var(--mono);font-size:9px;color:var(--cyan);margin-bottom:6px;
                  letter-spacing:.1em;display:flex;align-items:center;gap:8px">
        📦 ${etqEsc(caja)}
        <span class="etq-badge etq-badge-alt">${arr.length} ref${arr.length!==1?'s':''}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${arr.map(({ref,d})=>`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:5px;
            padding:5px 9px;font-family:var(--mono);cursor:pointer"
            onclick="document.getElementById('etq-equiv-q').value='${jsAttrSafe(ref)}';etqEquivSearch('${jsAttrSafe(ref)}')">
          <div style="font-size:9.5px;color:var(--text);font-weight:700">${etqEsc(ref)}</div>
          <div style="font-size:7.5px;color:var(--text3)">${etqEsc(d.marca)} · ${etqEsc(d.tipo)}</div>
        </div>`).join('')}
      </div>
    </div>`).join('');
}

// ── CORRECCIONES ───────────────────────────────────────────────────────────
function etqEdTipoChange(){
  const tipo=document.getElementById('etq-ed-tipo').value;
  const ref=document.getElementById('etq-ed-ref').value.trim().toUpperCase();
  const d=ETQ_BAT_CAT[ref];
  const el=document.getElementById('etq-ed-campos');
  const inp='height:34px;background:rgba(0,0,0,.28);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-family:var(--mono);font-size:10px;padding:0 10px;';
  if(tipo==='mod'){
    el.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div style="display:flex;flex-direction:column;gap:3px">
        <span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Campo a modificar</span>
        <select id="etq-ed-campo" style="${inp}">
          <option value="desc">Descripción</option><option value="aplic">Aplicabilidad</option>
          <option value="ah">Ah</option><option value="cca">CCA</option>
          <option value="tipo">Tipo (SMF/EFB/AGM/XCELERATE)</option>
          <option value="modelo">Modelo comercial</option>
          <option value="tipo_caja">Tipo de caja</option><option value="comb">Combustible (GAS/DSL/HEV)</option>
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:140px">
        <span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Nuevo valor</span>
        <input type="text" id="etq-ed-valor" placeholder="Valor correcto" style="${inp}width:100%">
      </div>
    </div>
    ${d?`<div style="margin-top:6px;font-family:var(--mono);font-size:9px;padding:5px 8px;border-radius:4px;background:rgba(34,212,212,.08);color:var(--cyan)">
      Actual → Ah: ${d.ah} · CCA: ${d.cca} · Caja: ${d.tipo_caja||'—'} · Comb: ${d.comb||'—'}
    </div>`:'<div style="margin-top:6px;font-family:var(--mono);font-size:9px;color:var(--amber)">⚠ Ref no encontrada en catálogo base</div>'}`;
  } else if(tipo==='sust'||tipo==='alt'){
    el.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:140px">
        <span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">${tipo==='sust'?'Sustituta de':'Alternativa de'}</span>
        <input type="text" id="etq-ed-ref2" placeholder="Otra ref Toyota" style="${inp}width:100%">
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;flex:2;min-width:160px">
        <span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Nota (opcional)</span>
        <input type="text" id="etq-ed-nota" placeholder="Ej: usar si no hay stock" style="${inp}width:100%">
      </div>
    </div>`;
  } else if(tipo==='new'){
    el.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div style="display:flex;flex-direction:column;gap:3px;flex:2"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Descripción</span><input type="text" id="etq-ed-new-desc" placeholder="BATERÍA YUASA…" style="${inp}width:100%"></div>
      <div style="display:flex;flex-direction:column;gap:3px;flex:2"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Aplicabilidad</span><input type="text" id="etq-ed-new-aplic" style="${inp}width:100%"></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">
      <div style="display:flex;flex-direction:column;gap:3px"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Marca</span><select id="etq-ed-new-marca" style="${inp}"><option>YUASA</option><option>HELLA</option></select></div>
      <div style="display:flex;flex-direction:column;gap:3px"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Tipo</span><select id="etq-ed-new-tipo" style="${inp}"><option>SMF</option><option>EFB</option><option>AGM</option><option>XCELERATE</option></select></div>
      <div style="display:flex;flex-direction:column;gap:3px"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Modelo</span><input type="text" id="etq-ed-new-modelo" style="${inp}width:100px"></div>
      <div style="display:flex;flex-direction:column;gap:3px"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Caja</span><input type="text" id="etq-ed-new-caja" style="${inp}width:70px"></div>
      <div style="display:flex;flex-direction:column;gap:3px"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Comb.</span><select id="etq-ed-new-comb" style="${inp}"><option value="GAS">GAS</option><option value="DSL">DSL</option><option value="HEV">HEV</option><option value="MIX">MIX</option></select></div>
      <div style="display:flex;flex-direction:column;gap:3px"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Ah</span><input type="number" id="etq-ed-new-ah" style="${inp}width:65px"></div>
      <div style="display:flex;flex-direction:column;gap:3px"><span style="font-family:var(--mono);font-size:8px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">CCA</span><input type="number" id="etq-ed-new-cca" style="${inp}width:75px"></div>
    </div>`;
  }
}
function etqEdRefChange(){ if(document.getElementById('etq-ed-tipo').value==='mod') etqEdTipoChange(); }
function etqEdGuardar(){
  const tipo=document.getElementById('etq-ed-tipo').value;
  const ref=document.getElementById('etq-ed-ref').value.trim().toUpperCase();
  const msg=document.getElementById('etq-ed-msg');
  if(!ref){msg.textContent='❌ Escribe una referencia';msg.style.color='var(--red)';return;}
  const corrs=etqLoadCorr();
  let c={id:Date.now(),ts:new Date().toISOString(),tipo,ref};
  if(tipo==='mod'){
    const campo=document.getElementById('etq-ed-campo')?.value;
    const valor=document.getElementById('etq-ed-valor')?.value.trim();
    if(!campo||!valor){msg.textContent='❌ Completa campo y valor';return;}
    c={...c,campo,valor};
  } else if(tipo==='sust'||tipo==='alt'){
    const ref2=document.getElementById('etq-ed-ref2')?.value.trim().toUpperCase();
    const nota=document.getElementById('etq-ed-nota')?.value.trim();
    if(!ref2){msg.textContent='❌ Especifica la otra referencia';return;}
    c={...c,ref2,nota};
  } else if(tipo==='new'){
    const datos={
      desc:document.getElementById('etq-ed-new-desc')?.value.trim(),
      aplic:document.getElementById('etq-ed-new-aplic')?.value.trim(),
      marca:document.getElementById('etq-ed-new-marca')?.value,
      tipo:document.getElementById('etq-ed-new-tipo')?.value,
      modelo:document.getElementById('etq-ed-new-modelo')?.value.trim(),
      tipo_caja:(document.getElementById('etq-ed-new-caja')?.value||'').trim().toUpperCase(),
      comb:document.getElementById('etq-ed-new-comb')?.value||'GAS',
      v:'12',ah:document.getElementById('etq-ed-new-ah')?.value,
      cca:document.getElementById('etq-ed-new-cca')?.value,_src:'corrección-manual',
    };
    if(!datos.desc){msg.textContent='❌ La descripción es obligatoria';return;}
    c={...c,datos};
  }
  corrs.push(c); etqSaveCorr(corrs); etqApplyCorr(); etqEdRenderList(); etqEdLimpiarForm();
  msg.textContent='✅ Guardado'; msg.style.color='var(--green)';
  setTimeout(()=>{msg.textContent='';},2500);
}
function etqEdLimpiarForm(){
  document.getElementById('etq-ed-ref').value='';
  document.getElementById('etq-ed-tipo').value='mod';
  document.getElementById('etq-ed-campos').innerHTML='';
}
function etqEdRenderList(){
  const corrs=etqLoadCorr();
  const el=document.getElementById('etq-ed-list');
  if(!el) return;
  if(!corrs.length){el.innerHTML='<div class="empty" style="padding:16px"><div class="em" style="font-size:11px">Sin correcciones guardadas</div></div>';return;}
  const bMap={mod:'etq-badge-mod',sust:'etq-badge-sust',alt:'etq-badge-alt',new:'etq-badge-new'};
  const lMap={mod:'Modificación',sust:'Sustituta',alt:'Alternativa',new:'Ref nueva'};
  el.innerHTML=corrs.slice().reverse().map(c=>{
    let det='';
    if(c.tipo==='mod') det=`<b>${etqEsc(c.campo)}</b> → "${etqEsc(c.valor)}"`;
    else if(c.tipo==='sust'||c.tipo==='alt') det=`↔ <b>${etqEsc(c.ref2)}</b>${c.nota?' — '+etqEsc(c.nota):''}`;
    else if(c.tipo==='new') det=etqEsc(c.datos?.desc||'');
    return `<div class="etq-ed-row">
      <div style="flex:0 0 auto;display:flex;flex-direction:column;gap:4px">
        <span class="etq-badge ${bMap[c.tipo]||''}">${lMap[c.tipo]||c.tipo}</span>
        <span style="font-family:var(--mono);font-size:8px;color:var(--text3)">${etqEsc(c.ts?.slice(0,10)||'')}</span>
      </div>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text);font-weight:700;flex:0 0 auto">${etqEsc(c.ref)}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text2);flex:1">${det}</span>
      <button class="etq-del" onclick="etqEdBorrar(${c.id})" title="Eliminar">×</button>
    </div>`;
  }).join('');
}
function etqEdBorrar(id){ etqSaveCorr(etqLoadCorr().filter(c=>c.id!==id)); etqApplyCorr(); etqEdRenderList(); }
function etqEdLimpiarTodo(){ if(!confirm('¿Borrar TODAS las correcciones?')) return; etqSaveCorr([]); etqApplyCorr(); etqEdRenderList(); }
function etqEdExportar(){
  const blob=new Blob([JSON.stringify(etqLoadCorr(),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`correcciones-etiquetas-${etqToday()}.json`; a.click();
}
function etqEdImportar(){
  const input=document.createElement('input'); input.type='file'; input.accept='.json';
  input.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(!Array.isArray(data)) throw new Error('Formato inválido');
        const ex=etqLoadCorr();
        const merged=[...ex,...data.filter(n=>!ex.some(e=>e.id===n.id))];
        etqSaveCorr(merged); etqApplyCorr(); etqEdRenderList();
        alert(`✅ ${data.length} correcciones importadas`);
      }catch(err){alert('❌ Error: '+err.message);}
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── FAB "Buscar todo" — arrastrable ─────────────────────────────────────
// En pantallas angostas este flotador (izquierda) puede quedar pegado al
// flotador de selección (derecha, .pickfab) y estorbar. Se puede arrastrar
// (mouse o touch) a cualquier posición libre; se guarda en localStorage y
// se re-acomoda solo si la pantalla cambia de tamaño (rotación, etc.) para
// que nunca quede fuera de la vista ni tapado.
(function initCpaFabDrag(){
  const KEY='cpaFabPos';
  function clampPos(x,y,el){
    const w=el.offsetWidth,h=el.offsetHeight;
    const maxX=Math.max(6,window.innerWidth-w-6);
    const maxY=Math.max(6,window.innerHeight-h-6);
    return [Math.min(Math.max(x,6),maxX), Math.min(Math.max(y,6),maxY)];
  }
  function applyPos(el,x,y){
    el.style.left=x+'px'; el.style.top=y+'px';
    el.style.right='auto'; el.style.bottom='auto';
  }
  function setup(){
    const el=document.getElementById('cpaFab');
    if(!el) return;
    let hasCustomPos=false;
    try{
      const saved=JSON.parse(localStorage.getItem(KEY)||'null');
      if(saved&&typeof saved.x==='number'&&typeof saved.y==='number'){
        const[x,y]=clampPos(saved.x,saved.y,el);
        applyPos(el,x,y);
        hasCustomPos=true;
      }
    }catch(e){}
    let dragging=false, moved=false, startX=0, startY=0, origX=0, origY=0;
    function onDown(e){
      const p=e.touches?e.touches[0]:e;
      dragging=true; moved=false;
      startX=p.clientX; startY=p.clientY;
      const r=el.getBoundingClientRect();
      origX=r.left; origY=r.top;
      el.classList.add('dragging');
    }
    function onMove(e){
      if(!dragging) return;
      const p=e.touches?e.touches[0]:e;
      const dx=p.clientX-startX, dy=p.clientY-startY;
      if(Math.abs(dx)>4||Math.abs(dy)>4) moved=true;
      if(!moved) return;
      if(e.cancelable) e.preventDefault();
      const[x,y]=clampPos(origX+dx,origY+dy,el);
      applyPos(el,x,y);
    }
    function onUp(){
      if(!dragging) return;
      dragging=false;
      el.classList.remove('dragging');
      if(moved){
        const r=el.getBoundingClientRect();
        try{ localStorage.setItem(KEY, JSON.stringify({x:r.left,y:r.top})); }catch(e){}
        el.dataset.justDragged='1'; // evita que el click al soltar abra la paleta
        hasCustomPos=true;
      }
    }
    el.addEventListener('mousedown',onDown);
    el.addEventListener('touchstart',onDown,{passive:true});
    document.addEventListener('mousemove',onMove);
    document.addEventListener('touchmove',onMove,{passive:false});
    document.addEventListener('mouseup',onUp);
    document.addEventListener('touchend',onUp);
    el.addEventListener('dblclick',()=>{
      el.style.left=''; el.style.top=''; el.style.right=''; el.style.bottom='';
      try{ localStorage.removeItem(KEY); }catch(e){}
      hasCustomPos=false;
    });
    window.addEventListener('resize',()=>{
      if(!hasCustomPos) return; // posición por defecto (CSS) — no tocar
      const r=el.getBoundingClientRect();
      const[x,y]=clampPos(r.left,r.top,el);
      applyPos(el,x,y);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',setup);
  else setup();
})();

// ── INIT ETIQUETAS (cuando se entra al panel) ──────────────────────────────
// Las filas iniciales se crean la primera vez que el usuario abre el sub-tab,
// para no gastar DOM antes de que se necesite.
let _etqInited={bat:false,kit:false,llanta:false};
const _etqOrigGoTab=typeof goTab==='function'?goTab:null;
// Hook: interceptar cuando se activa 'etiquetas' para inicializar filas vacías
document.addEventListener('DOMContentLoaded',()=>{
  // pre-rellenar fechas de hoy cuando el panel se abre
  const initEtqDates=()=>{
    const today=etqToday();
    ['etq-bat-fecha','etq-kit-fecha','etq-llanta-fecha'].forEach(id=>{
      const el=document.getElementById(id); if(el&&!el.value) el.value=today;
    });
    if(!_etqInited.bat){ etqBatAddRow(); _etqInited.bat=true; }
    if(!_etqInited.kit){ etqKitAddRow(); _etqInited.kit=true; }
    if(!_etqInited.llanta){ etqLlantaAddRow(); _etqInited.llanta=true; }
    etqEdTipoChange();
  };
  // Observar cuando el panel-etiquetas se hace visible
  const obs=new MutationObserver(muts=>{
    muts.forEach(m=>{
      if(m.target.id==='panel-etiquetas'&&m.target.classList.contains('active')){
        initEtqDates();
      }
    });
  });
  const panelEl=document.getElementById('panel-etiquetas');
  if(panelEl) obs.observe(panelEl,{attributes:true,attributeFilter:['class']});
});

export { etqBatAddRow, etqBatDelRow, etqBatGenerar, etqBatLimpiar, etqBatRefChange, etqEdBorrar, etqEdExportar, etqEdGuardar, etqEdImportar, etqEdLimpiarForm, etqEdLimpiarTodo, etqEdRefChange, etqEdTipoChange, etqEquivClear, etqEquivSearch, etqGoSub, etqKitAddRow, etqKitDelRow, etqKitGenerar, etqKitLimpiar, etqLlantaAddRow, etqLlantaDelRow, etqLlantaGenerar, etqLlantaLimpiar, etqPrint };
