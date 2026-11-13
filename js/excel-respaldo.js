import { ACTIVE_BODEGA, BODEGAS, INV_RAW_BY_BODEGA, set_INV_RAW_BY_BODEGA } from './config.js';
import { ESTANTES, INV, NOSTOCK_UBI, PRICES, PRICE_IDX, PRICE_TYPES, SHELF_PROFILES, SM_MAP, UBI_PERFIL_MAP, UBI_TEO, cleanNumber, normPriceKey, saveShelfProfiles, saveToStorage, set_ESTANTES, set_PRICES, set_PRICE_IDX, set_PRICE_TYPES, set_SM_MAP, set_UBI_PERFIL_MAP, set_UBI_TEO, updateProfileBadge } from './state-globals.js';
import { buildPriceIndex, findSheetName, normCode, prog } from './file-upload.js';
import { applyPriceDivisors, syncShelfSnapshots } from './precios-divisor.js';
import { loadInvFromSQL, recomputeEstantesLibres, recomputeUbiTeoOcupacion, setActiveBodega } from './inventario-sql.js';
import { updateUI } from './ui-header-tabs.js';
import { _lastExcelModified, _reloadTimer } from './autoload-excel.js';
import { syncRadarPriceCloud } from './radar-precios.js';
import { buildSnapshot, detectChanges, saveChanges } from './radar-cambios.js';
import { closeOptionsMenu } from './pwa-ui.js';
// ═══ js/excel-respaldo.js — extraído de index.html (líneas 8328–8736 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ══════════════════════════════════════════════════════════════════
// MODO RESPALDO EXCEL — inventario desde el libro CONTROL_UBI_cache.xlsx
// Se activa solo cuando el servidor SQL no responde (caída del servidor
// corporativo, app desplegada fuera de la red, etc.). Convierte las hojas
// KAIZEN / Stock_Ubi / Stock_NoUbi / NoStock_Ubi al MISMO formato de fila
// plana que entrega el SQL y la pasa por processFlatInvRows(): no hay un
// segundo motor, así que todas las vistas funcionan igual.
// Limitaciones (el Excel no trae esos datos): SubGrupo3/categoría DPOK (GA
// queda en REVISAR), Stock_Min/Max/Seguridad, O/O y B/O, costo de inventario
// (el costo unitario sigue saliendo de PRECIOS_DATA) y la bodega Norte.
// ══════════════════════════════════════════════════════════════════
const MANUAL_EXCEL_KEY = 'ctrl_manual_excel';
let MANUAL_EXCEL_MODE = (()=>{ try{ return localStorage.getItem(MANUAL_EXCEL_KEY)==='1'; }catch(e){ return false; } })();
let INV_SOURCE = 'sql';            // 'sql' | 'cache' | 'excel'
let _wantExcelInv = false;         // true = el próximo processExcel debe construir inventario
let _skipRadarOnce = false;        // evita falsos "cambios" al cambiar de fuente
const EXCEL_FALLBACK_BODEGA = 130; // el libro corresponde a Sur
const FALLBACK_CACHE_MAX_H = 12;   // caché SQL más viejo que esto → se prefiere el Excel
const SQL_FETCH_TIMEOUT_MS = 20000;

function _hdrKey(v){ return String(v??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,''); }
const _MES_ES = {ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,set:9,oct:10,nov:11,dic:12};
function _fechaISO(v){
  const s = String(v??'').trim();
  if(!s) return '';
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m = s.match(/^(\d{1,2})[-\/ ]([A-Za-zñÑ]+)\.?[-\/ ](\d{2,4})$/);
  if(m){
    const mm = _MES_ES[m[2].toLowerCase().slice(0,3)];
    let y = +m[3]; if(y<100) y+=2000;
    if(mm) return y+'-'+String(mm).padStart(2,'0')+'-'+String(+m[1]).padStart(2,'0');
  }
  const m2 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);   // dd/mm/yyyy
  if(m2) return m2[3]+'-'+String(+m2[2]).padStart(2,'0')+'-'+String(+m2[1]).padStart(2,'0');
  return '';
}

// Devuelve filas planas (mismo formato que arma loadInvFromSQL) o [].
function excelToFlatRows(wb){
  const sheets = wb.SheetNames;
  const read = nm => nm ? XLSX.utils.sheet_to_json(wb.Sheets[nm],{header:1,raw:false,defval:''}) : [];
  const kzRows  = read(findSheetName(sheets,['KAIZEN']));
  const suRows  = read(findSheetName(sheets,['STOCK_UBI','OCUPADO']));
  const snuRows = read(findSheetName(sheets,['STOCK_NOUBI','STOCK NOUBI','STOCK_NO UBI']));
  const nsuRows = read(findSheetName(sheets,['NOSTOCK_UBI','NOSTOCK UBI']));

  const out = new Map();                       // normCode|ubi → fila
  const byCod = new Map();                     // normCode → [filas] (para completar ubicación)
  const push = (row)=>{
    const k = normCode(row.cod)+'|'+(row.ubicacion||'');
    if(out.has(k)) return;
    out.set(k,row);
    const c = normCode(row.cod);
    if(!byCod.has(c)) byCod.set(c,[]);
    byCod.get(c).push(row);
  };
  const isHeaderCode = c => ['CODIGO','REFERENCIA','CÓDIGO'].includes(String(c).trim().toUpperCase());
  const blankUbi = u => { u=String(u??'').trim(); return !u||u.toLowerCase()==='nan'||u==='#N/A'||u==='0'||u.toLowerCase()==='sin ubicacion'||u.toLowerCase()==='sin ubicación'; };

  // 1) KAIZEN — columnas por NOMBRE de encabezado (no por posición)
  if(kzRows.length>1){
    const ix = {};
    (kzRows[0]||[]).forEach((h,i)=>{ const k=_hdrKey(h); if(k && !(k in ix)) ix[k]=i; });
    const col = (...names)=>{ for(const n of names){ if(n in ix) return ix[n]; } return -1; };
    const c = {
      cod:col('codigo','referencia'), desc:col('descripcion'), stock:col('stock'),
      dad:col('dad'), mip:col('mip'), diasInv:col('diasinvactprom'), abc:col('abc'),
      m1:col('m1'), m2:col('m2'), m3:col('m3'), m4:col('m4'), m5:col('m5'), m6:col('m6'),
      fIn:col('fasein'), fOut:col('faseout'), dias:col('dias'), ubi:col('ubicacion'),
      grupo:col('subgrupo2'), fEnt:col('fechaentrada'), fUlt:col('fechaultimacompra'),
      oo:col('oo','on order'), bo:col('bo','backorder'), score:col('score'),
    };
    const g = (r,i)=> i>=0 ? r[i] : '';
    if(c.cod>=0){
      for(let i=1;i<kzRows.length;i++){
        const r = kzRows[i]; if(!r||!r[c.cod]||isHeaderCode(r[c.cod])) continue;
        push({
          bodega:EXCEL_FALLBACK_BODEGA, cod:String(r[c.cod]).trim(), desc:g(r,c.desc), stock:g(r,c.stock),
          ubicacion: String(g(r,c.ubi)||'').trim(), abc:g(r,c.abc), grupo:g(r,c.grupo),
          m1:g(r,c.m1), m2:g(r,c.m2), m3:g(r,c.m3), m4:g(r,c.m4), m5:g(r,c.m5), m6:g(r,c.m6),
          costo:0, costo_prom:0, fecha:_fechaISO(g(r,c.fEnt)), ultima_compra:_fechaISO(g(r,c.fUlt)),
          oo:g(r,c.oo)||0, bo:g(r,c.bo)||0, score:g(r,c.score)||0,
          dad:g(r,c.dad), mip_sql:g(r,c.mip), dias_inv:g(r,c.diasInv),
          fase_in:g(r,c.fIn), fase_out:g(r,c.fOut), dias_ult_compra:g(r,c.dias),
          categoria:'', subgrupo:'', subgrupo2:g(r,c.grupo), subgrupo3:'',
          stock_min:0, stock_max:0, stock_seg:0,
        });
      }
    }
  }

  const base = (cod,desc,stock,ubi)=>({
    bodega:EXCEL_FALLBACK_BODEGA, cod:String(cod).trim(), desc:desc||'', stock:stock||0,
    ubicacion:String(ubi||'').trim(), abc:'', grupo:'', m1:0,m2:0,m3:0,m4:0,m5:0,m6:0,
    costo:0, costo_prom:0, fecha:'', ultima_compra:'', oo:0, bo:0, score:0,
    dad:0, mip_sql:0, dias_inv:0, fase_in:0, fase_out:0, dias_ult_compra:0,
    categoria:'', subgrupo:'', subgrupo2:'', subgrupo3:'', stock_min:0, stock_max:0, stock_seg:0,
  });
  // Completa la ubicación de KAIZEN cuando viene vacía y la hoja de ubicaciones sí la trae;
  // si la referencia no existe en KAIZEN, la agrega.
  const merge = (cod,desc,stock,ubi)=>{
    const nc = normCode(cod); if(!nc) return;
    const ex = byCod.get(nc);
    if(ex && ex.length){
      const row = ex[0];
      if(!blankUbi(ubi) && blankUbi(row.ubicacion)){
        out.delete(nc+'|'+(row.ubicacion||''));
        row.ubicacion = String(ubi).trim();
        out.set(nc+'|'+row.ubicacion,row);
      }
      return;
    }
    push(base(cod,desc,stock,blankUbi(ubi)?'':ubi));
  };
  for(let i=1;i<suRows.length;i++){ const r=suRows[i]; if(!r||!r[0]||isHeaderCode(r[0])) continue; merge(r[0],r[1],r[2],r[3]); }
  for(let i=1;i<snuRows.length;i++){ const r=snuRows[i]; if(!r||!r[0]||isHeaderCode(r[0])) continue; merge(r[0],r[1],r[3],''); }
  for(let i=1;i<nsuRows.length;i++){ const r=nsuRows[i]; if(!r||!r[0]||isHeaderCode(r[0])) continue; merge(r[0],r[1],0,r[2]); }
  return [...out.values()];
}

// ── Aviso visible mientras la app no usa datos del SQL ───────────
function showFallbackBanner(kind, extra){
  let bar = document.getElementById('fallbackBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'fallbackBar';
    bar.style.cssText = 'background:#fff3cd;color:#664d03;border-bottom:2px solid #e0a800;padding:7px 14px;font-size:13px;line-height:1.35;display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:relative;z-index:50';
    const hdr = document.querySelector('.hdr');
    if(hdr && hdr.parentNode) hdr.parentNode.insertBefore(bar, hdr.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
  }
  let msg;
  if(kind==='excel' && MANUAL_EXCEL_MODE){
    const mod = _lastExcelModified ? ' (archivo del '+new Date(_lastExcelModified).toLocaleDateString('es-CO')+')' : '';
    msg = '📴 <b>Modo Excel activado manualmente</b> — no se consulta el SQL. Inventario del Excel'+mod+', solo sede <b>Sur</b>; sin costos de inventario, mín/máx, O/O, B/O ni categoría GA.'
        + (ACTIVE_BODEGA!==EXCEL_FALLBACK_BODEGA ? ' <b>⚠ Norte no está disponible en este modo.</b>' : '');
  } else if(kind==='excel'){
    const mod = _lastExcelModified ? ' (archivo del '+new Date(_lastExcelModified).toLocaleDateString('es-CO')+')' : '';
    msg = '📴 <b>Modo respaldo Excel</b> — el servidor SQL no responde. Inventario tomado del Excel'+mod+', solo sede <b>Sur</b>. No hay costos de inventario, mín/máx, O/O, B/O ni categoría GA; los datos pueden estar desfasados. Se reintenta SQL cada 5 min.'
        + (ACTIVE_BODEGA!==EXCEL_FALLBACK_BODEGA ? ' <b>⚠ Norte no está disponible en este modo.</b>' : '');
  } else if(kind==='cache'){
    msg = '📴 <b>Sin conexión con SQL</b> — mostrando el último inventario guardado en este dispositivo'+(extra?' ('+extra+')':'')+'. Se reintenta cada 5 min.';
  } else {
    msg = '📴 <b>Sin conexión con SQL ni con el Excel</b> — se muestran los últimos datos guardados en este dispositivo, que pueden estar desactualizados.';
  }
  bar.innerHTML = '<span style="flex:1;min-width:220px">'+msg+'</span>'
    + (MANUAL_EXCEL_MODE
        ? '<button onclick="toggleManualExcelMode()" style="background:#664d03;color:#fff;border:0;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer">Volver a SQL</button>'
        : '<button onclick="retrySQLNow(this)" style="background:#664d03;color:#fff;border:0;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer">Reintentar SQL ahora</button>');
  bar.style.display = 'flex';
}
function hideFallbackBanner(){
  const bar = document.getElementById('fallbackBar');
  if(bar) bar.style.display = 'none';
}
function updateManualExcelMenu(){
  const t=document.getElementById('optManualExcelTxt');
  if(t) t.textContent = MANUAL_EXCEL_MODE ? 'Desactivar modo Excel (volver a SQL)' : 'Activar modo Excel (sin SQL)';
}
function toggleManualExcelMode(){
  MANUAL_EXCEL_MODE = !MANUAL_EXCEL_MODE;
  try{ localStorage.setItem(MANUAL_EXCEL_KEY, MANUAL_EXCEL_MODE?'1':'0'); }catch(e){}
  updateManualExcelMenu();
  try{ closeOptionsMenu(); }catch(e){}
  if(MANUAL_EXCEL_MODE){
    _wantExcelInv = true;
    if(INV_SOURCE==='excel') showFallbackBanner('excel');   // ya estaba en respaldo: solo cambia el aviso
  } else {
    hideFallbackBanner();
  }
  clearTimeout(_reloadTimer);
  loadInvFromSQL(false);
}
function retrySQLNow(btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Reintentando…'; }
  clearTimeout(_reloadTimer);
  loadInvFromSQL(false).finally(()=>{ if(btn){ btn.disabled=false; btn.textContent='Reintentar SQL ahora'; } });
}

function processExcel(buf, fname, isSilent = false) {
  try{
    const wb=XLSX.read(buf,{type:'array'});
    const sheets=wb.SheetNames;
    prog(10);
    // ── Radar de Cambios: capturar snapshot ANTES de limpiar datos ──
    const _radSnap = INV.length ? buildSnapshot() : null;
    set_PRICES({});set_PRICE_IDX({});set_PRICE_TYPES([]);set_UBI_TEO([]);set_ESTANTES([]);
    // NOTA (migración a SQL): el inventario (INV/NOSTOCK_UBI/KAIZEN_EXT/
    // UBI2_MAP) YA NO se construye desde Excel — sin importar si el archivo
    // todavía trae hojas STOCK_UBI/STOCK_NOUBI/NOSTOCK_UBI/KAIZEN, se
    // ignoran a propósito. El inventario ahora vive 100% en processFlatInvRows()
    // / loadInvFromSQL(), que ya deriva las mismas categorías (stock+ubi,
    // stock sin ubi, sin stock con ubi) a partir de la única tabla plana de
    // SQL. Subir un Excel de aquí en adelante solo actualiza precios,
    // ubicaciones teóricas, estantes y perfiles — nunca el inventario.
    prog(60);
    const ps=findSheetName(sheets,['PRECIOS_DATA','PRECIOS','PRICES','LISTA PRECIOS']);
    set_PRICE_TYPES([]);
    if(ps){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[ps],{header:1,raw:true,defval:''});
      const header=rows[0]||[];
      // Columnas 0 y 1 son siempre Código y Descripción. De la 2 en
      // adelante, cada columna con encabezado se toma como un tipo de
      // precio — EXCEPTO la que contenga "costo" en el nombre, que se
      // trata aparte (no es un precio de venta). Así, si la hoja trae 2
      // columnas de precio (como hoy) o 10 (cuando se amplíe), el sistema
      // las reconoce solas sin tocar código.
      const colDefs=[];
      for(let ci=2; ci<header.length; ci++){
        const label=String(header[ci]||'').trim();
        if(!label) continue;
        const isCosto=/costo/i.test(label);
        colDefs.push({idx:ci, key:isCosto?'costo':normPriceKey(label), label, isCosto});
      }
      // Fallback si la hoja no trae encabezados de precio reconocibles
      // (planilla antigua sin fila de títulos usable): asume el layout
      // clásico de 2 columnas para no perder compatibilidad.
      if(!colDefs.length){
        colDefs.push({idx:2,key:'mostrador',label:'Mostrador',isCosto:false});
        colDefs.push({idx:3,key:'accesorios',label:'Accesorios',isCosto:false});
        colDefs.push({idx:4,key:'costo',label:'Costo',isCosto:true});
      }
      set_PRICE_TYPES( colDefs.filter(c=>!c.isCosto).map(c=>({key:c.key, label:c.label})));
      const costoCol = colDefs.find(c=>c.isCosto);

      for(let i=1;i<rows.length;i++){
        const r=rows[i]; if(!r||!r[0]) continue;
        const ref=String(r[0]).trim();
        const desc=String(r[1]||'').trim();
        const byType={};
        colDefs.forEach(c=>{ if(!c.isCosto) byType[c.key]=cleanNumber(r[c.idx]); });
        const costo = costoCol ? cleanNumber(r[costoCol.idx]) : 0;
        // Compatibilidad: el resto de la app (Reporte, Radar, Precios,
        // exportaciones) espera PRICES[ref] como array [mostrador,
        // accesorios, desc, costo] — se sigue llenando así usando los
        // primeros DOS tipos detectados. Los tipos extra (si los hay)
        // quedan accesibles en row.byType para el selector nuevo.
        const row=[
          PRICE_TYPES[0]?(byType[PRICE_TYPES[0].key]||0):0,
          PRICE_TYPES[1]?(byType[PRICE_TYPES[1].key]||0):0,
          desc, costo
        ];
        row.byType=byType;
        PRICES[ref]=row; PRICE_IDX[normCode(ref)]=row;
      }
    }
    prog(78);
    const us=findSheetName(sheets,['UBITEORICAS','UBI TEORICAS','UBICACIONES TEORICAS']);
    if(us){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[us],{header:1,raw:false,defval:''});
      let h=-1;
      for(let i=0;i<Math.min(rows.length,20);i++){const row=(rows[i]||[]).map(v=>String(v||'').trim().toUpperCase());if(row.includes('UBICACIÓN')||row.includes('UBICACION')){h=i;break;}}
      if(h>=0){for(let i=h+1;i<rows.length;i++){const r=rows[i];if(!r||!r[0])continue;const ubi=String(r[0]).trim();if(!ubi||ubi==='UBICACIÓN'||ubi.toLowerCase()==='ubicacion')continue;UBI_TEO.push([ubi,String(r[1]||'').trim(),String(r[2]||'').trim(),cleanNumber(r[3]),String(r[4]||'').trim().toUpperCase()]);}}
    }
    // ── MODO RESPALDO: construir el inventario desde las hojas del Excel ──
    if(_wantExcelInv){
      const _fb = excelToFlatRows(wb);
      if(_fb.length){
        _skipRadarOnce = (INV_SOURCE!=='excel');
        set_INV_RAW_BY_BODEGA( {}); for(const id of Object.keys(BODEGAS)) INV_RAW_BY_BODEGA[id] = [];
        INV_RAW_BY_BODEGA[EXCEL_FALLBACK_BODEGA] = _fb;
        INV_SOURCE = 'excel';
        setActiveBodega(ACTIVE_BODEGA, {silent:true, skipReload:true});
        showFallbackBanner('excel');
        console.warn('[Respaldo Excel] inventario reconstruido desde el libro:', _fb.length, 'filas');
      }
    }
    // Recalcula Ocupada/Libre (y qué referencia hay en cada ubicación)
    // contra el inventario recién cargado, en vez de confiar en la
    // fórmula de Excel — así funciona igual venga el inventario de Excel
    // o, más adelante, de SQL.
    recomputeUbiTeoOcupacion();
    prog(88);
    const es=findSheetName(sheets,['DASH_ESTANTES','DASHBOARD ESTANTES']);
    if(es){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[es],{header:1,raw:false,defval:''});
      let h=-1;
      for(let i=0;i<Math.min(rows.length,20);i++){const row=(rows[i]||[]).map(v=>String(v||'').trim().toUpperCase());if(row.includes('ESTANTE')&&row.includes('TOTAL')&&row.includes('LIBRES')){h=i;break;}}
      if(h>=0){for(let i=h+1;i<rows.length;i++){const r=rows[i];if(!r||!r[0])continue;const nm=String(r[0]).trim();if(!nm||nm==='ESTANTE'||nm.startsWith('📊')||nm.startsWith('📍')||nm.startsWith('⚠️'))continue;const pct=cleanNumber(r[4])/100;ESTANTES.push([nm,parseInt(r[1]||0)||0,parseInt(r[2]||0)||0,parseInt(r[3]||0)||0,pct,String(r[5]||'').trim()]);}}
    }
    // Recalcula Total/Ocupadas/Libres/% Libre contra las ubicaciones
    // teóricas recién actualizadas, en vez de confiar en la fórmula de
    // Excel — igual que con recomputeUbiTeoOcupacion arriba.
    recomputeEstantesLibres();
    prog(94);
    // NOSTOCK_UBI ya no se llena desde Excel — viene de processFlatInvRows/SQL.
    // --- SM (Stock Muerto) ---
    set_SM_MAP({});
    const smSheet=findSheetName(sheets,['SM','STOCK_MUERTO','STOCK MUERTO']);
    if(smSheet){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[smSheet],{header:1,raw:false,defval:''});
      // Detectar fila de encabezado (buscar columna "Codigo" o "CODIGO")
      let hSM=0;
      for(let i=0;i<Math.min(rows.length,5);i++){
        const r=(rows[i]||[]).map(v=>String(v||'').trim().toUpperCase());
        if(r.includes('CODIGO')||r.includes('CÓDIGO')){hSM=i;break;}
      }
      for(let i=hSM+1;i<rows.length;i++){
        const r=rows[i];if(!r||!r[0])continue;
        const cod=normCode(r[0]);if(!cod)continue;
        SM_MAP[cod]={
          desc:String(r[1]||'').trim(),
          ubi:String(r[2]||'').trim(),
          stock:parseFloat(String(r[3]||'0').replace(',','.'))||0,
          ult_compra:String(r[4]||'').trim(),
          ult_vt:String(r[5]||'').trim()
        };
      }
    }
    // --- PERFILES_ESTANTES: carga tabla principal de ubicaciones ---
    let perfilesFromFile=0;
    set_UBI_PERFIL_MAP({});
    const pfs=findSheetName(sheets,['PERFILES_ESTANTES','PERFILES ESTANTES','SHELF_PROFILES']);
    if(pfs){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[pfs],{header:1,raw:false,defval:''});
      // Buscar la fila encabezado de la TABLA PRINCIPAL (col[0]=UBICACION, col[5]=CATEGORIA)
      let h=-1;
      for(let i=0;i<rows.length;i++){
        const r=(rows[i]||[]).map(v=>String(v||'').trim().toUpperCase());
        if((r[0]==='UBICACION'||r[0]==='UBICACIÓN')&&(r[5]==='CATEGORIA'||r[5]==='CATEGORÍA'||r[7]==='TIPO_BIN')){h=i;break;}
      }
      if(h>=0){
        for(let i=h+1;i<rows.length;i++){
          const r=rows[i];
          if(!r||!r[0])continue;
          const ubi=String(r[0]).trim().toUpperCase();
          if(!ubi||ubi==='UBICACION'||ubi.startsWith('📍')||ubi.startsWith('⚙️'))continue;
          const cat=String(r[5]||'').trim().toUpperCase();
          const dim=String(r[6]||'').trim().toUpperCase();
          const tipo_bin=String(r[7]||'').trim().toUpperCase();
          const abc=String(r[8]||'').trim().toUpperCase();
          const rot=String(r[9]||'').trim().toUpperCase();
          const codigo=String(r[10]||'').trim().toUpperCase();
          const zona=String(r[3]||'').trim().toUpperCase();
          const altura=String(r[4]||'').trim().toUpperCase();
          if(!cat&&!tipo_bin)continue;
          UBI_PERFIL_MAP[ubi]={cat,dim,tipo_bin,abc,rot,zona,altura,codigo};
          perfilesFromFile++;
        }
      }
      // Compatibilidad hacia atrás: cargar perfiles viejos si la hoja tiene formato PREFIJO
      if(perfilesFromFile===0){
        let h2=0;
        for(let i=0;i<Math.min(rows.length,10);i++){
          const row=(rows[i]||[]).map(v=>String(v||'').trim().toUpperCase());
          if(row[0]==='PREFIJO'){h2=i;break;}
        }
        for(let i=h2+1;i<rows.length;i++){
          const r=rows[i];if(!r||!r[0])continue;
          const prefijo=String(r[0]).trim().toUpperCase();if(!prefijo||prefijo==='PREFIJO')continue;
          const tipo=String(r[1]||'').trim().toUpperCase();
          const zona=String(r[2]||'').trim().toLowerCase();
          const altura=String(r[3]||'').trim().toLowerCase();
          const tamRaw=String(r[4]||'').trim().toUpperCase();
          const abcRaw=String(r[5]||'').trim().toUpperCase();
          const obs=String(r[6]||'').trim();
          const tamano=tamRaw?tamRaw.split(/[,;\s]+/).map(t=>t.trim()).filter(t=>['S','M','L','XL'].includes(t)):[];
          const abc=abcRaw?abcRaw.split(/[,;\s]+/).map(a=>a.trim()).filter(a=>['A','B','C','D','E'].includes(a)):[];
          const key=(tipo==='GRUPO'||tipo==='G')?'_p_'+prefijo:prefijo;
          SHELF_PROFILES[key]={tamano,abc,zona:['frontal','central','trasera'].includes(zona)?zona:'',altura:['bajo','medio','alto'].includes(altura)?altura:'',obs};
          perfilesFromFile++;
        }
        if(perfilesFromFile>0){saveShelfProfiles();}
      }
      updateProfileBadge();
    }
    prog(100);
    buildPriceIndex();
    applyPriceDivisors(); // antes de guardar y de comparar cambios (Radar/Novedades)
    const saved=saveToStorage(INV,PRICES,UBI_TEO,ESTANTES,NOSTOCK_UBI);
    updateUI();
    // Publicar snapshots livianos de estantes (solo lectura pública) para que
    // el modal QR pueda mostrarse rápido sin sesión ni descarga completa del
    // Excel. No bloquea nada: se dispara en segundo plano y falla en silencio
    // si aún no existen las reglas de Firestore para 'estante_snapshots'.
    syncShelfSnapshots();
    // ── Radar de Cambios: detectar y guardar cambios ──
    const _afterSnap = buildSnapshot();
    if(_radSnap && !_skipRadarOnce){
      const _changes=detectChanges(_radSnap,_afterSnap);
      if(_changes.length) saveChanges(_changes);
    }
    _skipRadarOnce=false;
    // ── Radar de PRECIOS en la nube: compara contra la última base
    //    conocida en Firestore (compartida entre dispositivos/sesiones,
    //    no solo esta pestaña — ver módulo arriba). Corre en segundo
    //    plano, no bloquea la carga.
    syncRadarPriceCloud(_afterSnap.prices);
    setTimeout(()=>{
      document.getElementById('prog').style.display='none';
      document.getElementById('progfill').style.width='0%';
      
      if(!isSilent){
        const sm=saved===true?' · Datos guardados en caché':(saved==='noprice'?' · Guardado sin precios':' · Caché no disponible');
        const pfMsg=perfilesFromFile>0?'\n• Perfiles estantes: '+perfilesFromFile+' cargados desde hoja':'';
        const smCount=Object.keys(SM_MAP).length;
        const invMsg=INV.length+' refs (sin cambios — el inventario viene de SQL)';
alert('✅ '+fname+' cargado!\n\n• Inventario: '+invMsg+'\n• Precios: '+Object.keys(PRICES).length.toLocaleString('es-CO')+' refs\n• Ubicaciones teóricas: '+UBI_TEO.length+'\n• Estantes: '+ESTANTES.length+'\n• Stock=0 con ubi: '+NOSTOCK_UBI.length+(smCount?'\n• Stock Muerto (SM): '+smCount+' refs':'')+pfMsg+sm);
      }
    },300);
    return true;
  }catch(err){
    document.getElementById('prog').style.display='none';
    alert('❌ Error al procesar: '+err.message);
    console.error(err);
    return false;
  }
}

export { FALLBACK_CACHE_MAX_H, INV_SOURCE, MANUAL_EXCEL_MODE, SQL_FETCH_TIMEOUT_MS, _skipRadarOnce, _wantExcelInv, hideFallbackBanner, processExcel, retrySQLNow, showFallbackBanner, toggleManualExcelMode, updateManualExcelMenu };
export const set_INV_SOURCE = (v) => (INV_SOURCE = v);
export const set__skipRadarOnce = (v) => (_skipRadarOnce = v);
export const set__wantExcelInv = (v) => (_wantExcelInv = v);
