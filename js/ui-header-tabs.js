import { canAccessTab } from './auth.js';
import { renderUsersTable } from './admin-usuarios.js';
import { BM, ESTANTES, INV, NOSTOCK_UBI, PM, PRICES, UBI_TEO, UF, _navigatingBack, busP, navHistory, nsP, precP, set_BM, set_PM, set_UF, set__navigatingBack, set_busP, set_nsP, set_precP, set_uP, sugSelBin, sugSelSize, uP, updateProfileBadge } from './state-globals.js';
import { doSearch, renderBusEmpty } from './buscador.js';
import { clearPrec, doPrec } from './precios.js';
import { doUbi, renderUbi } from './ubicaciones.js';
import { renderEstantes } from './estantes.js';
import { doNS, renderNS } from './nostock.js';
import { doSuggest, updateSugCounter } from './sugerir.js';
import { getDupUbis, set } from './utils.js';
import { startFreshTicker, updateFreshBadge } from './autoload-excel.js';
import { renderNovedades } from './radar-cambios.js';
import { runDiagnostico } from './sugerido-max.js';
import { populateEstanteSelects } from './export.js';
import { CONTEO_CURRENT, CONTEO_MODE, buildConteoshelfGrid, renderConteo, renderConteoDiffsOnly } from './conteo.js';
import { actualizarSelectCruces } from './qr-grid.js';
import { centerActiveTab } from './pwa-ui.js';
// ═══ js/ui-header-tabs.js — extraído de index.html (líneas 8737–8892 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== UPDATE UI =====================
// Contadores del header (refs · precios, chip de fecha, foot, KPIs de
// UBI/Estantes/Stock-0) — SIEMPRE seguro de llamar: solo escribe texto/
// números, nunca re-renderiza tablas ni toca lo que el usuario esté
// viendo o escribiendo. Antes esto vivía fusionado dentro de updateUI(),
// que TAMBIÉN vuelve a correr doSearch/doUbi/doNS/doPrec — y por eso
// nadie se atrevía a llamar updateUI() en cada refresco silencioso de
// SQL (podía saltar el scroll o pisar una búsqueda en curso). Resultado:
// processFlatInvRows() (SQL) nunca llamaba a NADA de esto, así que el
// número del header ("1234 refs · 5678 precios") solo se actualizaba
// cuando el EXCEL también cambiaba — y el Excel cambia con mucha menos
// frecuencia que el stock en SQL, así que el header podía quedarse
// desactualizado por horas aunque el inventario ya se hubiera refrescado
// varias veces en segundo plano. Separado así, cada refresco de SQL
// (inicial y los silenciosos de scheduleReload) puede llamar a esta
// función sola, sin arriesgarse a interrumpir la vista activa.
function updateHeaderStats(){
  const conStk=INV.filter(r=>r[2]>0).length;
  const sinUbi=INV.filter(r=>r[3]==='Sin Ubicacion').length;
  set('sTot',INV.length);set('sStk',conStk);set('sSUbi',sinUbi);
  const ts=new Date().toLocaleString('es-CO');
  document.getElementById('hstattext').textContent=INV.length+' refs · '+Object.keys(PRICES).length.toLocaleString('es-CO')+' precios';
  document.getElementById('hdot').classList.add('on');
  const cf=document.getElementById('chipFecha');
  if(ts)cf.innerHTML='<span class="n">'+ts+'</span>';
  const usel=document.getElementById('uEstante');
  usel.innerHTML='<option value="">Estante: Todos</option>';
  if(ESTANTES.length){
    ESTANTES.slice().sort((a,b)=>a[0].localeCompare(b[0])).forEach(e=>{const o=document.createElement('option');o.value=e[0];o.textContent='Estante '+e[0];usel.appendChild(o);});
  }else{
    const ests=[...new Set(UBI_TEO.map(r=>{const m=r[0].match(/^[A-Za-z]+\d+/);return m?m[0]:(r[0].slice(0,2)||r[0][0]);}))].sort();
    ests.forEach(e=>{const o=document.createElement('option');o.value=e;o.textContent=e;usel.appendChild(o);});
  }
  set('uTot',UBI_TEO.length);
  set('uOcu',UBI_TEO.filter(r=>r[4]==='OCUPADA').length);
  set('uLib',UBI_TEO.filter(r=>r[4]==='LIBRE').length);
  set('uZero',NOSTOCK_UBI.length);
  set('uDup',(()=>{const d=getDupUbis();return INV.filter(r=>d.has(r[3])).length;})());
  const pctLib=UBI_TEO.length?((UBI_TEO.filter(r=>r[4]==='LIBRE').length/UBI_TEO.length)*100).toFixed(1):'—';
  set('uPctLib',pctLib+(pctLib!=='—'?'%':''));
  set('nsTot',NOSTOCK_UBI.length);
  set('eTot',ESTANTES.length);
  set('eOk',ESTANTES.filter(r=>r[4]>=0.2).length);
  set('eWarn',ESTANTES.filter(r=>r[4]<0.2).length);
  set('eUbiTot',UBI_TEO.length);
  const ePctLib=UBI_TEO.length?((UBI_TEO.filter(r=>r[4]==='LIBRE').length/UBI_TEO.length)*100).toFixed(1):'—';
  set('ePctLib',ePctLib+(ePctLib!=='—'?'%':''));
  document.getElementById('foot').textContent='CONTROL_UBI · '+ts+' · '+INV.length+' refs inventario';
  updateFreshBadge(Date.now());
  startFreshTicker();
  if(sugSelSize||sugSelBin)updateSugCounter();
}

function updateUI(){
  updateHeaderStats();
  if(document.getElementById('busQ')?.value.trim()) doSearch(); else renderBusEmpty();
  if(document.getElementById('ubiQ')?.value.trim() || document.getElementById('uEstante')?.value || UF!=='ALL') doUbi(); else renderUbi();
  if(document.getElementById('nsQ')?.value.trim()) doNS(); else renderNS();
  if(document.getElementById('precQ')?.value.trim()) doPrec(); else if(!document.getElementById('pCard').classList.contains('on')) clearPrec();
  renderEstantes();
  populateEstanteSelects();
}

// ===================== TABS =====================
function goTab(id,el){
  if(!canAccessTab(id)) return; // bloqueo por rol
  if(id==='usuarios') renderUsersTable();
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const panel=document.getElementById('panel-'+id);
  if(panel) panel.classList.add('active');
  if(el)el.classList.add('active');
  centerActiveTab();

  // Render/refresh al entrar a cada módulo para evitar vistas vacías
  if(id==='estantes'){
    if(typeof renderEstantes==='function') renderEstantes();
  } else if(id==='sugerir'){
    if(typeof updateProfileBadge==='function') updateProfileBadge();
    if(typeof updateSugCounter==='function') updateSugCounter();
    if(typeof doSuggest==='function' && (sugSelBin||sugSelSize)) doSuggest();
  } else if(id==='novedades'){
    if(typeof renderNovedades==='function') renderNovedades();
  } else if(id==='exportar'){
    if(typeof populateEstanteSelects==='function') populateEstanteSelects();
    if(typeof actualizarSelectCruces==='function') actualizarSelectCruces();
  } else if(id==='conteo'){
    if(typeof buildConteoshelfGrid==='function') buildConteoshelfGrid();
    if(typeof CONTEO_MODE!=='undefined'){
      if(CONTEO_MODE==='diffs' && typeof renderConteoDiffsOnly==='function') renderConteoDiffsOnly();
      else if(CONTEO_CURRENT && CONTEO_CURRENT.length && typeof renderConteo==='function') renderConteo();
    }
  } else if(id==='diagnostico'){
    if(typeof runDiagnostico==='function') runDiagnostico();
  }
  const activePanel=document.querySelector('.panel.active');
  if(!activePanel)return;
  const panelId=activePanel.id.replace('panel-','');
  const state={panel:panelId,busQ:document.getElementById('busQ')?.value||'',precQ:document.getElementById('precQ')?.value||'',ubiQ:document.getElementById('ubiQ')?.value||'',nsQ:document.getElementById('nsQ')?.value||'',BM,PM,UF,fStk:document.getElementById('fStk')?.value||'',fUbi:document.getElementById('fUbi')?.value||'',uEstante:document.getElementById('uEstante')?.value||'',busP,precP,uP,nsP,selectedRowId:null};
  if(!_navigatingBack){navHistory.push(state);updateBackButton();}
}
function restoreNavState(state){
  const tab=document.querySelector(`.tabbar .tab[data-tab="${state.panel}"]`);
  if(tab)goTab(state.panel,tab);
  document.getElementById('busQ').value=state.busQ||'';
  document.getElementById('precQ').value=state.precQ||'';
  document.getElementById('ubiQ').value=state.ubiQ||'';
  document.getElementById('nsQ').value=state.nsQ||'';
  set_BM(state.BM);updateBMButtons();set_PM(state.PM);updatePMButtons();set_UF(state.UF);updateUFButtons();
  document.getElementById('fStk').value=state.fStk;
  document.getElementById('fUbi').value=state.fUbi;
  document.getElementById('uEstante').value=state.uEstante;
  set_busP(state.busP||1);set_precP(state.precP||1);set_uP(state.uP||1);set_nsP(state.nsP||1);
  if(state.panel==='bus')doSearch();
  else if(state.panel==='prec'){if(state.precQ)doPrec();else clearPrec();}
  else if(state.panel==='ubi')doUbi();
  else if(state.panel==='estantes')renderEstantes();
  else if(state.panel==='nostock')doNS();
  if(state.selectedRowId)setTimeout(()=>highlightRow(state.panel,state.selectedRowId),100);
}
function goBack(){
  // El último item del historial es el estado ACTUAL.
  // Necesitamos el anterior: sacamos el actual, miramos el nuevo último.
  if(navHistory.length===0)return;
  navHistory.pop(); // descartar estado actual
  updateBackButton();
  if(navHistory.length===0)return;
  const prev=navHistory[navHistory.length-1]; // peek: NO sacar — quedará como "actual"
  if(!prev)return;
  set__navigatingBack(true);
  restoreNavState(prev);
  set__navigatingBack(false);
}
function highlightRow(panelId,rowId){
  let tb;
  if(panelId==='bus')tb=document.getElementById('busBody');
  else if(panelId==='ubi')tb=document.getElementById('uBody');
  else if(panelId==='prec')tb=document.getElementById('precBody');
  else return;
  if(!tb)return;
  const row=tb.querySelector(`tr[data-rowid="${rowId}"]`);
  if(row){row.classList.add('highlight-row');row.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>row.classList.add('fade'),2000);setTimeout(()=>{row.classList.remove('highlight-row','fade');},2600);}
}
function updateBackButton(){const btn=document.getElementById('backBtn');if(btn)btn.classList.toggle('visible',navHistory.length>0);}
function pushNavState(rowId=null){
  const ap=document.querySelector('.panel.active');
  if(!ap)return;
  const panelId=ap.id.replace('panel-','');
  const state={panel:panelId,busQ:document.getElementById('busQ')?.value||'',precQ:document.getElementById('precQ')?.value||'',ubiQ:document.getElementById('ubiQ')?.value||'',nsQ:document.getElementById('nsQ')?.value||'',BM,PM,UF,fStk:document.getElementById('fStk')?.value||'',fUbi:document.getElementById('fUbi')?.value||'',uEstante:document.getElementById('uEstante')?.value||'',busP,precP,uP,nsP,selectedRowId:rowId};
  navHistory.push(state);
  updateBackButton();
}
function updateBMButtons(){document.getElementById('bm-par').classList.toggle('on',BM==='PAR');document.getElementById('bm-exa').classList.toggle('on',BM==='EXA');}
function updatePMButtons(){document.getElementById('pm-exa').classList.toggle('on',PM==='EXA');document.getElementById('pm-par').classList.toggle('on',PM==='PAR');}
function updateUFButtons(){document.getElementById('um-all').classList.toggle('on',UF==='ALL');document.getElementById('um-lib').classList.toggle('on',UF==='LIBRE');document.getElementById('um-ocu').classList.toggle('on',UF==='OCUPADA');document.getElementById('um-dup').classList.toggle('on',UF==='DUP');}

export { goBack, goTab, pushNavState, updateBMButtons, updateBackButton, updateHeaderStats, updatePMButtons, updateUFButtons, updateUI };
