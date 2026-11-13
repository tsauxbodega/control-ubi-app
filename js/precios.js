import { INV, INV_IDX, PG, PICKLIST, PM, PREC_CURRENT, PRICES, PRICE_TYPES, UBI2_MAP, precAsc, precP, precRes, precSC, set_PM, set_PREC_CURRENT, set_precAsc, set_precP, set_precRes, set_precSC } from './state-globals.js';
import { getPriceRow, normCode, stripDash } from './file-upload.js';
import { getEffectivePrice } from './precios-divisor.js';
import { openRefDetailFromPrec, rdShowImages } from './inventario-sql.js';
import { updatePMButtons } from './ui-header-tabs.js';
import { _tbSort } from './buscador.js';
import { cop, cp, escHtml, fmt, imgBtn, jsAttrSafe, mkPag, pickKeyFromItem, set, setAlert } from './utils.js';
// ═══ js/precios.js — extraído de index.html (líneas 9115–9335 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== PRECIOS =====================
function setPM(m){set_PM(m);updatePMButtons();if(document.getElementById('precQ').value.trim())doPrec();}
let PREC_FILT='TODAS';
function setPrecFilt(f){
  PREC_FILT=f;
  document.getElementById('pf-todas').classList.toggle('on',f==='TODAS');
  document.getElementById('pf-inv').classList.toggle('on',f==='INV');
  if(document.getElementById('precQ').value.trim()) doPrec();
}
function isInInv(cod){return INV_IDX.has(normCode(cod));}
function precGetGrp(cod){const r=INV_IDX.get(normCode(cod));return r?r[6]:'';}

function doPrec(){
  const q=document.getElementById('precQ').value.trim();if(!q){clearPrec();return;}
  const qu=q.toUpperCase();
  document.getElementById('pCard').classList.remove('on');document.getElementById('pMulti').style.display='none';document.getElementById('precMobSort').style.display='none';document.getElementById('pEmpty').style.display='none';setAlert('pAlert');
  if(!Object.keys(PRICES).length){document.getElementById('pEmpty').style.display='block';document.getElementById('pEmMsg').textContent='Carga un Excel primero';return;}

  // Código de repuesto (sin espacios): ignorar guiones; si no hay match,
  // reintentar sin la última letra (mismo criterio que en Búsqueda).
  const isCode = !/\s/.test(qu);
  let qTry = isCode ? stripDash(qu) : qu;
  let retried = false;

  // El spread [k,...v] copia los índices 0..n del array v, pero NO copia
  // propiedades con nombre como v.byType (los tipos de precio extra que
  // detecta el parser dinámico) — sin este helper, el selector de tipo de
  // precio se quedaría sin datos para las columnas nuevas.
  //
  // row[1]/row[2] son los que usa TODA la pestaña Precio (lista de
  // resultados parciales, orden de columnas, "agregar a selección" y la
  // tarjeta de un solo resultado cuando byType no trae el tipo exacto).
  // v[0]/v[1] en cambio son el primer/segundo tipo de precio que haya en
  // el Excel, en el orden en que vengan las columnas — si la hoja trae
  // MOSTRADOR_CON_DCTO antes que MOSTRADOR_SIN_DCTO, v[0] sería el que
  // trae descuento. Por eso aquí se sobreescriben row[1]/row[2] con los
  // valores de byType buscados POR NOMBRE (mostrador_sin_dcto /
  // accesorios_sin_dcto) cuando existen, igual que ya hace getBusListPrice()
  // para el Buscador principal. Si el Excel no trae esas columnas exactas
  // (formato viejo de 2 columnas), se queda con el comportamiento anterior.
  function mkPrecRow(k, v){
    const row=[k,...v]; row.byType=v.byType||null;
    if(row.byType){
      if('mostrador_sin_dcto'  in row.byType) row[1]=row.byType['mostrador_sin_dcto'];
      if('accesorios_sin_dcto' in row.byType) row[2]=row.byType['accesorios_sin_dcto'];
    }
    return row;
  }

  function runPrec(qq){
    let out=[];
    if(PM==='EXA'){
      const v=getPriceRow(qq);
      if(v){out=[mkPrecRow(qq,v)];}
      else{
        for(const[k,v2]of Object.entries(PRICES)){
          const kk=isCode?stripDash(normCode(k)):normCode(k);
          if(kk===qq){out=[mkPrecRow(k,v2)];break;}
        }
      }
    }else{
      const seen=new Set();
      for(const[k,v]of Object.entries(PRICES)){
        const kField=isCode?stripDash(k.toUpperCase()):k.toUpperCase();
        if(kField.includes(qq)||(v[2]&&v[2].toUpperCase().includes(qq))){
          out.push(mkPrecRow(k,v));seen.add(normCode(k));
          if(out.length>=300)break;
        }
      }
      if(out.length<300){
        for(const r of INV){
          if(out.length>=300)break;
          const c=normCode(r[0]);
          if(seen.has(c))continue;
          const codeField=isCode?stripDash(r[0].toUpperCase()):r[0].toUpperCase();
          if(codeField.includes(qq)||(r[1]&&r[1].toUpperCase().includes(qq))){
            const pv=getPriceRow(r[0]);
            if(pv){out.push(mkPrecRow(r[0],pv));}
            else{out.push([r[0],0,0,r[1]||'',0]);}
            seen.add(c);
          }
        }
      }
    }
    return out;
  }

  let res=runPrec(qTry);
  if(isCode && !res.length && qTry.length>1 && /[A-Z]$/.test(qTry)){
    qTry=qTry.slice(0,-1);
    res=runPrec(qTry);
    retried=res.length>0;
  }

  if(PREC_FILT==='INV') res=res.filter(r=>isInInv(r[0])); set_precRes(res);set_precP(1);set_precSC(-1);set_precAsc(true);
  if(!res.length){setAlert('pAlert','ae',true,'❌ "'+q+'" no encontrado — prueba modo PARCIAL');document.getElementById('pEmpty').style.display='block';document.getElementById('pEmMsg').textContent='No encontrado';document.getElementById('pEmSub').textContent='Prueba PARCIAL para coincidencias';return;}
  const note=retried?`🔎 Sin match exacto — sin última letra ("${qTry}") · `:'';
  if(res.length===1){
    if(retried)setAlert('pAlert','alw',true,note+'1 coincidencia');
    const r=res[0];const nom=r[3]&&r[3]!=='nan'?r[3]:'(Sin nombre registrado)';
    set('pNom',nom);set('pCod','Ref: '+r[0]);
    set_PREC_CURRENT({cod:r[0],desc:r[3]&&r[3]!=='nan'?r[3]:''});
    renderPGrid(r);
    const inv=INV.filter(i=>i[0].toUpperCase()===r[0].toUpperCase());
    const invDiv=document.getElementById('pInv');
    if(inv.length){const totStk=inv.reduce((a,c)=>a+c[2],0);const ubis=[...new Set(inv.map(i=>i[3]).filter(u=>u&&u!=='Sin Ubicacion'))];const ubi2v=UBI2_MAP[normCode(inv[0][0])];const ubi2tag=ubi2v?` · 2ªUbi: ${ubi2v}` :'';invDiv.style.cssText='background:var(--green2);border:1px solid rgba(31,199,106,.3);color:var(--green)';invDiv.textContent='✅ En bodega · Stock: '+fmt(totStk)+(ubis.length?' · Ubi: '+ubis.join(', '):' · Sin ubicación')+ubi2tag+' · ABC: '+(inv[0][4]||'—');}
    else{invDiv.style.cssText='background:var(--amber3);border:1px solid rgba(232,156,32,.3);color:var(--amber2)';invDiv.textContent='⚠️ Esta referencia no aparece en el inventario activo.';}
    document.getElementById('pCard').classList.add('on');
  }else{
    setAlert('pAlert','alw',true,(retried?note:'📋 ')+res.length+' resultado(s)'+(res.length>=300?' (máx 300)':''));
    renderPrecTable();document.getElementById('pMulti').style.display='block';document.getElementById('precMobSort').style.display='';
  }
}
// ── Selector de tipo de precio ──
// PRICE_TYPES se detecta solo del Excel (ver processExcel). Hoy suelen
// ser 2 (Mostrador/Accesorios); cuando la lista de precios se amplíe con
// más columnas, aparecen más casillas acá automáticamente, sin tocar
// código. null = mostrar todos (default, y lo que hace que un tipo nuevo
// aparezca solo sin tener que ir a marcarlo a mano).
function getPrecVisibleTypes(){
  try{
    const raw=localStorage.getItem('ctrl_prec_visible_types');
    if(!raw) return null;
    const arr=JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : null;
  }catch(e){ return null; }
}
function openPrecTypeModal(){
  const list=document.getElementById('precTypeList');
  if(!list) return;
  const visible=getPrecVisibleTypes();
  const types=(PRICE_TYPES.length?PRICE_TYPES:[{key:'mostrador',label:'Mostrador'},{key:'accesorios',label:'Accesorios'}]).concat([{key:'costo',label:'Costo'}]);
  list.innerHTML = types.map(t=>{
    const checked = !visible || visible.has(t.key);
    return `<label style="display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;color:var(--text2);cursor:pointer">
      <input type="checkbox" value="${escHtml(t.key)}" ${checked?'checked':''}> ${escHtml(t.label)}
    </label>`;
  }).join('');
  document.getElementById('precTypeOverlay').classList.add('on');
}
function closePrecTypeModal(){ document.getElementById('precTypeOverlay')?.classList.remove('on'); }
function precTypeSelectAll(){
  document.querySelectorAll('#precTypeList input[type="checkbox"]').forEach(cb=>cb.checked=true);
}
function savePrecTypeSelection(){
  const boxes=[...document.querySelectorAll('#precTypeList input[type="checkbox"]')];
  const checked=boxes.filter(b=>b.checked).map(b=>b.value);
  // Si quedan TODOS marcados, se borra la preferencia (vuelve a "mostrar
  // todos") para que un tipo de precio agregado más adelante aparezca
  // solo, sin tener que volver a abrir este selector para activarlo.
  if(checked.length===boxes.length) localStorage.removeItem('ctrl_prec_visible_types');
  else localStorage.setItem('ctrl_prec_visible_types', JSON.stringify(checked));
  closePrecTypeModal();
  if(document.getElementById('precQ').value.trim()) doPrec();
}
// Arma la tarjeta de precio de UN resultado, con un par de tarjetas
// (precio / precio+IVA) por cada tipo visible, más Costo aparte.
function renderPGrid(r){
  const grid=document.getElementById('pGrid');
  if(!grid) return;
  const visible=getPrecVisibleTypes();
  const types=PRICE_TYPES.length?PRICE_TYPES:[{key:'mostrador',label:'Mostrador'},{key:'accesorios',label:'Accesorios'}];
  const icons=['💲','🔧','💰','🏪','📌','🔩'];

  // ── Nueva tabla horizontal: tipo de precio (filas) × sin/con IVA (cols) ──
  const rows=[];
  types.forEach((t,i)=>{
    if(visible && !visible.has(t.key)) return;
    const val=(r.byType && t.key in r.byType) ? r.byType[t.key] : (i===0?r[1]:(i===1?r[2]:0));
    const sinIva=val||0;
    const conIva=Math.round(sinIva*1.19);
    const ico=icons[i%icons.length];
    rows.push(`<tr>
      <td class="ptbl-tipo"><span class="ptbl-ico">${ico}</span>${escHtml(t.label)}</td>
      <td class="ptbl-sin-val">${cop(sinIva)}</td>
      <td class="ptbl-con-val">${cop(conIva)}</td>
    </tr>`);
  });
  if(!visible || visible.has('costo')){
    const costo=r[4]||0;
    rows.push(`<tr>
      <td class="ptbl-tipo"><span class="ptbl-ico">🏷️</span>Costo</td>
      <td class="ptbl-sin-val" style="color:var(--red)">${costo>0?cop(costo):'—'}</td>
      <td class="ptbl-con-val" style="color:var(--red)">${costo>0?cop(Math.round(costo*1.19)):'—'}</td>
    </tr>`);
  }

  grid.innerHTML=`<table class="ptable">
    <thead><tr>
      <th class="ptbl-row-lbl">Tipo de precio</th>
      <th class="ptbl-sin">Sin IVA</th>
      <th class="ptbl-con">Con IVA (19%)</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}
function renderPrecTable(){
  const tot=precRes.length,s=(precP-1)*PG,e=Math.min(s+PG,tot),pg=precRes.slice(s,e);
  document.getElementById('precBody').innerHTML=pg.map((r,i)=>{const costo=r[4]||0;const grpP=precGetGrp(r[0]);const effP=getEffectivePrice([r[1],r[2]],grpP);const effPiva=effP!==null?effP*1.19:null;const pickKey=pickKeyFromItem({cod:r[0],desc:r[3]&&r[3]!=='nan'?r[3]:'',ubi:'',stock:null,price:effPiva});const picked=PICKLIST.has(pickKey);return`<tr data-rowid="${r[0]}" class="${picked?'picked':''}"><td><button type="button" class="pickrowbtn ${picked?'on':'off'}" data-pick-key="${pickKey}" onclick='event.stopPropagation();togglePick(${JSON.stringify({cod:r[0],desc:r[3]&&r[3]!=='nan'?r[3]:'',stock:null,ubi:'',price:effPiva??null})},this)' title="${picked?'Quitar de selección':'Agregar a selección'}">${picked?'✓':'+'}</button></td><td style="color:var(--text3);font-size:9px">${s+i+1}</td><td class="tcode" style="cursor:pointer" onclick="selectPrecRef('${jsAttrSafe(r[0])}')">${r[0]}${cp(r[0])}${imgBtn(r[0],r[3]&&r[3]!=='nan'?r[3]:'')}</td><td class="tdesc">${r[3]&&r[3]!=='nan'?r[3]:'—'}</td><td style="color:var(--green);font-family:var(--mono)">${cop(r[1])}</td><td style="color:var(--amber);font-family:var(--mono)">${cop(r[2])}</td><td style="color:var(--cyan);font-family:var(--mono)">${cop(Math.round(r[1]*1.19))}</td><td style="color:var(--cyan);font-family:var(--mono)">${cop(Math.round(r[2]*1.19))}</td><td style="color:var(--red);font-family:var(--mono)">${costo>0?cop(costo):'—'}</td></tr>`;}).join('');
  document.getElementById('precPI').textContent=`${s+1}–${e} de ${tot}`;
  mkPag('precPag','precPB',Math.ceil(tot/PG),precP,p=>{set_precP(p);renderPrecTable();});
}
function selectPrecRef(cod){document.getElementById('precQ').value=cod;setPM('EXA');doPrec();}
// Botón "🖼️ Ver imágenes" de la tarjeta de resultado único de Precios.
function precShowImages(){
  if(!PREC_CURRENT) return;
  openRefDetailFromPrec(PREC_CURRENT.cod, PREC_CURRENT.desc);
  rdShowImages();   // dispara la búsqueda de una vez, sin exigir un segundo clic dentro del modal
}
function precSort(col){const map=[0,1,2,4];_tbSort(col,()=>precAsc,v=>{set_precAsc(v);},()=>precSC,v=>{set_precSC(v);},v=>{set_precP(v);},precRes,'psa',4,map,renderPrecTable);}
function precSortMob(col){
  precSort(col);
  [0,1,2,3].forEach(i=>{
    const btn=document.getElementById('pmsa'+i);
    if(!btn)return;
    btn.classList.remove('mob-sort-asc','mob-sort-desc');
    if(i===precSC) btn.classList.add(precAsc?'mob-sort-asc':'mob-sort-desc');
  });
}
function clearPrec(){set_PREC_CURRENT(null);document.getElementById('precQ').value='';document.getElementById('pCard').classList.remove('on');document.getElementById('pMulti').style.display='none';document.getElementById('precMobSort').style.display='none';setAlert('pAlert');document.getElementById('pEmpty').style.display='block';document.getElementById('pEmMsg').textContent='Ingresa un código para consultar';document.getElementById('pEmSub').textContent=Object.keys(PRICES).length.toLocaleString('es-CO')+' referencias';}

export { clearPrec, closePrecTypeModal, doPrec, openPrecTypeModal, precShowImages, precSort, precSortMob, precTypeSelectAll, savePrecTypeSelection, selectPrecRef, setPM, setPrecFilt };
