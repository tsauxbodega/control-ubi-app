// ═══ js/excel-parse.js — lectura PURA del libro CONTROL_UBI_cache.xlsx ═══
// Sin DOM, sin variables globales de la app y sin imports: sirve igual en el navegador (hilo principal), en el
// Web Worker (js/excel-parse.worker.js) y en Node (tools/excel-a-json.mjs, que corre en GitHub Actions).
// Recibe la librería SheetJS como parámetro (XLSX) y devuelve un objeto de datos simple (JSON-serializable).
// Quien lo aplica a la pantalla es processExcel/applyExcelData en excel-respaldo.js.

export const EXCEL_FALLBACK_BODEGA = 130; // el libro corresponde a Sur
export const EXCEL_DATA_VERSION = 1;      // sube si cambia la forma del objeto de datos (el cliente descarta JSON de otra versión)

export function normCode(v){return String(v??'').replace(/ /g,' ').trim().toUpperCase().replace(/\s+/g,'');}
export function findSheetName(sheets,aliases){
  const ups=sheets.map(s=>[s,s.toUpperCase()]);
  for(const a of aliases){const au=a.toUpperCase();const exact=ups.find(([,u])=>u===au);if(exact)return exact[0];const partial=ups.find(([,u])=>u.includes(au));if(partial)return partial[0];}
  return null;
}
export function cleanNumber(v){
  if(v===null||v===undefined||v==='')return 0;
  if(typeof v==='number')return v;
  let s=String(v).replace(/[^0-9.,\-]/g,'').trim();
  if(!s)return 0;
  const hasComma=s.includes(','),hasDot=s.includes('.');
  if(hasComma&&hasDot){const lc=s.lastIndexOf(','),ld=s.lastIndexOf('.');if(lc>ld){s=s.replace(/\./g,'').replace(',','.');}else{s=s.replace(/,/g,'');}}
  else if(hasComma){if(/,\d{3}$/.test(s)&&s.indexOf(',')===s.lastIndexOf(','))s=s.replace(',','');else s=s.replace(',','.');}
  else if(hasDot){const wd=s.replace('.','');if(/\.\d{3}$/.test(s)&&parseFloat(wd)>=1000)s=s.replace('.','')}
  const n=parseFloat(s);return isNaN(n)?0:n;
}
export function normPriceKey(label){
  return String(label||'').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'precio';
}

export function _hdrKey(v){ return String(v??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,''); }
const _MES_ES = {ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,set:9,oct:10,nov:11,dic:12};
export function _fechaISO(v){
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
export function excelToFlatRows(XLSX, wb){
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

// ── Hojas que se leen ─────────────────────────────────────────────────────────
const SHEETS_USED = [
  ['PRECIOS_DATA','PRECIOS','PRICES','LISTA PRECIOS'],
  ['UBITEORICAS','UBI TEORICAS','UBICACIONES TEORICAS'],
  ['DASH_ESTANTES','DASHBOARD ESTANTES'],
  ['SM','STOCK_MUERTO','STOCK MUERTO'],
  ['PERFILES_ESTANTES','PERFILES ESTANTES','SHELF_PROFILES']
];
const SHEETS_STOCK = [   // solo para reconstruir el inventario desde el Excel (modo Excel)
  ['KAIZEN'], ['STOCK_UBI','OCUPADO'], ['STOCK_NOUBI','STOCK NOUBI','STOCK_NO UBI'], ['NOSTOCK_UBI','NOSTOCK UBI']
];

// SheetJS interpreta por defecto TODAS las hojas y guarda fórmulas/estilos/formatos que nadie lee. Se leen primero
// solo los nombres (instantáneo), luego únicamente las hojas necesarias, en modo "denso". Los datos que salen de
// sheet_to_json son idénticos a los de una lectura completa.
export function readWorkbook(XLSX, buf, wantFlat){
  const base = {type:'array', dense:true, cellFormula:false, cellHTML:false, cellStyles:false, cellNF:false};
  try{
    const names = XLSX.read(buf, {type:'array', bookSheets:true}).SheetNames || [];
    const groups = wantFlat ? SHEETS_USED.concat(SHEETS_STOCK) : SHEETS_USED;
    const want = [...new Set(groups.map(c => findSheetName(names, c)).filter(Boolean))];
    if(want.length) return XLSX.read(buf, {...base, sheets:want});
  }catch(e){ /* si algo raro pasa, se cae a la lectura completa */ }
  return XLSX.read(buf, {type:'array'});
}

const toRows = (XLSX, wb, nm, raw) => XLSX.utils.sheet_to_json(wb.Sheets[nm], {header:1, raw, defval:''});

// ── Lectura completa → objeto de datos ───────────────────────────────────────
// wantFlat=true añade el inventario plano (modo Excel, sin SQL). Forma del resultado:
//   priceTypes:[{key,label}]  prices:[[ref,desc,costo,v0,v1,…]] (v_i alineado con priceTypes)
//   ubiTeo:[[ubi,estado,ref,stock,tipo]]  estantes:[[nombre,total,ocup,libres,pctLibre,nota]]
//   smMap:{}  perfilMap:{}  shelfProfiles:{}  perfilesFromFile:n
//   flatCols:[…]  flat:[[…]]  (filas del inventario, como arreglos, con las columnas de flatCols)
export function parseWorkbook(XLSX, buf, opts = {}){
  const wantFlat = !!opts.wantFlat;
  const wb = readWorkbook(XLSX, buf, wantFlat);
  const sheets = wb.SheetNames;
  const out = { v:EXCEL_DATA_VERSION, priceTypes:[], prices:[], ubiTeo:[], estantes:[], smMap:{}, perfilMap:{}, shelfProfiles:{}, perfilesFromFile:0, flatCols:[], flat:[] };

  // ── Precios ──
  const ps = findSheetName(sheets, SHEETS_USED[0]);
  if(ps){
    const rows = toRows(XLSX, wb, ps, true);
    const header = rows[0] || [];
    // Columnas 0 y 1: Código y Descripción. De la 2 en adelante, cada columna con encabezado es un tipo de precio,
    // EXCEPTO la que contenga "costo" (no es un precio de venta).
    const colDefs = [];
    for(let ci=2; ci<header.length; ci++){
      const label = String(header[ci]||'').trim();
      if(!label) continue;
      const isCosto = /costo/i.test(label);
      colDefs.push({idx:ci, key:isCosto?'costo':normPriceKey(label), label, isCosto});
    }
    if(!colDefs.length){ // planilla antigua sin encabezados utilizables
      colDefs.push({idx:2,key:'mostrador',label:'Mostrador',isCosto:false});
      colDefs.push({idx:3,key:'accesorios',label:'Accesorios',isCosto:false});
      colDefs.push({idx:4,key:'costo',label:'Costo',isCosto:true});
    }
    out.priceTypes = colDefs.filter(c=>!c.isCosto).map(c=>({key:c.key, label:c.label}));
    const costoCol = colDefs.find(c=>c.isCosto);
    for(let i=1; i<rows.length; i++){
      const r = rows[i]; if(!r || !r[0]) continue;
      const byType = {};
      colDefs.forEach(c=>{ if(!c.isCosto) byType[c.key] = cleanNumber(r[c.idx]); });
      out.prices.push([ String(r[0]).trim(), String(r[1]||'').trim(), costoCol ? cleanNumber(r[costoCol.idx]) : 0,
                        ...out.priceTypes.map(t => byType[t.key]||0) ]);
    }
  }

  // ── Ubicaciones teóricas ──
  const us = findSheetName(sheets, SHEETS_USED[1]);
  if(us){
    const rows = toRows(XLSX, wb, us, false);
    let h=-1;
    for(let i=0;i<Math.min(rows.length,20);i++){const row=(rows[i]||[]).map(v=>String(v||'').trim().toUpperCase());if(row.includes('UBICACIÓN')||row.includes('UBICACION')){h=i;break;}}
    if(h>=0){for(let i=h+1;i<rows.length;i++){const r=rows[i];if(!r||!r[0])continue;const ubi=String(r[0]).trim();if(!ubi||ubi==='UBICACIÓN'||ubi.toLowerCase()==='ubicacion')continue;out.ubiTeo.push([ubi,String(r[1]||'').trim(),String(r[2]||'').trim(),cleanNumber(r[3]),String(r[4]||'').trim().toUpperCase()]);}}
  }

  // ── Estantes ──
  const es = findSheetName(sheets, SHEETS_USED[2]);
  if(es){
    const rows = toRows(XLSX, wb, es, false);
    let h=-1;
    for(let i=0;i<Math.min(rows.length,20);i++){const row=(rows[i]||[]).map(v=>String(v||'').trim().toUpperCase());if(row.includes('ESTANTE')&&row.includes('TOTAL')&&row.includes('LIBRES')){h=i;break;}}
    if(h>=0){for(let i=h+1;i<rows.length;i++){const r=rows[i];if(!r||!r[0])continue;const nm=String(r[0]).trim();if(!nm||nm==='ESTANTE'||nm.startsWith('📊')||nm.startsWith('📍')||nm.startsWith('⚠️'))continue;const pct=cleanNumber(r[4])/100;out.estantes.push([nm,parseInt(r[1]||0)||0,parseInt(r[2]||0)||0,parseInt(r[3]||0)||0,pct,String(r[5]||'').trim()]);}}
  }

  // ── SM (Stock Muerto) ──
  const smSheet = findSheetName(sheets, SHEETS_USED[3]);
  if(smSheet){
    const rows = toRows(XLSX, wb, smSheet, false);
    let hSM=0;
    for(let i=0;i<Math.min(rows.length,5);i++){
      const r=(rows[i]||[]).map(v=>String(v||'').trim().toUpperCase());
      if(r.includes('CODIGO')||r.includes('CÓDIGO')){hSM=i;break;}
    }
    for(let i=hSM+1;i<rows.length;i++){
      const r=rows[i];if(!r||!r[0])continue;
      const cod=normCode(r[0]);if(!cod)continue;
      out.smMap[cod]={
        desc:String(r[1]||'').trim(),
        ubi:String(r[2]||'').trim(),
        stock:parseFloat(String(r[3]||'0').replace(',','.'))||0,
        ult_compra:String(r[4]||'').trim(),
        ult_vt:String(r[5]||'').trim()
      };
    }
  }

  // ── PERFILES_ESTANTES: tabla principal de ubicaciones ──
  const pfs = findSheetName(sheets, SHEETS_USED[4]);
  if(pfs){
    const rows = toRows(XLSX, wb, pfs, false);
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
        out.perfilMap[ubi]={cat,dim,tipo_bin,abc,rot,zona,altura,codigo};
        out.perfilesFromFile++;
      }
    }
    // Compatibilidad hacia atrás: perfiles viejos con formato PREFIJO
    if(out.perfilesFromFile===0){
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
        out.shelfProfiles[key]={tamano,abc,zona:['frontal','central','trasera'].includes(zona)?zona:'',altura:['bajo','medio','alto'].includes(altura)?altura:'',obs};
        out.perfilesFromFile++;
      }
    }
  }

  // ── Inventario plano desde el Excel (modo Excel) ──
  if(wantFlat){
    const rows = excelToFlatRows(XLSX, wb);
    if(rows.length){
      out.flatCols = Object.keys(rows[0]);
      out.flat = rows.map(r => out.flatCols.map(k => r[k]));
    }
  }
  return out;
}

// Reconstruye las filas planas (objetos) a partir de flatCols/flat.
export function flatRowsFromData(data){
  const cols = data.flatCols || [];
  return (data.flat || []).map(a => { const o = {}; for(let i=0;i<cols.length;i++) o[cols[i]] = a[i]; return o; });
}
