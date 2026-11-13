import { ESTANTES, INV, INV_IDX, KAIZEN_EXT, NOSTOCK_UBI, UBI2_MAP, UBI_PERFIL_MAP, UBI_TEO, _diagSinTeo, diagABC, set__diagSinTeo } from './state-globals.js';
import { getPriceRow, normCode } from './file-upload.js';
import { goTab, pushNavState } from './ui-header-tabs.js';
import { doSearch, setBM } from './buscador.js';
import { cp, escHtml, fmt, jsAttrSafe } from './utils.js';
import { UMBRAL_COMPRA_RECIENTE_DIAS, calcFlujo, calcGA, calcLiberacion, calcRegularidad } from './diagnostico-dpok.js';
import { openRelocModal, renderRelocShelves } from './cambio-ubicacion.js';
// ═══ js/sugerido-max.js — extraído de index.html (líneas 13132–13932 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════
// SUGERIDO DE PEDIDO — MAX-MAX con demanda robusta
// ══════════════════════════════════════════════════════════════════
// Reposición periódica (order-up-to) con los parámetros del modal MAX-MAX:
//   MIP  = demanda/día × (O/C + L/T + S/S)            ← nivel máximo
//   ROP  = demanda/día × (L/T + S/S)                  ← nivel de reorden
//   POS  = O/H + O/O − B/O                            ← posición de inventario
//   Se pide SOLO si POS ≤ ROP, y la cantidad es  SOQ = MIP − POS  (entero).
//
// Qué lo hace preciso (y no un número inflado):
//  1) DEMANDA/DÍA = mediana de tres lecturas independientes: MAD robusto (prom.
//     6 meses con picos puntuales atenuados), promedio ponderado 60/40
//     (últimos 3 meses pesan más → ya recoge la tendencia) y DAD del SQL.
//     En refs en FASE de entrada no se cuentan los meses anteriores a su
//     primera venta (esos ceros no son demanda).
//  2) Se descuenta lo que ya hay y lo que ya viene: O/H + O/O − B/O.
//  3) No se pide lo que no tiene sentido: FASE de salida, sin ventas en los
//     últimos 3 meses, baja rotación o stock aún dentro de la banda. Las refs
//     GA=NO con stock bajo y ventas recientes no se piden solas: van a una lista
//     aparte (sin cantidad) para decidirlas a mano.
//  4) NO se usan Stock_Min, Stock_Max, Stock_Seguridad ni MIP del SQL (traen
//     valores incorrectos y disparaban pedidos absurdos) ni Sugerido_1 (es un
//     precio). Todo sale de ventas M1-M6, DAD, stock y los parámetros del modal.
const _med=a=>{ if(!a.length) return 0; const v=[...a].sort((x,y)=>x-y), m=Math.floor(v.length/2); return v.length%2?v[m]:(v[m-1]+v[m])/2; };
const _avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;

// Demanda mensual robusta a partir de M1 (más reciente) … M6.
function calcDemandaRobusta(meses, faseIn){
  const m=[0,1,2,3,4,5].map(i=>Math.max(0,Number(meses?.[i])||0)); // devoluciones netas no restan demanda
  let n=6;
  if(faseIn){ // ref nueva: contar solo desde su primera venta
    let oldest=-1; for(let i=5;i>=0;i--) if(m[i]>0){oldest=i;break;}
    if(oldest>=0) n=oldest+1;
  }
  const act=m.slice(0,n);
  const nz=act.filter(v=>v>0);
  let w=act.slice(), spikes=0;
  if(nz.length>=3){
    // Pico puntual = mes > 2.5× la mediana Y rodeado de meses normales (un salto
    // sostenido o una rampa NO se atenúan: son demanda real).
    const med=_med(nz);
    w=act.map((v,i)=>{
      const vecinos=[act[i-1],act[i+1]].filter(x=>x!==undefined);
      if(v>2.5*med && vecinos.every(x=>x<=1.5*med)){ spikes++; return 2*med; }
      return v;
    });
  }
  const mad=_avg(w);
  const rec=w.slice(0,Math.min(3,n)), ant=w.slice(3);
  const wma=ant.length?0.6*_avg(rec)+0.4*_avg(ant):_avg(rec);
  return {mad,wma,nActivos:n,spikes};
}

// invRowHint: si el caller ya tiene la fila de INV, pásala para no buscarla de nuevo.
// Devuelve null (sin datos) | {soq:0, excluida:'MOTIVO'} | sugerencia completa.
function calcSOQ(cod, oc, lt, ss, invRowHint){
  const ext    = KAIZEN_EXT[cod] ?? KAIZEN_EXT[normCode(cod)];
  const invRow = invRowHint!==undefined ? invRowHint : INV_IDX.get(normCode(cod));
  if(!ext || !invRow || !ext.meses) return null;

  const faseIn=ext.fase_in===1, faseOut=ext.fase_out===1;
  const fr=ext.fr||0;
  const flujo=calcFlujo(ext.meses);
  const regularidad=calcRegularidad(ext.meses);

  // ── Filtros: no todo lo que se vendió alguna vez se debe reponer ──
  if(faseOut) return {soq:0,excluida:'FASE_OUT'};
  if(flujo.frReciente===0) return {soq:0,excluida:'SIN_VENTA_RECIENTE'};            // nada en los últimos 3 meses
  if(!faseIn && (fr<=1 || (fr===2 && !regularidad.regular))) return {soq:0,excluida:'BAJA_ROTACION'};
  const gaInfo=calcGA(cod); // GA=NO se aplica más abajo, cuando ya se sabe si la ref necesita reposición

  // ── Demanda por día ──
  const dem=calcDemandaRobusta(ext.meses,faseIn);
  const cand=[dem.mad/30, dem.wma/30, ext.dad||0].filter(v=>v>0);
  if(!cand.length) return {soq:0,excluida:'SIN_DEMANDA'};
  const d=_med(cand);
  const spread=cand.length>1?(Math.max(...cand)-Math.min(...cand))/d:0;

  // ── Posición vs. niveles MAX-MAX ──
  const oh=Math.max(0,invRow[2]||0), oo=Math.max(0,ext.oo||0), bo=Math.max(0,ext.bo||0);
  const pos=oh+oo-bo;
  const T=oc+lt+ss, mip=d*T, rop=d*(lt+ss);
  const cobertura=Math.max(0,pos)/d;
  if(pos>rop) return {soq:0,excluida:'EN_BANDA'};
  const soq=Math.ceil(mip-pos-1e-9);
  if(soq<1) return {soq:0,excluida:'EN_BANDA'};

  // La Guía de Abastecimiento dice que esta ref no debe tener stock (GA=NO) pero hoy está
  // por debajo del nivel de reorden y vendió en los últimos 3 meses: no se pide sola, se
  // deja en una lista aparte (sin cantidad) para que la decida una persona.
  if(gaInfo.ga==='NO') return {soq:0,excluida:'GA_NO',fueraGuia:{oh,oo,bo,pos,cobertura,d,fr,flujo,faseIn,ga:gaInfo.ga,gaMotivo:gaInfo.motivo}};

  // CRÍTICO: se agota antes de que llegue el pedido — solo para refs de venta recurrente (FR≥4) o nuevas en FASE
  // de entrada; una ref de rotación lenta sin stock se repone, pero no es una urgencia.
  const prioridad=((pos<=0||cobertura<lt)&&(fr>=4||faseIn))?'CRITICO':'REPONER';
  const confianza=(fr>=5&&spread<=0.35&&dem.spikes===0)?'ALTA':(fr>=3&&spread<=0.8)?'MEDIA':'BAJA';

  const motivos=[];
  if(oh<=0) motivos.push('Sin stock');
  if(pos>0) motivos.push(`Alcanza ${cobertura.toFixed(1)} d · se repone a ${lt+ss} d`);
  if(oo>0) motivos.push(`${Math.round(oo)} en camino`);
  if(bo>0) motivos.push(`B/O ${Math.round(bo)}`);
  if(flujo.trend==='SUBIENDO') motivos.push(`Demanda subiendo ${Math.round(flujo.deltaPct)}%`);
  if(flujo.trend==='BAJANDO')  motivos.push(`Demanda bajando ${Math.round(Math.abs(flujo.deltaPct))}%`);
  if(dem.spikes) motivos.push(`${dem.spikes} pico puntual atenuado`);
  if(cand.length>1 && spread>0.6) motivos.push('MAD y DAD del SQL discrepan: se usó la mediana');
  if(faseIn) motivos.push('FASE de entrada');
  const dUC=ext.dias_ult_compra;
  if(typeof dUC==='number' && dUC>=0 && dUC<=lt && oo===0) motivos.push(`⚠ Compra hace ${dUC} d: verifica si ya viene en camino`);

  return {
    soq, prioridad, confianza, motivos, excluida:null,
    oh, oo, bo, pos, cobertura, d, mip, rop, T,
    fuentes:{mad:dem.mad/30, wma:dem.wma/30, dad:ext.dad||0},
    madMonthly:dem.mad, spikes:dem.spikes,
    fr, flujo, faseIn, faseOut,
    ga:gaInfo.ga, gaMotivo:gaInfo.motivo,
  };
}

function copiarListaPedidos(){
  const oc=parseInt(document.getElementById('diagOC')?.value)||7;
  const lt=parseInt(document.getElementById('diagLT')?.value)||1;
  const ss=parseInt(document.getElementById('diagSS')?.value)||7;
  const rows=INV.reduce((acc,r)=>{
    const abc=(r[4]||'').toUpperCase();
    if(diagABC!=='ALL'&&abc!==diagABC)return acc;
    const s=calcSOQ(r[0],oc,lt,ss,r);
    if(s&&s.soq>0)acc.push(`${r[0]}\t${r[1]||''}\t${r[4]||''}\t${s.soq}\t${s.prioridad==='CRITICO'?'CRÍTICO':'REPONER'}\t${s.cobertura.toFixed(1)}`);
    return acc;
  },[]);
  if(!rows.length){alert('No hay pedidos sugeridos con los parámetros actuales.');return;}
  const txt='CÓDIGO\tDESCRIPCIÓN\tABC\tSOQ\tPRIORIDAD\tCOBERTURA (DÍAS)\n'+rows.join('\n');
  navigator.clipboard.writeText(txt).then(()=>{
    const btn=document.getElementById('diagCopyBtn');
    if(btn){btn.textContent='✅ Copiado';setTimeout(()=>{btn.textContent='📋 Copiar lista';},2000);}
  }).catch(()=>alert(txt));
}

function openDiagParamsModal(){
  document.getElementById('diagParamsOverlay').classList.add('on');
}
function closeDiagParamsModal(){
  document.getElementById('diagParamsOverlay').classList.remove('on');
}
// El botón que abre el modal muestra los 3 valores actuales — así no hace
// falta abrirlo solo para recordar qué está configurado.
function updateDiagParamsSummary(){
  const btn=document.getElementById('diagParamsBtn');
  if(!btn) return;
  const oc=document.getElementById('diagOC')?.value||'—';
  const lt=document.getElementById('diagLT')?.value||'—';
  const ss=document.getElementById('diagSS')?.value||'—';
  btn.textContent=`⚙️ MAX-MAX · O/C ${oc} · L/T ${lt} · S/S ${ss}`;
}

function runDiagnostico(){
  updateDiagParamsSummary(); // mantiene el botón sincronizado sin importar desde dónde se llame
  if(!INV.length){
    document.getElementById('diagCards').innerHTML='<div style="font-family:var(--mono);font-size:11px;color:var(--text3);padding:16px 0">Carga un Excel para generar el diagnóstico.</div>';
    document.getElementById('diagSections').innerHTML='';
    return;
  }

  // ── 2. UBICACIONES OCUPADAS CON STOCK = 0 ──────────────────────
  const ocu0 = NOSTOCK_UBI.length ? NOSTOCK_UBI : INV.filter(r=>r[2]===0 && r[3] && r[3]!=='Sin Ubicacion');

  // ── 2b. UBICACIONES DEL SQL QUE NO ESTÁN EN UBITEORICAS ────────
  // Cruza las ubicaciones que trae el SQL (la principal y, si viene, la 2ª de
  // "A12 B03") contra la hoja UBITEORICAS del Excel. Sin teóricas cargadas no se
  // calcula: todas saldrían como faltantes y no diría nada útil.
  const hasTeo = UBI_TEO.length>0;
  const sqlSinTeo = [];
  if(hasTeo){
    const teoSet = new Set(UBI_TEO.map(u=>String(u[0]||'').trim().toUpperCase()));
    const seenCod = new Set();
    for(const r of INV){
      const ubi = String(r[3]||'').trim();
      if(ubi && ubi!=='Sin Ubicacion' && !teoSet.has(ubi.toUpperCase())) sqlSinTeo.push([ubi,r[0],r[1],r[2],'Principal']);
      const k = normCode(r[0]);
      if(seenCod.has(k)) continue;
      seenCod.add(k);
      const u2 = String(UBI2_MAP[k]||'').trim();
      if(u2 && !teoSet.has(u2.toUpperCase())) sqlSinTeo.push([u2,r[0],r[1],r[2],'2ª ubicación']);
    }
    sqlSinTeo.sort((x,y)=>x[0].localeCompare(y[0],'es',{numeric:true})||String(x[1]).localeCompare(String(y[1])));
  }
  set__diagSinTeo( sqlSinTeo);
  const sqlSinTeoUbis = new Set(sqlSinTeo.map(x=>x[0].toUpperCase())).size;

  // ── 3. MALA ASIGNACIÓN ABC (A en perfil C/vacío, C en perfil A) ─
  const malaAsig = [];
  if(Object.keys(UBI_PERFIL_MAP).length){
    INV.forEach(r=>{
      const abc = (r[4]||'').toUpperCase();
      if(!abc||!['A','B','C','D','E'].includes(abc)) return;
      if(!r[3]||r[3]==='Sin Ubicacion') return;
      const perfil = UBI_PERFIL_MAP[r[3].toUpperCase()];
      if(!perfil) return;
      const pAbc = (perfil.abc||'').toUpperCase();
      if(!pAbc||!['A','B','C','D','E'].includes(pAbc)) return;
      if(abc===pAbc) return;
      const severidad = (abc==='A'&&pAbc==='C')||(abc==='C'&&pAbc==='A') ? 'alta' : 'media';
      malaAsig.push({cod:r[0],desc:r[1],stock:r[2],ubi:r[3],abcRef:abc,abcPerfil:pAbc,severidad});
    });
    malaAsig.sort((a,b)=>(a.severidad==='alta'?0:1)-(b.severidad==='alta'?0:1));
  }

  // ── 4. ESTANTES CRÍTICOS CON REFS ABC-A ─────────────────────────
  const estCrit = ESTANTES.filter(e=>e[4]<0.2);
  const abcAenCrit = [];
  estCrit.forEach(e=>{
    const refsA = INV.filter(r=>r[4]==='A' && r[3] && r[3]!=='Sin Ubicacion' && r[3].toUpperCase().startsWith(e[0].toUpperCase()));
    if(refsA.length) abcAenCrit.push({estante:e[0],pctLibre:Math.round(e[4]*100),refsA});
  });
  abcAenCrit.sort((a,b)=>a.pctLibre-b.pctLibre);

  // ── 5. ANÁLISIS GA + PEDIDOS SUGERIDOS ─────────────────────────
  const oc=parseInt(document.getElementById('diagOC')?.value)||7;
  const lt=parseInt(document.getElementById('diagLT')?.value)||1;
  const ss=parseInt(document.getElementById('diagSS')?.value)||7;
  const hasKaizenData=Object.keys(KAIZEN_EXT).length>0;

  // ── GA: Guía de Abastecimiento Toyota DPOK ─────────────────────
  // gaDeberiaStockear: GA=SI pero stock=0 → PEDIR con prioridad
  // gaNoDeberiaStock:  GA=NO pero stock>0 → revisar para liquidar/no reponer
  // gaFaseIn:          FASE_IN=1 → priorizar abastecimiento
  // gaFaseOut:         FASE_OUT=1 → no reponer, liquidar
  const gaDeberiaStockear=[], gaNoDeberiaStock=[], gaFaseIn=[], gaFaseOut=[];
  const gaCounts={SI:0,NO:0,REVISAR:0};

  // ── Flujo de referencias: tendencia M1-M3 vs M4-M6 ──────────────
  const flujoCounts={SUBIENDO:0,BAJANDO:0,ESTABLE:0,NUEVO:0,APAGADO:0,SIN_VENTAS:0};
  const flujoSubiendo=[], flujoBajando=[];

  // ── Liberación de ubicaciones: solo stock=0 + ubicación asignada ──
  const libMantener=[], libLiberar=[], libRevisar=[];

  INV.forEach(r=>{
    const ext = KAIZEN_EXT[r[0]] ?? KAIZEN_EXT[normCode(r[0])];
    if(!ext) return;
    const abc = (r[4]||'').toUpperCase();
    if(diagABC!=='ALL'&&abc!==diagABC) return;
    const stock = r[2]||0;
    const ubi   = r[3]||'';

    // Flujo + regularidad — alimentan la liberación de ubicaciones.
    const flujo = calcFlujo(ext.meses);
    const regularidad = calcRegularidad(ext.meses);
    const esRegular = regularidad.regular !== false;

    // GA (SI/NO/REVISAR) — la misma calcGA(cod) que usa la tabla de pedidos.
    const gaInfo = calcGA(r[0]);
    const ga = gaInfo.ga;
    gaCounts[ga] = (gaCounts[ga]||0)+1;
    if(ext.fase_in)  gaFaseIn.push({cod:r[0],desc:r[1],abc,stock,categoria:ext.clasifDPOK,fr:ext.fr,mad:ext.mad});
    if(ext.fase_out) gaFaseOut.push({cod:r[0],desc:r[1],abc,stock,categoria:ext.clasifDPOK,fr:ext.fr,mad:ext.mad});
    if(ga==='SI' && stock===0)
      gaDeberiaStockear.push({cod:r[0],desc:r[1],abc,stock,categoria:ext.clasifDPOK,fr:ext.fr,mad:ext.mad,ga,motivo:gaInfo.motivo});
    if(ga==='NO' && stock>0)
      gaNoDeberiaStock.push({cod:r[0],desc:r[1],abc,stock,categoria:ext.clasifDPOK,fr:ext.fr,mad:ext.mad,ga,motivo:gaInfo.motivo});

    flujoCounts[flujo.trend] = (flujoCounts[flujo.trend]||0)+1;
    const flujoItem={cod:r[0],desc:r[1],abc,stock,fr:ext.fr,mad:ext.mad,deltaPct:flujo.deltaPct,hRecent:flujo.hRecent,hPrior:flujo.hPrior};
    if(flujo.trend==='SUBIENDO') flujoSubiendo.push(flujoItem);
    if(flujo.trend==='BAJANDO')  flujoBajando.push(flujoItem);

    // Liberación de ubicaciones (solo stock=0 con ubicación real asignada)
    if(stock===0 && ubi && ubi!=='Sin Ubicacion'){
      const lib = calcLiberacion(flujo.trend, stock, esRegular, flujo.frReciente, ext.fr, regularidad.maxGap, ext.dias_ult_compra ?? null);
      const libItem={cod:r[0],desc:r[1],abc,ubi,fr:ext.fr,mad:ext.mad,trend:flujo.trend,regular:esRegular,maxGap:regularidad.maxGap,frReciente:flujo.frReciente,diasUltCompra:ext.dias_ult_compra??null};
      if(lib==='MANTENER') libMantener.push(libItem);
      else if(lib==='LIBERAR') libLiberar.push(libItem);
      else libRevisar.push(libItem);
    }
  });
  flujoSubiendo.sort((a,b)=>(b.deltaPct||0)-(a.deltaPct||0));
  flujoBajando.sort((a,b)=>(a.deltaPct||0)-(b.deltaPct||0));
  libLiberar.sort((a,b)=>(['A','B','C'].indexOf(a.abc))-(['A','B','C'].indexOf(b.abc)));
  gaDeberiaStockear.sort((a,b)=>(['A','B','C'].indexOf(a.abc))-(['A','B','C'].indexOf(b.abc)));
  gaNoDeberiaStock.sort((a,b)=>b.stock-a.stock);

  // ── Pedidos sugeridos: MAX-MAX con demanda robusta ──────────────
  const pedidos=[], fueraGuia=[];
  const excl={EN_BANDA:0,FASE_OUT:0,SIN_VENTA_RECIENTE:0,BAJA_ROTACION:0,GA_NO:0,SIN_DEMANDA:0};
  INV.forEach(r=>{
    const abc=(r[4]||'').toUpperCase();
    if(diagABC!=='ALL'&&abc!==diagABC)return;
    const s=calcSOQ(r[0],oc,lt,ss,r);
    if(!s)return;
    if(s.excluida){
      excl[s.excluida]=(excl[s.excluida]||0)+1;
      if(s.excluida==='GA_NO'&&s.fueraGuia) fueraGuia.push({cod:r[0],desc:r[1],abc,...s.fueraGuia});
      return;
    }
    const priceRow=getPriceRow(r[0]);
    const costo=priceRow&&priceRow[3]>0?priceRow[3]:r[7]||0;
    pedidos.push({cod:r[0],desc:r[1],abc,s,costo,valor:s.soq*costo});
  });
  // Primero lo que se agota antes de que llegue el pedido; luego ABC; luego lo más cerca de agotarse
  const abcOrd={A:0,B:1,C:2,D:3,E:4};
  pedidos.sort((a,b)=>{
    const dp=(a.s.prioridad==='CRITICO'?0:1)-(b.s.prioridad==='CRITICO'?0:1);
    if(dp!==0) return dp;
    const da=(abcOrd[a.abc]??3)-(abcOrd[b.abc]??3);
    return da!==0?da:a.s.cobertura-b.s.cobertura;
  });
  fueraGuia.sort((a,b)=>((abcOrd[a.abc]??3)-(abcOrd[b.abc]??3))||(a.cobertura-b.cobertura));

  const totalValor=pedidos.reduce((s,p)=>s+p.valor,0);
  const cntA=pedidos.filter(p=>p.abc==='A').length;
  const cntB=pedidos.filter(p=>p.abc==='B').length;
  const cntC=pedidos.filter(p=>p.abc==='C').length;
  const cntD=pedidos.filter(p=>p.abc==='D').length;
  const cntE=pedidos.filter(p=>p.abc==='E').length;

  // ── TARJETAS RESUMEN (5 cards) ──────────────────────────────────
  const cards = [
    {count:ocu0.length,label:'Ubis ocupadas · stock 0',sub:'Ubicaciones con código asignado pero sin stock',color:ocu0.length>0?'var(--amber)':'var(--green)',section:'ocu0'},
    {count:hasTeo?sqlSinTeoUbis:'—',label:'Ubis SQL sin teórica',sub:hasTeo?`En el SQL pero no en UBITEORICAS · ${sqlSinTeo.length} ref${sqlSinTeo.length!==1?'s':''}`:'Esta sede no tiene ubicaciones teóricas cargadas',color:!hasTeo?'var(--text3)':sqlSinTeoUbis>0?'var(--red)':'var(--green)',section:'sinteo'},
    {count:gaDeberiaStockear.length,label:'GA=SI · sin stock',sub:hasKaizenData?`Deben estar en inventario (${gaFaseIn.length} en FASE-IN)`:'Requiere datos M1-M6 del SQL',color:gaDeberiaStockear.length>0?'var(--red)':'var(--green)',section:'ga'},
    {count:gaNoDeberiaStock.length,label:'GA=NO · con stock',sub:hasKaizenData?`No deberían estar (${gaFaseOut.length} en FASE-OUT)`:'Requiere datos M1-M6 del SQL',color:gaNoDeberiaStock.length>0?'var(--amber)':'var(--green)',section:'ga'},
    {count:pedidos.length,label:'Pedidos sugeridos',sub:hasKaizenData?(pedidos.length>0?`Valor est. $${totalValor.toLocaleString('es-CO',{maximumFractionDigits:0})}`:'Inventario al día según parámetros'):'Requiere datos M1-M6 del SQL',color:pedidos.length>0?'var(--cyan)':'var(--text3)',section:'pedidos'},
    {count:fueraGuia.length,label:'Fuera de la guía · stock bajo',sub:hasKaizenData?'GA=NO con ventas recientes: decidir a mano':'Requiere datos M1-M6 del SQL',color:fueraGuia.length>0?'var(--amber)':'var(--text3)',section:'fueraguia'},
    {count:(flujoCounts.SUBIENDO||0)+(flujoCounts.BAJANDO||0),label:'Con tendencia marcada',sub:hasKaizenData?`📈 ${flujoCounts.SUBIENDO||0} subiendo · 📉 ${flujoCounts.BAJANDO||0} bajando`:'Requiere datos M1-M6 del SQL',color:'var(--cyan)',section:'flujo'},
    {count:libLiberar.length,label:'Ubicaciones liberables',sub:hasKaizenData?`De ${libMantener.length+libLiberar.length+libRevisar.length} en stock=0 con ubicación`:'Requiere datos M1-M6 del SQL',color:libLiberar.length>0?'var(--blue)':'var(--text3)',section:'liberacion'}
  ];

  document.getElementById('diagCards').innerHTML = cards.map(c=>`
    <div class="diag-card" onclick="diagScrollTo('${jsAttrSafe(c.section)}')">
      <div class="diag-card-accent" style="background:${c.color}"></div>
      <div class="diag-card-count" style="color:${c.color}">${c.count}</div>
      <div class="diag-card-label">${c.label}</div>
      <div class="diag-card-sub">${c.sub}</div>
    </div>`).join('');

  // ── SECCIONES DETALLE ───────────────────────────────────────────
  const sections = [];

  // Sección 2
  sections.push(diagSection('ocu0','⚠️ Ubicaciones ocupadas con stock = 0',ocu0.length,
    ocu0.length===0
      ? '<div class="diag-empty">✅ No hay ubicaciones con código asignado y stock vacío</div>'
      : `<div class="diag-tscr"><table style="width:100%"><thead><tr>
          <th>Código</th><th>Descripción</th><th>Ubicación</th><th>Stock</th><th></th>
         </tr></thead><tbody>${ocu0.slice(0,200).map(r=>`
          <tr>
            <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(r[0])}')">${r[0]}${cp(r[0])}</td>
            <td class="tdesc">${r[1]||'—'}</td>
            <td style="font-family:var(--mono);font-size:10px;color:var(--cyan);cursor:pointer" onclick="goBusUbi('${jsAttrSafe(r[2]||r[3])}')">${r[2]||r[3]||'—'}</td>
            <td class="tnum zero">0</td>
            <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="goBusUbi('${jsAttrSafe(r[2]||r[3])}')">Ver ubi</button></td>
          </tr>`).join('')}
         </tbody></table></div>
         ${ocu0.length>200?`<div style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:8px 16px">Mostrando 200 de ${ocu0.length}</div>`:''}`
  ));

  // Sección 2b – ubicaciones del SQL ausentes en UBITEORICAS
  sections.push(diagSection('sinteo','📍 Ubicaciones en SQL que no están en UBITEORICAS',hasTeo?sqlSinTeoUbis:0,
    !hasTeo
      ? '<div class="diag-empty">ℹ️ Esta sede no tiene ubicaciones teóricas cargadas (hoja UBITEORICAS del Excel), así que no se puede hacer el cruce.</div>'
      : sqlSinTeo.length===0
        ? '<div class="diag-empty">✅ Todas las ubicaciones del SQL existen en UBITEORICAS</div>'
        : `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px 6px;border-bottom:1px solid var(--border)">
            <button class="sbtn" style="height:26px;font-size:9px;padding:0 10px" onclick="diagSinTeoCopy(this)">📋 Copiar ubicaciones (${sqlSinTeoUbis})</button>
            <span style="font-family:var(--mono);font-size:9px;color:var(--text3)">Agrégalas a UBITEORICAS para que entren al cruce de ocupación</span>
          </div>
          <div class="diag-tscr"><table style="width:100%"><thead><tr>
            <th>Ubicación</th><th>Código</th><th>Descripción</th><th>Stock</th><th>Origen</th><th></th>
          </tr></thead><tbody>${sqlSinTeo.slice(0,500).map(r=>`
            <tr>
              <td style="font-family:var(--mono);font-size:10px;color:var(--cyan);white-space:nowrap">${escHtml(r[0])}</td>
              <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(r[1])}')">${r[1]}${cp(r[1])}</td>
              <td class="tdesc">${escHtml(r[2]||'—')}</td>
              <td class="tnum ${r[3]>0?'pos':'zero'}">${fmt(r[3])}</td>
              <td style="font-family:var(--mono);font-size:9px;color:var(--text3);white-space:nowrap">${r[4]}</td>
              <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="goBuscador('${jsAttrSafe(r[0])}')">Ver</button></td>
            </tr>`).join('')}
          </tbody></table></div>
          ${sqlSinTeo.length>500?`<div style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:8px 16px">Mostrando 500 de ${sqlSinTeo.length} (el botón copia todas las ubicaciones)</div>`:''}`
  ));

  // Sección 3
  sections.push(diagSection('malaasig','🔀 Mala asignación ABC',malaAsig.length,
    !Object.keys(UBI_PERFIL_MAP).length
      ? '<div class="diag-empty">Carga una hoja PERFILES_ESTANTES para habilitar este análisis</div>'
      : malaAsig.length===0
        ? '<div class="diag-empty">✅ No se detectaron incompatibilidades ABC</div>'
        : `<div class="diag-tscr"><table style="width:100%"><thead><tr>
            <th>Código</th><th>Descripción</th><th>Ubicación</th><th>ABC Ref</th><th>ABC Perfil</th><th>Severidad</th><th></th>
           </tr></thead><tbody>${malaAsig.slice(0,200).map(r=>`
            <tr style="${r.severidad==='alta'?'background:rgba(232,64,64,.04)':''}">
              <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(r.cod)}')">${r.cod}${cp(r.cod)}</td>
              <td class="tdesc">${r.desc||'—'}</td>
              <td style="font-family:var(--mono);font-size:10px;color:var(--cyan);cursor:pointer" onclick="goBusUbi('${jsAttrSafe(r.ubi)}')">${r.ubi}</td>
              <td><span class="badge b${r.abcRef}">${r.abcRef}</span></td>
              <td><span class="badge b${r.abcPerfil}">${r.abcPerfil}</span></td>
              <td><span style="font-family:var(--mono);font-size:8px;padding:2px 6px;border-radius:3px;background:${r.severidad==='alta'?'rgba(232,64,64,.12)':'rgba(232,156,32,.12)'};color:${r.severidad==='alta'?'var(--red)':'var(--gold)'};border:1px solid ${r.severidad==='alta'?'rgba(232,64,64,.3)':'rgba(232,156,32,.3)'}">${r.severidad.toUpperCase()}</span></td>
              <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="openSuggestModal('${jsAttrSafe(r.cod)}','${jsAttrSafe(r.desc||'')}','')">Reubicar</button></td>
            </tr>`).join('')}
           </tbody></table></div>
           ${malaAsig.length>200?`<div style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:8px 16px">Mostrando 200 de ${malaAsig.length}</div>`:''}`
  ));

  // Sección 4
  sections.push(diagSection('estcrit','🔴 Estantes críticos con refs ABC-A',abcAenCrit.length,
    abcAenCrit.length===0
      ? '<div class="diag-empty">✅ Los estantes críticos no contienen refs de alta rotación, o no hay estantes críticos</div>'
      : abcAenCrit.map(e=>`
        <div style="padding:10px 16px;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-family:var(--mono);font-weight:700;font-size:13px;cursor:pointer;color:var(--amber)" onclick="goEstante('${jsAttrSafe(e.estante)}')">${e.estante}</span>
            <span style="font-family:var(--mono);font-size:8px;padding:2px 6px;border-radius:3px;background:rgba(232,64,64,.12);color:var(--red);border:1px solid rgba(232,64,64,.3)">${e.pctLibre}% LIBRE</span>
            <span style="font-family:var(--mono);font-size:9px;color:var(--text3)">${e.refsA.length} ref${e.refsA.length!==1?'s':''} ABC-A</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${e.refsA.slice(0,15).map(r=>`
              <span style="font-family:var(--mono);font-size:9px;padding:3px 8px;border-radius:4px;background:rgba(232,64,64,.08);border:1px solid rgba(232,64,64,.2);color:var(--red);cursor:pointer" onclick="diagBuscar('${jsAttrSafe(r[0])}')" title="${r[1]||''}">${r[0]}</span>
            `).join('')}
            ${e.refsA.length>15?`<span style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:3px 6px">+${e.refsA.length-15} más</span>`:''}
          </div>
        </div>`).join('')
  ));

  // ── SECCIÓN 5: ANÁLISIS GA — Guía de Abastecimiento Toyota DPOK ─
  function confianzaBadge(conf){
    const cfg={
      ALTA:{bg:'rgba(0,210,110,.14)',col:'var(--green)'},
      MEDIA:{bg:'rgba(255,171,0,.14)',col:'var(--amber)'},
      BAJA:{bg:'rgba(255,80,80,.12)',col:'var(--red)'},
      SIN_DATOS:{bg:'var(--bg4)',col:'var(--text3)'},
    };
    const c=cfg[conf]||cfg.SIN_DATOS;
    return`<span style="font-family:var(--mono);font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:${c.bg};color:${c.col}">${conf}</span>`;
  }

  function gaBadge(ga,motivo){
    const cfg={
      'SI':     {bg:'rgba(0,210,110,.14)', col:'var(--green)', lbl:'SI'},
      'NO':     {bg:'rgba(255,80,80,.12)', col:'var(--red)',   lbl:'NO'},
      'REVISAR':{bg:'rgba(255,171,0,.14)', col:'var(--amber)', lbl:'REVISAR'},
      '—':      {bg:'var(--bg4)',          col:'var(--text3)', lbl:'—'},
    };
    const c=cfg[ga]||cfg['—'];
    return`<span title="${escHtml(motivo||'')}" style="font-family:var(--mono);font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:${c.bg};color:${c.col}">${c.lbl}</span>`;
  }
  function catBadge(cat){
    const col=cat==='MP'?'var(--amber)':cat==='RG'?'var(--blue)':cat==='COLISION'||cat==='COLISIÓN'?'#9b79ff':cat==='ACCESORIOS'?'var(--green)':'var(--text3)';
    return cat?`<span style="font-family:var(--mono);font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(128,128,128,.12);color:${col};border:1px solid currentColor;opacity:.85">${cat}</span>`:'—';
  }
  function flujoBadge(trend){
    const cfg={
      SUBIENDO:  {ico:'📈',col:'var(--green)',lbl:'Subiendo'},
      BAJANDO:   {ico:'📉',col:'var(--red)',   lbl:'Bajando'},
      ESTABLE:   {ico:'➡️',col:'var(--text3)', lbl:'Estable'},
      NUEVO:     {ico:'🆕',col:'var(--cyan)',  lbl:'Nuevo'},
      APAGADO:   {ico:'⛔',col:'var(--red)',   lbl:'Apagado'},
      SIN_VENTAS:{ico:'⚫',col:'var(--text3)', lbl:'Sin ventas'},
      SIN_DATOS: {ico:'—', col:'var(--text3)', lbl:'—'},
    };
    const c=cfg[trend]||cfg.SIN_DATOS;
    return`<span style="display:inline-flex;align-items:center;gap:3px;font-family:var(--mono);font-size:9px;font-weight:700;color:${c.col}" title="${c.lbl}">${c.ico} ${c.lbl}</span>`;
  }
  let gaBody='';
  if(!hasKaizenData){
    gaBody='<div class="diag-empty">Requiere datos M1-M6 y SubGrupo3 del SQL para activar el análisis GA.</div>';
  } else {
    // GA summary chips
    gaBody=`<div class="soq-summary">
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--green)">${gaCounts['SI']||0}</span><span class="soq-sum-lbl">GA=SI</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--red)">${gaCounts['NO']||0}</span><span class="soq-sum-lbl">GA=NO</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--amber)">${gaCounts['REVISAR']||0}</span><span class="soq-sum-lbl">Revisar</span></div>
      ${gaFaseIn.length?`<div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--cyan)">${gaFaseIn.length}</span><span class="soq-sum-lbl">FASE-IN ↑</span></div>`:''}
      ${gaFaseOut.length?`<div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--amber)">${gaFaseOut.length}</span><span class="soq-sum-lbl">FASE-OUT ↓</span></div>`:''}
    </div>`;

    // Sub-bloque A: GA=SI pero sin stock (PEDIR)
    if(gaDeberiaStockear.length){
      gaBody+=`<div style="padding:8px 16px 4px;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--red);letter-spacing:.08em">
        🔴 GA=SI — SIN STOCK · Deben estar en inventario (${gaDeberiaStockear.length})
      </div>
      <div class="diag-tscr"><table style="width:100%">
      <thead><tr><th>Código</th><th>Descripción</th><th>ABC</th><th>Categoría</th>
        <th title="Frecuencia (meses con ventas en los últimos 6)">FR</th>
        <th title="Demanda mensual promedio">MAD</th><th>GA</th><th></th></tr></thead>
      <tbody>${gaDeberiaStockear.slice(0,200).map(p=>`
        <tr style="background:rgba(255,60,60,.03)">
          <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(p.cod)}')">${p.cod}${cp(p.cod)}</td>
          <td class="tdesc">${escHtml(p.desc||'—')}</td>
          <td><span class="badge b${p.abc}">${p.abc}</span></td>
          <td>${catBadge(p.categoria)}</td>
          <td class="tnum" style="color:${p.fr>=4?'var(--green)':'var(--amber)'};font-weight:700">${p.fr}</td>
          <td class="tnum">${p.mad.toFixed(2)}</td>
          <td>${gaBadge(p.ga,p.motivo)}</td>
          <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="diagBuscar('${jsAttrSafe(p.cod)}')">Ver</button></td>
        </tr>`).join('')}
      </tbody></table></div>
      ${gaDeberiaStockear.length>200?`<div class="diag-empty" style="padding:6px 16px">+${gaDeberiaStockear.length-200} más</div>`:''}`;
    }

    // Sub-bloque B: GA=NO pero con stock (REVISAR)
    if(gaNoDeberiaStock.length){
      gaBody+=`<div style="padding:8px 16px 4px;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--amber);letter-spacing:.08em;border-top:1px solid var(--border)">
        🟠 GA=NO — CON STOCK · No deberían estar (${gaNoDeberiaStock.length})
      </div>
      <div class="diag-tscr"><table style="width:100%">
      <thead><tr><th>Código</th><th>Descripción</th><th>ABC</th><th>Categoría</th>
        <th>FR</th><th>MAD</th><th>Stock</th><th>GA</th><th></th></tr></thead>
      <tbody>${gaNoDeberiaStock.slice(0,200).map(p=>`
        <tr style="background:rgba(255,171,0,.03)">
          <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(p.cod)}')">${p.cod}${cp(p.cod)}</td>
          <td class="tdesc">${escHtml(p.desc||'—')}</td>
          <td><span class="badge b${p.abc}">${p.abc}</span></td>
          <td>${catBadge(p.categoria)}</td>
          <td class="tnum" style="color:${p.fr>=4?'var(--green)':'var(--red)'};font-weight:700">${p.fr}</td>
          <td class="tnum">${p.mad.toFixed(2)}</td>
          <td class="tnum pos">${fmt(p.stock)}</td>
          <td>${gaBadge(p.ga,p.motivo)}</td>
          <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="diagBuscar('${jsAttrSafe(p.cod)}')">Ver</button></td>
        </tr>`).join('')}
      </tbody></table></div>
      ${gaNoDeberiaStock.length>200?`<div class="diag-empty" style="padding:6px 16px">+${gaNoDeberiaStock.length-200} más</div>`:''}`;
    }

    if(!gaDeberiaStockear.length && !gaNoDeberiaStock.length){
      gaBody+='<div class="diag-empty">✅ Inventario alineado con la Guía de Abastecimiento DPOK.</div>';
    }
  }

  sections.push(diagSection('ga','🎯 Guía de Abastecimiento · DPOK Toyota',gaDeberiaStockear.length+gaNoDeberiaStock.length,gaBody));

  // ── SECCIÓN 6: PEDIDOS SUGERIDOS ────────────────────────────────
  const soqFormula=`Objetivo MIP = demanda/día × (<b>O/C=${oc}</b> + <b>L/T=${lt}</b> + <b>S/S=${ss}</b> = <b>${oc+lt+ss} días</b>)&nbsp;&nbsp;|&nbsp;&nbsp;Se pide si O/H + O/O − B/O ≤ demanda × <b>${lt+ss} d</b> (L/T+S/S)&nbsp;&nbsp;|&nbsp;&nbsp;SOQ = MIP − posición`;
  const confCounts={ALTA:pedidos.filter(p=>p.s.confianza==='ALTA').length,BAJA:pedidos.filter(p=>p.s.confianza==='BAJA').length};
  const nCrit=pedidos.filter(p=>p.s.prioridad==='CRITICO').length;
  const exclTxt=[
    [excl.EN_BANDA,'con stock dentro de la banda MAX-MAX'],
    [excl.GA_NO,'GA=NO con stock bajo (lista aparte, abajo)'],
    [excl.SIN_VENTA_RECIENTE,'sin ventas en 3 meses'],
    [excl.BAJA_ROTACION,'baja rotación'],
    [excl.FASE_OUT,'en FASE de salida'],
    [excl.SIN_DEMANDA,'sin demanda medible'],
  ].filter(x=>x[0]>0).map(x=>`<b>${x[0]}</b> ${x[1]}`).join(' · ');
  const soqSummary=`
    <div class="soq-summary">
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--cyan)">${pedidos.length}</span><span class="soq-sum-lbl">Total refs</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--red)">${nCrit}</span><span class="soq-sum-lbl">Críticas</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--green)">${cntA}</span><span class="soq-sum-lbl">ABC-A</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--gold2)">${cntB}</span><span class="soq-sum-lbl">ABC-B</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--blue)">${cntC}</span><span class="soq-sum-lbl">ABC-C</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:#a064f0">${cntD}</span><span class="soq-sum-lbl">ABC-D</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--text3)">${cntE}</span><span class="soq-sum-lbl">ABC-E</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--green)">${confCounts.ALTA}</span><span class="soq-sum-lbl">Confianza alta</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--red)">${confCounts.BAJA}</span><span class="soq-sum-lbl">Confianza baja</span></div>
      <div class="soq-sum-chip" style="margin-left:auto"><span class="soq-sum-val" style="color:var(--amber);font-size:14px">$${totalValor.toLocaleString('es-CO',{maximumFractionDigits:0})}</span><span class="soq-sum-lbl">Valor est. total</span></div>
    </div>
    <div class="soq-formula">${soqFormula}</div>
    ${exclTxt?`<div class="soq-formula" style="border-top:none;padding-top:0">No se piden: ${exclTxt}</div>`:''}`;

  let soqBody='';
  if(!hasKaizenData){
    soqBody='<div class="diag-empty">Requiere datos M1-M6 del SQL para calcular pedidos sugeridos.</div>';
  } else if(pedidos.length===0){
    soqBody=soqSummary+'<div class="diag-empty">✅ Inventario al día — ninguna referencia requiere reabastecimiento con los parámetros actuales.</div>';
  } else {
    soqBody=soqSummary+`<div class="diag-tscr"><table style="width:100%">
      <thead><tr>
        <th>Código</th><th>Descripción</th><th>ABC</th>
        <th title="CRÍTICO: el stock no alcanza hasta que llegue el pedido (cobertura menor que el L/T) o ya está en 0. REPONER: bajó del nivel de reorden.">Prioridad</th>
        <th title="Stock actual">O/H</th>
        <th title="Ya pedido, en camino (O/O)">En camino</th>
        <th title="Frecuencia: meses con venta en los últimos 6 (M1-M6)">FR</th>
        <th title="Tendencia: M1+M2+M3 vs M4+M5+M6">Flujo</th>
        <th title="Días que alcanza lo que hay (O/H + O/O − B/O) con la demanda diaria estimada">Cobert.</th>
        <th title="Demanda diaria estimada: mediana de MAD robusto, promedio ponderado 60/40 y DAD del SQL">Dem./día</th>
        <th title="Nivel máximo: demanda/día × (O/C+L/T+S/S)">MIP</th>
        <th title="Cantidad sugerida a pedir = MIP − posición. Pase el mouse para ver el cálculo.">SOQ</th>
        <th title="Qué tanto concuerdan las lecturas de demanda y qué tan regular es la venta" style="font-size:8px">Confianza</th>
        <th title="Clasificación DPOK de la Guía de Abastecimiento — pase el mouse para ver el motivo">GA</th>
        <th title="Costo unitario">Costo unit.</th>
        <th title="Valor estimado del pedido">Valor pedido</th>
        <th></th>
      </tr></thead>
      <tbody>${pedidos.slice(0,500).map(p=>{
        const s=p.s;
        const costoFmt=p.costo>0?'$'+p.costo.toLocaleString('es-CO',{maximumFractionDigits:0}):'—';
        const valorFmt=p.valor>0?'$'+p.valor.toLocaleString('es-CO',{maximumFractionDigits:0}):'—';
        const soqClass=s.soq>=10?'soq-val-high':s.soq>=4?'soq-val-med':'soq-val-ok';
        const abcBadge=p.abc?`<span class="badge b${p.abc}">${p.abc}</span>`:'—';
        const crit=s.prioridad==='CRITICO';
        const prioBadge=`<span style="font-family:var(--mono);font-size:8px;font-weight:700;padding:2px 6px;border-radius:4px;background:${crit?'rgba(255,80,80,.14)':'rgba(255,171,0,.14)'};color:${crit?'var(--red)':'var(--amber)'}">${crit?'CRÍTICO':'REPONER'}</span>`;
        const f=s.fuentes;
        const demTitle=`Demanda/día = mediana de:\nMAD robusto: ${f.mad.toFixed(3)}\nPonderado 60/40: ${f.wma.toFixed(3)}\nDAD del SQL: ${f.dad?f.dad.toFixed(3):'—'}`;
        const soqTitle=`SOQ = MIP − posición\nMIP ${s.mip.toFixed(1)} = ${s.d.toFixed(2)}/día × ${s.T} d\nPosición ${s.pos.toFixed(1)} = O/H ${Math.round(s.oh)} + O/O ${Math.round(s.oo)} − B/O ${Math.round(s.bo)}\nNivel de reorden ${s.rop.toFixed(1)}`;
        const mot=s.motivos.join(' · ');
        return`<tr>
          <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(p.cod)}')">${p.cod}${cp(p.cod)}</td>
          <td class="tdesc">${escHtml(p.desc||'—')}<div style="font-size:8px;color:var(--text3);margin-top:2px">${escHtml(mot)}</div></td>
          <td>${abcBadge}</td>
          <td>${prioBadge}</td>
          <td class="tnum${s.oh===0?' zero':' pos'}">${fmt(s.oh)}</td>
          <td class="tnum">${s.oo>0?fmt(s.oo):'—'}</td>
          <td class="tnum" style="color:${s.fr>=4?'var(--green)':s.fr===3?'var(--amber)':'var(--red)'};font-weight:700">${s.fr??'—'}</td>
          <td>${flujoBadge(s.flujo?.trend)}</td>
          <td class="tnum" style="color:${s.cobertura<lt?'var(--red)':'var(--text2)'}">${s.cobertura.toFixed(1)} d</td>
          <td class="tnum" title="${demTitle}">${s.d.toFixed(2)}</td>
          <td class="tnum" style="color:var(--text3)">${s.mip.toFixed(1)}</td>
          <td class="soq-qty" title="${soqTitle}"><span class="${soqClass}">${s.soq}</span></td>
          <td>${confianzaBadge(s.confianza)}</td>
          <td>${gaBadge(s.ga,s.gaMotivo)}</td>
          <td class="tnum">${costoFmt}</td>
          <td class="tnum" style="color:var(--cyan)">${valorFmt}</td>
          <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="diagBuscar('${jsAttrSafe(p.cod)}')">Ver</button></td>
        </tr>`;}).join('')}
      </tbody></table></div>
      ${pedidos.length>500?`<div style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:8px 16px">Mostrando 500 de ${pedidos.length}</div>`:''}`;
  }
  sections.push(diagSection('pedidos','📦 Pedidos sugeridos · MAX-MAX',pedidos.length,soqBody));

  // ── SECCIÓN 6b: FUERA DE LA GUÍA (GA=NO) CON STOCK BAJO ──────────
  let fgBody='';
  if(!hasKaizenData){
    fgBody='<div class="diag-empty">Requiere datos M1-M6 del SQL.</div>';
  } else {
    const fgNote=`<div class="soq-formula">La Guía de Abastecimiento dice que estas refs <b>no deben tener stock</b> (venta poco frecuente), así que no entran al pedido sugerido. Pero hoy están por debajo del nivel de reorden y <b>vendieron en los últimos 3 meses</b>. Se listan aquí para que decidas a mano si pedir alguna. No tienen cantidad calculada ni suman al valor del pedido.</div>`;
    fgBody=fgNote+(fueraGuia.length===0
      ?'<div class="diag-empty">✅ Ninguna: todas las refs fuera de la guía están con stock suficiente o sin ventas recientes.</div>'
      :`<div class="diag-tscr"><table style="width:100%">
        <thead><tr><th>Código</th><th>Descripción</th><th>ABC</th><th>O/H</th><th>En camino</th><th title="Meses con venta en los últimos 6">FR</th><th>Flujo</th><th title="Días que alcanza lo que hay con la demanda diaria estimada">Cobert.</th><th title="Demanda diaria estimada">Dem./día</th><th>GA</th><th></th></tr></thead>
        <tbody>${fueraGuia.slice(0,300).map(p=>`<tr>
          <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(p.cod)}')">${p.cod}${cp(p.cod)}</td>
          <td class="tdesc">${escHtml(p.desc||'—')}</td>
          <td>${p.abc?`<span class="badge b${p.abc}">${p.abc}</span>`:'—'}</td>
          <td class="tnum${p.oh===0?' zero':' pos'}">${fmt(p.oh)}</td>
          <td class="tnum">${p.oo>0?fmt(p.oo):'—'}</td>
          <td class="tnum" style="font-weight:700">${p.fr??'—'}</td>
          <td>${flujoBadge(p.flujo?.trend)}</td>
          <td class="tnum">${p.cobertura.toFixed(1)} d</td>
          <td class="tnum">${p.d.toFixed(2)}</td>
          <td>${gaBadge(p.ga,p.gaMotivo)}</td>
          <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="diagBuscar('${jsAttrSafe(p.cod)}')">Ver</button></td>
        </tr>`).join('')}</tbody></table></div>
        ${fueraGuia.length>300?`<div style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:8px 16px">Mostrando 300 de ${fueraGuia.length}</div>`:''}`);
  }
  sections.push(diagSection('fueraguia','🧭 Fuera de la guía (GA=NO) · stock bajo con ventas recientes',fueraGuia.length,fgBody));

  // ── SECCIÓN 7: FLUJO DE REFERENCIAS — tendencia M1-M3 vs M4-M6 ──
  let flujoBody='';
  if(!hasKaizenData){
    flujoBody='<div class="diag-empty">Requiere datos M1-M6 del SQL para detectar tendencias.</div>';
  } else {
    flujoBody=`<div class="soq-summary">
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--green)">${flujoCounts.SUBIENDO||0}</span><span class="soq-sum-lbl">📈 Subiendo</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--red)">${flujoCounts.BAJANDO||0}</span><span class="soq-sum-lbl">📉 Bajando</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--text3)">${flujoCounts.ESTABLE||0}</span><span class="soq-sum-lbl">➡️ Estable</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--cyan)">${flujoCounts.NUEVO||0}</span><span class="soq-sum-lbl">🆕 Nuevo</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--red)">${flujoCounts.APAGADO||0}</span><span class="soq-sum-lbl">⛔ Apagado</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--text3)">${flujoCounts.SIN_VENTAS||0}</span><span class="soq-sum-lbl">⚫ Sin ventas</span></div>
    </div>`;

    function flujoTable(items,titulo,color){
      if(!items.length) return '';
      return `<div style="padding:8px 16px 4px;font-family:var(--mono);font-size:10px;font-weight:700;color:${color};letter-spacing:.08em;border-top:1px solid var(--border)">
        ${titulo} (${items.length})
      </div>
      <div class="diag-tscr"><table style="width:100%">
      <thead><tr><th>Código</th><th>Descripción</th><th>ABC</th><th>Stock</th><th>FR</th>
        <th title="Últimos 3 meses (M1+M2+M3)">Últ. 3m</th>
        <th title="3 meses anteriores (M4+M5+M6)">Ant. 3m</th>
        <th title="Cambio porcentual">Δ%</th><th></th></tr></thead>
      <tbody>${items.slice(0,150).map(p=>`
        <tr>
          <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(p.cod)}')">${p.cod}${cp(p.cod)}</td>
          <td class="tdesc">${escHtml(p.desc||'—')}</td>
          <td><span class="badge b${p.abc}">${p.abc||'—'}</span></td>
          <td class="tnum${p.stock===0?' zero':' pos'}">${fmt(p.stock)}</td>
          <td class="tnum">${p.fr}</td>
          <td class="tnum">${p.hRecent.toFixed(1)}</td>
          <td class="tnum">${p.hPrior.toFixed(1)}</td>
          <td class="tnum" style="color:${color};font-weight:700">${p.deltaPct!=null?(p.deltaPct>0?'+':'')+p.deltaPct.toFixed(0)+'%':'—'}</td>
          <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="diagBuscar('${jsAttrSafe(p.cod)}')">Ver</button></td>
        </tr>`).join('')}
      </tbody></table></div>
      ${items.length>150?`<div class="diag-empty" style="padding:6px 16px">+${items.length-150} más</div>`:''}`;
    }

    flujoBody += flujoTable(flujoSubiendo,'📈 SUBIENDO — ganando tracción','var(--green)');
    flujoBody += flujoTable(flujoBajando,'📉 BAJANDO — perdiendo tracción','var(--red)');
    if(!flujoSubiendo.length && !flujoBajando.length){
      flujoBody+='<div class="diag-empty">Sin movimientos de tendencia marcados — demanda estable en todo el inventario filtrado.</div>';
    }
  }
  sections.push(diagSection('flujo','🔀 Flujo de referencias · Tendencia M1-M3 vs M4-M6',(flujoCounts.SUBIENDO||0)+(flujoCounts.BAJANDO||0),flujoBody));

  // ── SECCIÓN 8: LIBERACIÓN DE UBICACIONES — solo stock=0 con ubicación ──
  let libBody='';
  if(!hasKaizenData){
    libBody='<div class="diag-empty">Requiere datos M1-M6 del SQL para evaluar qué ubicaciones liberar con confianza.</div>';
  } else {
    const libTotal=libMantener.length+libLiberar.length+libRevisar.length;
    libBody=`<div class="soq-summary">
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--cyan)">${libTotal}</span><span class="soq-sum-lbl">Stock=0 con ubicación</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--blue)">${libLiberar.length}</span><span class="soq-sum-lbl">🔓 Liberar</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--amber)">${libRevisar.length}</span><span class="soq-sum-lbl">🔍 Revisar</span></div>
      <div class="soq-sum-chip"><span class="soq-sum-val" style="color:var(--green)">${libMantener.length}</span><span class="soq-sum-lbl">🔒 Mantener</span></div>
    </div>
    <div class="soq-formula">Cruza la tendencia de flujo (M1-M3 vs M4-M6) y qué tan seguidas están las ventas entre sí — ventas sueltas repartidas cada 2-3+ meses cuentan como "demanda creada", no como necesidad recurrente real, así el conteo de meses se vea razonable.</div>`;

    function motivoLiberacion(p){
      if(p.fr===1) return 'Solo 1 venta en 6 meses (FR=1)';
      if(p.frReciente>=2) return `Venta en ${p.frReciente} de los últ. 3 meses`;
      if(p.trend==='APAGADO') return 'Sin venta en el último trimestre';
      if(p.trend==='SIN_VENTAS') return 'Sin ventas en 6 meses';
      if(p.regular===false){
        const compraReciente = p.diasUltCompra!=null && p.diasUltCompra>0 && p.diasUltCompra<=UMBRAL_COMPRA_RECIENTE_DIAS;
        if(p.fr>=3) return `FR${p.fr} disperso (hueco de ${p.maxGap} meses)`;
        if(compraReciente) return `Dispersa pero compra hace ${p.diasUltCompra}d`;
        return `Dispersa (hueco de ${p.maxGap} meses), sin compra reciente`;
      }
      if(p.trend==='NUEVO') return 'Venta reciente sin historial previo';
      return '—';
    }

    function libTable(items,titulo,color,vacio,mostrarMotivo){
      if(!items.length) return `<div style="padding:10px 16px;font-family:var(--mono);font-size:10px;font-weight:700;color:${color};letter-spacing:.08em;border-top:1px solid var(--border)">${titulo} (0)</div><div class="diag-empty" style="padding:6px 16px 14px">${vacio}</div>`;
      return `<div style="padding:8px 16px 4px;font-family:var(--mono);font-size:10px;font-weight:700;color:${color};letter-spacing:.08em;border-top:1px solid var(--border)">
        ${titulo} (${items.length})
      </div>
      <div class="diag-tscr"><table style="width:100%">
      <thead><tr><th>Código</th><th>Descripción</th><th>ABC</th><th>Ubicación</th><th>FR</th><th>Flujo</th>${mostrarMotivo?'<th>Motivo</th>':''}<th></th></tr></thead>
      <tbody>${items.slice(0,150).map(p=>`
        <tr>
          <td class="tcode" style="cursor:pointer" onclick="openRefDetailModal('${jsAttrSafe(p.cod)}')">${p.cod}${cp(p.cod)}</td>
          <td class="tdesc">${escHtml(p.desc||'—')}</td>
          <td><span class="badge b${p.abc}">${p.abc||'—'}</span></td>
          <td class="tcode" style="color:var(--text2)">${escHtml(p.ubi)}</td>
          <td class="tnum">${p.fr}</td>
          <td>${flujoBadge(p.trend)}</td>
          ${mostrarMotivo?`<td style="font-family:var(--mono);font-size:9px;color:var(--text2)">${motivoLiberacion(p)}</td>`:''}
          <td><button class="sbtn" style="height:24px;font-size:9px;padding:0 8px" onclick="diagBuscar('${jsAttrSafe(p.cod)}')">Ver</button></td>
        </tr>`).join('')}
      </tbody></table></div>
      ${items.length>150?`<div class="diag-empty" style="padding:6px 16px">+${items.length-150} más</div>`:''}`;
    }

    libBody += libTable(libLiberar,'🔓 LIBERAR — se puede reasignar con confianza','var(--blue)','Ninguna referencia cumple los criterios para liberar con confianza en este momento.',true);
    libBody += libTable(libRevisar,'🔍 REVISAR — zona gris, decidir a mano','var(--amber)','Sin casos de zona gris.',true);
    libBody += libTable(libMantener,'🔒 MANTENER — va a necesitar el espacio pronto','var(--green)','Sin referencias que valga la pena reservar.',false);
  }
  sections.push(diagSection('liberacion','🔓 Liberación de ubicaciones · Stock=0',libLiberar.length,libBody));

  document.getElementById('diagSections').innerHTML = sections.join('');
}

function openRelocModalPreFill(cod,desc,ubiVieja,stock,ubiPreFill){
  openRelocModal(cod,desc,ubiVieja,stock);
  // openRelocModal hace focus+setTimeout 80ms; pre-fill después de ese delay
  setTimeout(()=>{
    const inp=document.getElementById('relocInput');
    if(inp&&ubiPreFill){inp.value=ubiPreFill;renderRelocShelves(ubiPreFill);}
  },120);
}
function diagSinTeoCopy(btn){
  const txt=[...new Set(_diagSinTeo.map(r=>r[0]))].join('\n');
  if(!txt)return;
  const ok=()=>{if(btn){const old=btn.textContent;btn.textContent='¡Copiado!';setTimeout(()=>{btn.textContent=old;},1200);}};
  navigator.clipboard.writeText(txt).then(ok).catch(()=>{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');ok();}catch(e){}ta.remove();});
}

function diagSection(id, title, count, bodyHtml){
  return `<div class="diag-section" id="diagsec-${id}">
    <div class="diag-section-hdr" onclick="toggleDiagSection(this)">
      <span class="diag-section-title">${title}</span>
      <div class="diag-section-meta">
        <span>${count} ítem${count!==1?'s':''}</span>
        <span class="diag-section-arr">▼</span>
      </div>
    </div>
    <div class="diag-section-body open">${bodyHtml}</div>
  </div>`;
}
function toggleDiagSection(hdr){
  hdr.classList.toggle('open');
  hdr.nextElementSibling.classList.toggle('open');
}
function diagScrollTo(id){
  const el=document.getElementById('diagsec-'+id);
  if(el){el.scrollIntoView({behavior:'smooth',block:'start'});
    const body=el.querySelector('.diag-section-body');
    const hdr=el.querySelector('.diag-section-hdr');
    if(body&&!body.classList.contains('open')){body.classList.add('open');hdr.classList.add('open');}
  }
}
function diagBuscar(cod){
  pushNavState();
  document.getElementById('busQ').value=cod;
  goTab('bus',document.querySelectorAll('.tab[data-tab="bus"]')[0]);
  setBM('EXA');
  doSearch();
}

export { closeDiagParamsModal, copiarListaPedidos, diagBuscar, diagScrollTo, diagSinTeoCopy, openDiagParamsModal, openRelocModalPreFill, runDiagnostico, toggleDiagSection };
