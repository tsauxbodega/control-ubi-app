import { ESTANTES, INV, SHELF_PROFILES, SM_MAP, UBI_PERFIL_MAP, UBI_TEO, cfgGrpABC, cfgGrpTam, cfgIndABC, cfgIndTam, cleanNumber, getEstanteForLocation, getShelfProfile, pendingSuggestRef, saveShelfProfiles, set_SHELF_PROFILES, set_pendingSuggestRef, set_sugSelABC, set_sugSelBin, set_sugSelSize, sugSelABC, sugSelBin, sugSelSize, updateProfileBadge } from './state-globals.js';
import { normCode } from './file-upload.js';
import { goTab } from './ui-header-tabs.js';
import { fmt, gid, jsAttrSafe, setAlert } from './utils.js';
// ═══ js/sugerir.js — extraído de index.html (líneas 9773–10617 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== SUGERIR: CONFIG =====================
function openPerfilesModal(){
  document.getElementById('perfilesOverlay').classList.add('on');
}
function closePerfilesModal(){
  document.getElementById('perfilesOverlay').classList.remove('on');
}
function setCfgTab(tab,el){
  document.querySelectorAll('.cfgtab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.cfgpanel').forEach(p=>p.classList.remove('active'));
  document.getElementById('cfgpanel-'+tab).classList.add('active');
  if(tab==='lista')renderProfileList();
}
function toggleTam(btn,set_){
  const v=btn.dataset.v;
  if(set_.has(v)){set_.delete(v);btn.classList.remove('sel');}
  else{set_.add(v);btn.classList.add('sel');}
}
function toggleABC(btn,set_){
  const v=btn.dataset.v,cls='abc-sel-'+v;
  if(set_.has(v)){set_.delete(v);btn.classList.remove(cls);}
  else{set_.add(v);btn.classList.add(cls);}
}
function buildProfile(tam,abc,zona,altura,obs){
  return{tamano:[...tam],abc:[...abc],zona:zona||'',altura:altura||'',obs:obs||''};
}
function saveGroupProfile(){
  const prefix=document.getElementById('cfgPrefixGrp').value.trim().toUpperCase();
  if(!prefix){setAlert('sugAlert','ale',true,'⚠️ Ingresa un prefijo de estante (ej: A1, B, C2)');return;}
  const zona=document.getElementById('cfgZonaGrp').value;
  const altura=document.getElementById('cfgAlturaGrp').value;
  const obs=document.getElementById('cfgObsGrp').value.trim();
  if(!cfgGrpTam.size&&!cfgGrpABC.size&&!zona&&!altura){
    setAlert('sugAlert','alw',true,'⚠️ Configura al menos un atributo: tamaño, ABC, zona o altura');return;
  }
  SHELF_PROFILES['_p_'+prefix]=buildProfile(cfgGrpTam,cfgGrpABC,zona,altura,obs);
  saveShelfProfiles();updateProfileBadge();
  const matches=UBI_TEO.filter(r=>r[0].toUpperCase().startsWith(prefix)).length;
  setAlert('sugAlert','alo',true,`✅ Perfil "${prefix}" guardado — aplica a ${matches} ubicación${matches!==1?'es':''} en UBI Teóricas`);
  setTimeout(()=>setAlert('sugAlert'),4000);
}
function saveIndProfile(){
  const loc=document.getElementById('cfgLocInd').value.trim().toUpperCase();
  if(!loc){setAlert('sugAlert','ale',true,'⚠️ Ingresa el código de la ubicación');return;}
  const zona=document.getElementById('cfgZonaInd').value;
  const altura=document.getElementById('cfgAlturaInd').value;
  const obs=document.getElementById('cfgObsInd').value.trim();
  SHELF_PROFILES[loc]=buildProfile(cfgIndTam,cfgIndABC,zona,altura,obs);
  saveShelfProfiles();updateProfileBadge();
  setAlert('sugAlert','alo',true,`✅ Perfil individual "${loc}" guardado`);
  setTimeout(()=>setAlert('sugAlert'),3000);
}
function renderProfileList(){
  const keys=Object.keys(SHELF_PROFILES);
  const container=document.getElementById('profileListBody');
  if(!container)return;
  if(!keys.length){container.innerHTML='<div style="padding:14px;text-align:center;color:var(--text3);font-family:var(--mono);font-size:10px">Sin perfiles configurados</div>';return;}
  container.innerHTML=keys.sort().map(k=>{
    const p=SHELF_PROFILES[k];
    const isGroup=k.startsWith('_p_');
    const display=isGroup?'Grupo: '+k.slice(3):k;
    const tam=p.tamano&&p.tamano.length?p.tamano.join(', '):'—';
    const abc=p.abc&&p.abc.length?p.abc.join(', '):'—';
    return`<div class="profilerow">
      <span style="color:${isGroup?'var(--amber)':'var(--cyan)'};font-weight:700;font-size:10px">${display}</span>
      <span style="color:var(--text2)">${p.zona||'—'}</span>
      <span style="color:var(--text2)">${p.altura||'—'}</span>
      <span style="color:var(--amber)">${tam}</span>
      <span style="color:var(--green)">${abc}</span>
      <button class="xbtn" style="height:22px;font-size:9px;padding:0 6px;min-width:22px" onclick="deleteProfile('${jsAttrSafe(k)}')">✕</button>
    </div>`;
  }).join('');
}
function deleteProfile(key){
  delete SHELF_PROFILES[key];saveShelfProfiles();updateProfileBadge();renderProfileList();
}
function clearAllProfiles(){
  if(!confirm('¿Borrar todos los perfiles de estantes?'))return;
  set_SHELF_PROFILES({});saveShelfProfiles();updateProfileBadge();renderProfileList();
}

// ===================== SUGERIR: TOOL =====================

// Mapeo CODIGO_SUGERENCIA → CATEGORIA para fallback
const BIN_CATEGORIA_MAP = {
  'XS-C':'XS','XS-L':'XS','S-L':'S','S-C':'S',
  'M-E':'M','M-L':'M','M-A':'M',
  'L-B':'L','L-A':'L','L-L':'L',
  'XL-E':'XL','XXL':'XXL','IRR':'IRR','VC':'VC'
};

function updateBinCounter(){
  const hasPerfil=Object.keys(UBI_PERFIL_MAP).length>0;
  const hasInv=INV.length>0;
  const binBox=document.getElementById('binSelectorBox');
  const sizeBox=document.getElementById('sizeSelectorBox');
  if(binBox)binBox.style.display=hasPerfil?'':'none';
  if(sizeBox)sizeBox.style.display=hasPerfil?'none':'';
  // Caso especial: hay INV en caché de una sesión anterior pero esta carga
  // no trajo PERFILES_ESTANTES — antes esto se avisaba en el texto largo
  // junto al header (ya no existe, se movió todo al modal), así que ahora
  // se avisa en el badge mismo, que sigue siendo visible sin abrir nada.
  // Se AGREGA al texto que ya haya puesto updateProfileBadge() (p.ej. "3
  // perfiles") en vez de reemplazarlo — perder ese conteo sería peor que
  // el problema que se estaba arreglando.
  if(!hasPerfil && hasInv){
    const badge=document.getElementById('profileBadge');
    if(badge && !badge.textContent.includes('Modo Preciso')){
      badge.textContent += ' · ⚠️ recarga para Modo Preciso';
      badge.style.background='var(--amber3)';badge.style.color='var(--amber)';badge.style.borderColor='rgba(232,156,32,.3)';
    }
  }
  if(!hasPerfil)return;
  // Contar libres por código de sugerencia
  const freeCodes={};
  for(const r of UBI_TEO){
    if(r[4]!=='LIBRE')continue;
    const ubi=String(r[0]).trim().toUpperCase();
    const p=UBI_PERFIL_MAP[ubi];
    if(!p)continue;
    const cod=p.codigo||'';
    if(cod)freeCodes[cod]=(freeCodes[cod]||0)+1;
  }
  const binCodes=['XS-C','XS-L','S-L','M-E','M-L','L-B','L-A','XL-E','XXL','IRR','VC'];
  for(const cod of binCodes){
    const el=document.getElementById('bcnt-'+cod);
    if(!el)continue;
    const cnt=freeCodes[cod]||0;
    el.textContent=cnt>0?cnt+' lib':'0';
    el.className='bincnt'+(cnt===0?' none':'');
    el.style.color=cnt>5?'var(--green)':cnt>0?'var(--amber)':'';
    // Atenuar visualmente (pero sin bloquear clic) cuando no hay libres
    const btn=el.closest('.binbtn');
    if(btn){
      if(cnt===0)btn.classList.add('empty');
      else btn.classList.remove('empty');
    }
  }
  const lbl=document.getElementById('binCounterLabel');
  const totalLibres=UBI_TEO.filter(r=>r[4]==='LIBRE').length;
  if(lbl)lbl.textContent=totalLibres+' ubicaciones libres en total';
}

function syncSugBin(bin){
  set_sugSelBin(bin||'');
  document.querySelectorAll('.binbtn').forEach(b=>{
    b.classList.remove('sel');
    if(b.dataset.bin===sugSelBin)b.classList.add('sel');
  });
  // Keep sugSelSize in sync for backward compat (modal)
  set_sugSelSize(BIN_CATEGORIA_MAP[sugSelBin]||sugSelBin||'');
  updateSugCounter();
}

function setSugBin(bin,btn){
  const next=(sugSelBin===bin&&bin!=='')?'':bin;
  syncSugBin(next);
  if(next&&UBI_TEO.length)doSuggest();
  else if(!next)document.getElementById('sugResults').innerHTML='';
}

function syncSugSize(size){
  set_sugSelSize(size||'');
  document.querySelectorAll('.sizebtn').forEach(b=>b.classList.remove('sel'));
  document.querySelectorAll('.sizebtn').forEach(b=>{ if(b.dataset.v===sugSelSize) b.classList.add('sel'); });
  updateSugCounter();
}
function syncSugABC(abc){
  set_sugSelABC(abc||'');
  document.querySelectorAll('.abcpickbtn').forEach(b=>b.classList.remove('abc-sel-A','abc-sel-B','abc-sel-C','abc-sel-D','abc-sel-E','sel'));
  document.querySelectorAll('.abcpickbtn').forEach(b=>{
    if(b.dataset.v===sugSelABC){
      if(sugSelABC) b.classList.add('abc-sel-'+sugSelABC);
      else b.classList.add('sel');
    }
  });
  updateSugCounter();
}
function setSugSize(size,btn){
  syncSugSize(size);
  if(btn)btn.classList.add('sel');
  if(UBI_TEO.length)doSuggest();
}
function setSugABC(abc,btn){
  const next=(sugSelABC===abc&&abc!=='')?'':abc;
  syncSugABC(next); // syncSugABC ya actualiza todos los botones — no repetir
  const hasSelection=sugSelBin||sugSelSize;
  if(hasSelection&&UBI_TEO.length)doSuggest();
}
function updateSugCounter(){
  const ctr=document.getElementById('sugCounter');
  const libre=document.getElementById('sugCtLibre');
  const comp=document.getElementById('sugCtComp');
  if(!UBI_TEO.length){if(ctr)ctr.style.display='none';return;}
  const freeCount=UBI_TEO.filter(r=>r[4]==='LIBRE').length;
  if(libre)libre.textContent='🟢 '+freeCount+' libres';
  const hasSelection=sugSelBin||sugSelSize;
  if(hasSelection){
    const compCount=suggestLocations(sugSelBin||sugSelSize,sugSelABC).length;
    if(comp){comp.textContent='🎯 '+compCount+' compatibles';comp.style.display='flex';}
  }else{if(comp)comp.style.display='none';}
  if(ctr)ctr.style.display='flex';
}
function resetSugerir(){
  set_sugSelSize('');set_sugSelABC('');set_sugSelBin('');set_pendingSuggestRef(null);
  document.querySelectorAll('.sizebtn').forEach(b=>b.classList.remove('sel'));
  document.querySelectorAll('.binbtn').forEach(b=>b.classList.remove('sel'));
  document.querySelectorAll('.abcpickbtn').forEach(b=>b.classList.remove('abc-sel-A','abc-sel-B','abc-sel-C','abc-sel-D','abc-sel-E','sel'));
  clearSugProd();
  document.getElementById('sugResults').innerHTML='';
  const ctr=document.getElementById('sugCounter');if(ctr)ctr.style.display='none';
  setAlert('sugAlert');
}
// Función unificada de búsqueda de producto para el sugeridor
// autoSuggest: si true llama doSuggest() al final
// abcAlreadySet: si true no pisa el ABC con el del inventario (el modal ya lo definió)
function _lookupSugProdCore(autoSuggest, abcAlreadySet){
  const q=document.getElementById('sugProdQ').value.trim().toUpperCase();
  const card=document.getElementById('sugProdCard');
  card.classList.remove('on');
  if(!q)return;
  if(!INV.length){
    if(autoSuggest)setAlert('sugAlert','alw',true,'⚠️ Carga un Excel primero');
    return;
  }
  let found=INV.filter(r=>r[0]===q);
  if(!found.length)found=INV.filter(r=>r[0].includes(q));
  if(!found.length){
    setAlert('sugAlert','alw',true,'⚠️ Código "'+q+'" no encontrado — continúa con ABC manual');
    if(autoSuggest&&(sugSelBin||sugSelSize)&&UBI_TEO.length)doSuggest();
    return;
  }
  setAlert('sugAlert');
  const r=found[0];
  document.getElementById('sugProdName').textContent=r[1]||'(Sin descripción)';
  const codeText=r[0];
  document.getElementById('sugProdCode').textContent='Ref: '+codeText+(found.length>1?' · '+found.length+' registros':'');
  document.getElementById('sugProdCode').dataset.code=codeText;
  const cpBtn=document.getElementById('sugProdCopyBtn');
  if(cpBtn)cpBtn.style.display='';
  document.getElementById('sugProdStock').textContent=fmt(found.reduce((a,c)=>a+c[2],0));
  const ubis=[...new Set(found.map(f=>f[3]).filter(u=>u&&u!=='Sin Ubicacion'))];
  document.getElementById('sugProdUbi').textContent=ubis.length?ubis.join(', '):'—';
  const abcVal=(r[4]||'').trim().toUpperCase();
  const validABC=['A','B','C','D','E'].includes(abcVal);
  if(!abcAlreadySet&&validABC){
    // Aplicar ABC del inventario: sincronizar variable y botones
    set_sugSelABC(abcVal);
    document.querySelectorAll('.abcpickbtn').forEach(b=>{
      b.classList.remove('abc-sel-A','abc-sel-B','abc-sel-C','abc-sel-D','abc-sel-E','sel');
      if(b.dataset.v===abcVal)b.classList.add('abc-sel-'+abcVal);
    });
  }
  // Mostrar ABC en la card (el actual, sea del inventario o del modal)
  const dispABC=sugSelABC||'—';
  document.getElementById('sugProdABC').textContent=dispABC;
  document.getElementById('sugProdABC').style.color=dispABC==='A'?'var(--green)':dispABC==='B'?'var(--amber)':dispABC==='C'?'var(--blue)':'var(--text3)';
  card.classList.add('on');
  // ── SM alert ──────────────────────────────────────────────────────
  const smData=SM_MAP[normCode(r[0])];
  const smWarn=document.getElementById('smWarnBanner');
  if(smWarn){
    if(smData){
      smWarn.style.display='flex';
      document.getElementById('smWarnUlt').textContent='Últ. VT: '+(smData.ult_vt||'—')+' · Últ. Compra: '+(smData.ult_compra||'—');
    }else{
      smWarn.style.display='none';
    }
  }
  if(autoSuggest&&(sugSelBin||sugSelSize)&&UBI_TEO.length)doSuggest();
}
function lookupSugProd(){_lookupSugProdCore(true,false);}
function lookupSugProdNoAutoSuggest(abcAlreadySet){_lookupSugProdCore(false,!!abcAlreadySet);}
function clearSugProd(){
  document.getElementById('sugProdQ').value='';
  document.getElementById('sugProdCard').classList.remove('on');
  const _cpb=document.getElementById('sugProdCopyBtn');if(_cpb)_cpb.style.display='none';
  const _smb=document.getElementById('smWarnBanner');if(_smb)_smb.style.display='none';
  setAlert('sugAlert');
}


function normalizeForMatch(v){
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Z0-9]+/gi,' ')
    .trim()
    .toUpperCase();
}

function inferItemTraits(code, desc){
  const txt = normalizeForMatch((code || '') + ' ' + (desc || ''));
  const has = (...parts) => parts.some(p => txt.includes(normalizeForMatch(p)));

  let sizeHint = '';
  const families = [];
  const signals = [];

  const pushFamily = (name, signal, size) => {
    if (!families.includes(name)) families.push(name);
    if (signal && !signals.includes(signal)) signals.push(signal);
    if (!sizeHint && size) sizeHint = size;
  };

  if (has('PARACHOQUE', 'CAPOT', 'PUERTA', 'PANEL', 'DEFENSA', 'CRISTAL', 'CARROCERIA', 'FENDER', 'TAPA MALETERO')) {
    pushFamily('voluminoso', 'voluminoso', 'XL');
  }
  if (has('AMORTIGUADOR', 'RADIADOR', 'MANGUERA', 'TUBO', 'CABLE', 'BATERIA', 'MOTOR', 'EMBRAGUE')) {
    pushFamily('voluminoso', 'pesado', sizeHint || 'L');
  }
  if (has('FILTRO', 'RETEN', 'SELLO', 'O RING', 'O-RING', 'SENSOR', 'BUJIA', 'CLIP', 'FUSIBLE', 'TORNILLO', 'TUERCA', 'BUJE')) {
    pushFamily('pequeno', 'pequeno', 'S');
  }
  if (has('PASTILLA', 'DISCO', 'BOMBA', 'VALVULA', 'KIT', 'TERMOSTATO', 'RODAMIENTO')) {
    pushFamily('medio', 'medio', sizeHint || 'M');
  }
  if (has('ACEITE', 'LUBRIC', 'LIQUID', 'FLUID', 'REFRIG', 'ANTICONG', 'DIESEL', 'GASOLINA', 'ADITIV', 'FREON', 'AGUA')) {
    pushFamily('liquidos', 'liquidos', sizeHint || 'M');
    if (has('BIDON', 'GALON', 'TANQUE', 'CONTENEDOR')) sizeHint = 'L';
  }

  if (!sizeHint) {
    if (txt.length <= 18) sizeHint = 'S';
    else if (txt.length <= 30) sizeHint = 'M';
    else if (txt.length <= 45) sizeHint = 'L';
    else sizeHint = 'XL';
  }

  return { text: txt, sizeHint, families, signals };
}

function buildCompatibilityNotes(profile, abcClass, traits){
  const notes = [];
  const obs = normalizeForMatch(profile?.obs || '');
  const zona = normalizeForMatch(profile?.zona || '');
  const altura = normalizeForMatch(profile?.altura || '');

  const push = (type, text) => { notes.push({type, text}); };

  if (abcClass === 'A') {
    if (zona === 'FRONTAL') push('ok', 'Zona frontal');
    else if (zona === 'CENTRAL') push('part', 'Zona central');
    else if (zona === 'TRASERA') push('warn', 'Zona trasera');
    if (altura === 'BAJO') push('ok', 'Nivel bajo');
    else if (altura === 'ALTO') push('warn', 'Nivel alto');
  } else if (abcClass === 'B') {
    if (zona === 'CENTRAL') push('ok', 'Zona central');
    else if (zona === 'FRONTAL') push('part', 'Zona frontal');
    if (altura === 'MEDIO') push('ok', 'Nivel medio');
  } else if (abcClass === 'C') {
    if (zona === 'TRASERA') push('ok', 'Zona trasera');
    if (altura === 'ALTO') push('ok', 'Nivel alto');
    else if (altura === 'MEDIO') push('part', 'Nivel medio');
  }

  if (traits.families.includes('liquidos')) {
    if (/LIQUID|ACEITE|FLUID|REFRIG|ANTICONG|DIESEL|GASOLINA|ADITIV|FREON|AGUA/.test(obs)) push('ok', 'Zona de líquidos');
    else if (/LIQUID|ACEITE|FLUID|REFRIG|ANTICONG|DIESEL|GASOLINA|ADITIV|FREON|AGUA/.test(zona)) push('ok', 'Área para líquidos');
  }
  if (traits.families.includes('voluminoso')) {
    if (/GRANDE|PESAD|VOLUMEN|CARROCERIA|PANEL|DEFENSA|RADIADOR|BATERIA/.test(obs)) push('ok', 'Perfil voluminoso');
  }
  if (traits.families.includes('pequeno')) {
    if (/PEQU|FINO|MICRO|SENSOR|FILTRO|SELLO|CLIP|BUJE/.test(obs)) push('ok', 'Perfil pequeño');
  }
  if (traits.families.includes('medio')) {
    if (/MEDIO|KIT|FRENO|DISCO|PASTILLA|BOMBA|VALVULA/.test(obs)) push('ok', 'Perfil medio');
  }

  return notes;
}

function getCandidateScore(loc, selBinOrSize, abcClass, estFilter, traits){
  if (!loc || !loc[0]) return null;
  if (estFilter && !String(loc[0]).toUpperCase().startsWith(String(estFilter).toUpperCase())) return null;

  const ubiCode = String(loc[0]).trim().toUpperCase();
  const perfil = UBI_PERFIL_MAP[ubiCode]; // datos del Excel (PERFILES_ESTANTES)
  const legacyProfile = getShelfProfile(loc[0]); // perfil manual de respaldo
  const estante = getEstanteForLocation(loc[0]);
  const estName = estante ? String(estante[0] || '') : '';
  const candidate = { loc, score: 0, reasons: [], perfil, legacyProfile, estante, estName };
  const addReason = (type, text) => { candidate.reasons.push({type, text}); };

  const hasPrecisoData = Object.keys(UBI_PERFIL_MAP).length > 0;

  if (hasPrecisoData) {
    // === MODO PRECISO: datos de PERFILES_ESTANTES ===
    if (!perfil) {
      // Ubicación sin perfil en el Excel — penalizar levemente pero no excluir
      candidate.score += 5;
      addReason('warn', 'Sin perfil en Excel');
    } else {
      const locCodigo = perfil.codigo || ''; // e.g. "XS-C", "M-E"
      // Comparar con el bin seleccionado
      if (selBinOrSize) {
        if (locCodigo === selBinOrSize) {
          candidate.score += 70;
          addReason('ok', 'BIN exacto: ' + locCodigo);
        } else {
          // Verificar si la CATEGORIA coincide (mismo tamaño, diferente dimensión)
          const selCat = BIN_CATEGORIA_MAP[selBinOrSize] || selBinOrSize;
          const locCat = perfil.cat || '';
          if (locCat === selCat) {
            candidate.score += 20;
            addReason('part', 'Misma categoría (' + locCat + '), bin diferente (' + locCodigo + ')');
          } else {
            // Tamaños adyacentes: S ↔ XS o M ↔ L
            const sizeOrder = ['XS','S','M','L','XL'];
            const iSel = sizeOrder.indexOf(selCat);
            const iLoc = sizeOrder.indexOf(locCat);
            if (iSel>=0 && iLoc>=0 && Math.abs(iSel-iLoc)===1) {
              candidate.score += 8;
              addReason('warn', 'Tamaño adyacente (' + locCat + ')');
            } else {
              return null; // Incompatible — excluir
            }
          }
        }
      }

      // ABC: usar datos del perfil de la ubicación
      if (abcClass) {
        const locABC = perfil.abc || ''; // ABC típico de esa ubicación
        if (locABC === abcClass) {
          candidate.score += 25;
          addReason('ok', 'ABC ' + abcClass + ' ideal');
        } else if (locABC) {
          const abcOrd = ['A','B','C','D','E'];
          const dist = Math.abs(abcOrd.indexOf(abcClass) - abcOrd.indexOf(locABC));
          if (dist === 1) { candidate.score += 10; addReason('part', 'ABC adyacente'); }
          else { candidate.score -= 5; addReason('warn', 'ABC no óptimo'); }
        }
      }

      // Bonus por rotación
      const rot = perfil.rot || '';
      if (rot === 'ALTA') { candidate.score += 8; addReason('ok', 'Alta rotación'); }
      else if (rot === 'MEDIA') { candidate.score += 4; addReason('info', 'Rotación media'); }

      // Zona (preferencia por ABC)
      const zona = perfil.zona || '';
      if (abcClass === 'A' && zona === 'FRONTAL') { candidate.score += 10; addReason('ok', 'Zona frontal (A)'); }
      else if (abcClass === 'A' && zona === 'TRASERA') { candidate.score -= 5; addReason('warn', 'Zona trasera (A)'); }
      else if (abcClass === 'B' && zona === 'CENTRAL') { candidate.score += 6; addReason('ok', 'Zona central (B)'); }
      else if (abcClass === 'C' && zona === 'TRASERA') { candidate.score += 6; addReason('ok', 'Zona trasera (C)'); }
      else if ((abcClass === 'D'||abcClass === 'E') && zona === 'TRASERA') { candidate.score += 8; addReason('ok', 'Zona trasera ('+abcClass+')'); }
      else if ((abcClass === 'D'||abcClass === 'E') && zona === 'FRONTAL') { candidate.score -= 6; addReason('warn', 'Zona frontal no ideal ('+abcClass+')'); }

      // Altura
      const altura = perfil.altura || '';
      if (abcClass === 'A' && altura === 'BAJO') { candidate.score += 8; addReason('ok', 'Nivel bajo (A)'); }
      else if (abcClass === 'A' && altura === 'ALTO') { candidate.score -= 3; addReason('warn', 'Nivel alto (A)'); }
      else if (abcClass === 'C' && altura === 'ALTO') { candidate.score += 5; addReason('ok', 'Nivel alto (C)'); }
      else if ((abcClass === 'D'||abcClass === 'E') && altura === 'ALTO') { candidate.score += 6; addReason('ok', 'Nivel alto ('+abcClass+')'); }
    }

  } else {
    // === MODO LEGADO: SHELF_PROFILES manuales ===
    const profileSizes = legacyProfile?.tamano?.filter(Boolean) || [];
    if (profileSizes.length) {
      if (profileSizes.includes(selBinOrSize)) {
        candidate.score += 55; addReason('ok', 'Tamaño ' + selBinOrSize);
      } else { return null; }
    } else {
      candidate.score += 10; addReason('warn', 'Sin tamaño definido');
      if (traits.sizeHint && traits.sizeHint === selBinOrSize) {
        candidate.score += 8; addReason('part', 'Sugerencia de tamaño coherente');
      }
    }
    if (abcClass && legacyProfile?.abc?.length) {
      if (legacyProfile.abc.includes(abcClass)) {
        candidate.score += 28; addReason('ok', 'ABC ' + abcClass + ' preferido');
      } else {
        const order=['A','B','C','D','E'];
        const profIdxs=legacyProfile.abc.map(a=>order.indexOf(a)).filter(i=>i!==-1);
        const qi=order.indexOf(abcClass);
        const minDist=profIdxs.length?Math.min(...profIdxs.map(i=>Math.abs(i-qi))):99;
        if(minDist===1){candidate.score+=10;addReason('part','ABC adyacente');}
        else{candidate.score-=6;addReason('warn','ABC no ideal');}
      }
    }
    // Notas de compatibilidad del perfil legacy
    if (legacyProfile) {
      const notes=buildCompatibilityNotes(legacyProfile,abcClass,traits);
      for(const note of notes){
        if(note.type==='ok')candidate.score+=14;
        else if(note.type==='part')candidate.score+=6;
        else if(note.type==='warn')candidate.score-=3;
        addReason(note.type,note.text);
      }
    }
  }

  // Ocupación del estante (aplica en ambos modos)
  if (estante) {
    const pctLib = cleanNumber(estante[4]);
    if (pctLib < 0.10) { candidate.score -= 10; addReason('warn', 'Muy ocupado'); }
    else if (pctLib < 0.20) { candidate.score += 3; addReason('part', Math.round(pctLib*100)+'% libre'); }
    else if (pctLib <= 0.45) { candidate.score += 11; addReason('ok', 'Capacidad saludable'); }
    else if (pctLib <= 0.65) { candidate.score += 7; addReason('info', 'Buena disponibilidad'); }
    else { candidate.score += 4; addReason('info', 'Amplio espacio'); }
  }

  candidate.score = Math.max(0, candidate.score);
  return candidate;
}

function diversifySuggestions(scored, maxTotal = 8, maxPerEstante = 1){
  const byEst = new Map();
  for (const cand of scored) {
    const key = cand.estName || 'SIN_ESTANTE';
    if (!byEst.has(key)) byEst.set(key, []);
    byEst.get(key).push(cand);
  }

  const groups = [...byEst.entries()]
    .map(([key, arr]) => ({ key, arr: arr.slice().sort((a,b) => b.score - a.score) }))
    .sort((a,b) => (b.arr[0]?.score || 0) - (a.arr[0]?.score || 0));

  const selected = [];
  const used = new Map();
  let depth = 0;
  while (selected.length < maxTotal) {
    let progressed = false;
    for (const g of groups) {
      const count = used.get(g.key) || 0;
      if (count >= maxPerEstante) continue;
      const cand = g.arr[depth];
      if (!cand) continue;
      selected.push(cand);
      used.set(g.key, count + 1);
      progressed = true;
      if (selected.length >= maxTotal) break;
    }
    if (!progressed) break;
    depth += 1;
  }
  return selected;
}

function summarizeFamilies(traits){
  if (!traits || !traits.families || !traits.families.length) return '—';
  const map = { liquidos:'Líquidos', voluminoso:'Voluminoso', pequeno:'Pequeño', medio:'Mediano' };
  return traits.families.map(f => map[f] || f).join(', ');
}

// Inferir tipo de BIN específico basado en nombre/código del producto
// Retorna el CODIGO_SUGERENCIA (XS-C, XS-L, S-L, M-E, M-L, L-B, L-A, XL-E, etc.)
function inferBinType(code, desc, traits){
  const txt = normalizeForMatch((code||'')+ ' '+(desc||''));
  const has = (...parts) => parts.some(p => txt.includes(normalizeForMatch(p)));

  // XS-CORTO: piezas muy pequeñas y cortas (tornillos, clips, sensores pequeños, sellos)
  if(has('TORNILLO','TUERCA','CLIP','BROCHE','ARANDELA','ANILLO','BUJE','PASADOR',
         'SENSOR','BUJIA','FUSIBLE','BOMBILLO','RETEN','SELLO ACEITE','O RING','JUNTA TORICA',
         'EMBLEMA','TERMINAL','CONDENSADOR RADIO','CINTA AIRBAG','GRASA','LUBRICANTE',
         'RETAINER','RETENEDOR','BROCHA','GOMA','TAPÓN','TAPON')){
    return 'XS-C';
  }
  // XS-LARGO: piezas muy pequeñas pero largas (filtros, pastillas freno, correas)
  if(has('FILTRO ACEITE','FILTRO COMBUSTIBLE','FILTRO AIRE','PASTILLA FRENO','PASTILLA DEL',
         'PASTILLA TRAS','PASTILLAS','CORREA ALTERN','CORREA TRAPEZ','GUAYA SEGURIDAD',
         'JUNTA TAPA CULATA','EMPAQUETADURA','EMPAQUE TAPA','EMPAQUE BOMBA')){
    return 'XS-L';
  }
  // S-LARGO: piezas pequeñas muy largas (mangueras pequeñas, cables, varillas)
  if(has('MANGUERA','CABLE PTA','CABLEADO','CABLE ESPIRAL','GUAYA FRENO','VARILLA',
         'TUBO RETORNO','TUBO DESVIO','BARRA ESTABILIZ')){
    return 'S-L';
  }
  // M-ESTÁNDAR: piezas medianas estándar (bombas, kits, válvulas, cojinetes, rotulas)
  if(has('BOMBA ACEITE','BOMBA AGUA','BOMBA COMBUSTIBLE','VALVULA','TERMOSTATO',
         'COJINETE','RODAMIENTO','BOCIN','ROTULA','KIT FRENO','KIT ACEITE',
         'POLEA','DISCO FRENO','COPA RIN','COPA RUEDA','TAPA GRASA','AMORTIGUADOR SUSPENS',
         'SEPARADOR ESPIRAL','SOPORTE AMORTIGUADOR','SOPORTE MOTOR','SOPORTE BLOQUE')){
    return 'M-E';
  }
  // M-LARGO: piezas medianas largas (empaque puertas, molduras, paneles)
  if(has('EMPAQUE PUERTA','EMPAQUE CANAL','CANAL AGUA','MOLDURA','GUARNECIDO',
         'PANEL TABLERO','PANEL CARENAJE','CONDUCTO TABLERO','DEFENSOR RADIATOR',
         'CINTA AIRBAG TIMON')){
    return 'M-L';
  }
  // L-BAJO: piezas grandes y planas (discos freno grandes, guardabarros, defensas)
  if(has('DISCO FRENO DEL','DISCO FRENO TRA','DISCO FRENO TRASERO','DISCO FRENO DELAN',
         'DEFENSA','PARACHOQUE','GUARDABARROS','ESTRIBO')){
    return 'L-B';
  }
  // L-ALTO: piezas grandes y altas (amortiguadores, resortes, alternadores)
  if(has('AMORTIGUADOR','RESORTE','ESPIRAL DEL','ESPIRAL TRA','ALTERNADOR',
         'MOTOR LIMPIAPARABRIS','TURBO ALIMENTADOR','TURBO')){
    return 'L-A';
  }
  // XL-ESTÁNDAR: piezas extra grandes
  if(has('RADIADOR','CONDENSADOR AIRE ACONDICIONADO','BATERIA','MOTOR COMPL',
         'CAJA CAMBIOS','DIFERENCIAL')){
    return 'XL-E';
  }
  // VERTICAL: piezas delgadas verticales
  if(has('PARABRISA','VIDRIO','LUNA','CRISTAL','VENTANA')){
    return 'VC';
  }

  // Aprender del inventario: si el producto tiene ubicación asignada, consultar su perfil real
  if(INV.length&&UBI_PERFIL_MAP&&Object.keys(UBI_PERFIL_MAP).length){
    const normCode_ = String(code||'').trim().toUpperCase();
    const prodRows = INV.filter(r=>r[0]===normCode_);
    for(const pr of prodRows){
      const ubi = String(pr[3]||'').trim().toUpperCase();
      if(ubi&&ubi!=='SIN UBICACION'){
        const perfil = UBI_PERFIL_MAP[ubi];
        if(perfil&&perfil.codigo)return perfil.codigo; // tipo aprendido del lugar real
      }
    }
  }
  // Fallback basado en el sizeHint de inferItemTraits
  const fallback={'XS':'XS-C','S':'S-L','M':'M-E','L':'L-B','XL':'XL-E'};
  return fallback[traits?.sizeHint||'']||'';
}

function openSuggestModal(code,desc,rowId){
  const traits = inferItemTraits(code, desc);
  const hasPerfil = Object.keys(UBI_PERFIL_MAP).length > 0;
  // Inferir tipo de BIN específico cuando hay datos del Excel
  const sugBin = hasPerfil ? (inferBinType(code, desc, traits) || sugSelBin) : '';
  const sugSizeVal = sugBin || sugSelBin || sugSelSize || traits.sizeHint || '';
  set_pendingSuggestRef({code:String(code||'').trim(),desc:String(desc||'').trim(),rowId:rowId||'',traits});
  const modal=gid('suggestModal');
  if(!modal)return;
  gid('sugModalCode').value=pendingSuggestRef.code;
  gid('sugModalDesc').value=pendingSuggestRef.desc;
  gid('sugModalSize').value=sugSizeVal;
  gid('sugModalABC').value=sugSelABC||'';
  gid('suggestModalTitle').textContent=pendingSuggestRef.code||'Preparar sugerencia';
  const binLabel = sugBin ? ` · BIN sugerido: ${sugBin}` : '';
  gid('suggestModalSub').textContent='Detectado: ' + summarizeFamilies(traits) + binLabel + ' · elige o confirma el tipo de BIN y pasamos al panel de sugerencias con el resultado listo.';
  modal.classList.add('on');
}
function closeSuggestModal(){
  set_pendingSuggestRef(null);
  const modal=gid('suggestModal');
  if(modal)modal.classList.remove('on');
}
function confirmSuggestModal(){
  const modalRef=pendingSuggestRef||{};
  const code=(gid('sugModalCode')?.value||modalRef.code||'').trim();
  const desc=(gid('sugModalDesc')?.value||modalRef.desc||'').trim();
  const inferred = modalRef.traits || inferItemTraits(code, desc);
  const size=(gid('sugModalSize')?.value||'').trim() || inferred.sizeHint || '';
  const abc=(gid('sugModalABC')?.value||'').trim();
  if(!code){
    setAlert('sugAlert','ale',true,'⚠️ No se encontró la referencia.');
    return;
  }
  if(!size){
    setAlert('sugAlert','alw',true,'⚠️ Selecciona un tipo de BIN para continuar.');
    return;
  }
  closeSuggestModal();
  // Si hay datos del Excel (PERFILES_ESTANTES), usar syncSugBin con el código exacto
  const hasPerfil = Object.keys(UBI_PERFIL_MAP).length > 0;
  if(hasPerfil && Object.prototype.hasOwnProperty.call(BIN_CATEGORIA_MAP, size)){
    syncSugBin(size);
  } else {
    syncSugSize(size);
  }
  // Aplicar ABC del modal PRIMERO (antes de lookupSugProd que puede sobreescribirlo)
  // Si el usuario eligió "Auto" en el modal, lookupSugProd lo detectará del inventario
  if(abc) syncSugABC(abc); else syncSugABC('');
  const tab=document.querySelector('.tabbar .tab[data-tab="sugerir"]');
  if(tab)goTab('sugerir',tab);
  const qel=gid('sugProdQ');
  if(qel)qel.value=code;
  // lookupSugProd detecta ABC del inventario solo si el modal estaba en "Auto"
  lookupSugProdNoAutoSuggest(!!abc); // si modal tenía ABC explícito, no lo pises del inventario
  doSuggest(); // llamada única al final, con todo el estado ya configurado
}

function suggestLocations(selBinOrSize,abcClass,estFilter){
  const traits = pendingSuggestRef?.traits || inferItemTraits(
    gid('sugProdQ')?.value || pendingSuggestRef?.code || '',
    pendingSuggestRef?.desc || ''
  );
  const freeUbis = UBI_TEO.filter(r => r && r[4] === 'LIBRE');
  const scored = freeUbis.map(loc => getCandidateScore(loc, selBinOrSize, abcClass, estFilter, traits)).filter(Boolean);
  scored.sort((a,b) => b.score - a.score || String(a.loc[0]).localeCompare(String(b.loc[0])));
  return scored;
}

// ===================== SUGERIR: RENDER =====================
function doSuggest(){
  setAlert('sugAlert');
  updateSugCounter();
  const activeSel=sugSelBin||sugSelSize; // debe declararse ANTES de cualquier uso
  if(!UBI_TEO.length){
    setAlert('sugAlert','ale',true,'❌ No hay ubicaciones teóricas. Excel necesita hoja UBITEORICAS.');
    return;
  }
  if(!activeSel){
    document.getElementById('sugResults').innerHTML='';
    return;
  }

  const estFilter=(document.getElementById('sugEstFilter')||{}).value||'';
  const ranked=suggestLocations(activeSel,sugSelABC,estFilter);
  const container=document.getElementById('sugResults');
  const freeCount=UBI_TEO.filter(r=>r&&r[4]==='LIBRE').length;
  const hasCfg=Object.keys(SHELF_PROFILES).length>0;
  const hasPrecisoData=Object.keys(UBI_PERFIL_MAP).length>0;
  const estantes=ESTANTES.length
    ? ESTANTES.map(e=>e[0]).filter(Boolean)
    : [...new Set(UBI_TEO.map(r=>String(r[0]||'').replace(/\d.*$/,'') || String(r[0]||'')[0] || ''))].filter(Boolean).sort();

  if(!ranked.length){
    // Calcular disponibilidad de BINs adyacentes para orientar al usuario
    let altSuggestions='';
    if(hasPrecisoData&&activeSel){
      const selCat=BIN_CATEGORIA_MAP[activeSel]||activeSel;
      const sizeOrder=['XS','S','M','L','XL'];
      const si=sizeOrder.indexOf(selCat);
      const adjCats=sizeOrder.filter((_,i)=>Math.abs(i-si)===1);
      const altBins=Object.entries(BIN_CATEGORIA_MAP)
        .filter(([code,cat])=>adjCats.includes(cat)||cat===selCat)
        .filter(([code])=>code!==activeSel);
      // Contar libres por BIN adyacente
      const adjCounts={};
      for(const r of UBI_TEO){
        if(r[4]!=='LIBRE')continue;
        const p=UBI_PERFIL_MAP[String(r[0]).trim().toUpperCase()];
        if(!p)continue;
        const cod=p.codigo;
        if(altBins.some(([c])=>c===cod))adjCounts[cod]=(adjCounts[cod]||0)+1;
      }
      const altParts=Object.entries(adjCounts)
        .filter(([,n])=>n>0)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,3)
        .map(([cod,n])=>`<button class="xbtn" style="font-size:10px;height:28px;padding:0 10px;border-color:var(--amber);color:var(--amber)" onclick="syncSugBin('${jsAttrSafe(cod)}');doSuggest()">${cod} · ${n} libres</button>`)
        .join('');
      if(altParts)altSuggestions=`<div style="margin-top:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-family:var(--mono);font-size:9px;color:var(--text3)">Disponibles:</span>${altParts}</div>`;
    }
    const fallback=UBI_TEO.filter(r=>r && r[4]==='LIBRE' && (!estFilter || String(r[0]||'').toUpperCase().startsWith(String(estFilter).toUpperCase()))).slice(0,5);
    if(fallback.length&&(hasCfg||hasPrecisoData)){
      container.innerHTML=`
        <div class="fallbackbanner" style="flex-direction:column;align-items:flex-start;gap:6px">
          <span>ℹ️ Sin compatibles exactos para <b>${activeSel}</b>. ${altSuggestions||'Mostrando primeras LIBRES disponibles.'}</span>
          ${altSuggestions?'':''}
        </div>
        <div class="sugcards">${fallback.map((loc,i)=>sugCard({loc,score:0,reasons:[{type:'warn',text:'Sin perfil compatible'},{type:'info',text:'Libre disponible'}],perfil:null,legacyProfile:null,estante:getEstanteForLocation(loc[0]),estName:getEstanteForLocation(loc[0])?.[0]||'—'},i,1)).join('')}</div>`;
    }else{
      container.innerHTML=`<div class="empty"><div class="ei">📭</div><div class="em">${freeCount?'Sin ubicaciones LIBRES compatibles con '+activeSel:'Sin ubicaciones LIBRES'}</div><div class="es">${hasCfg||hasPrecisoData?'Cambia el tipo de BIN o el filtro de estante':'Configura perfiles en ⚙️ para mejores resultados'}</div>${altSuggestions}</div>`;
    }
    return;
  }

  const exactTop = ranked.slice(0, 4);
  const exactCodes = new Set(exactTop.map(r => r.loc[0]));
  const varied = diversifySuggestions(ranked, 8, 1).filter(r => !exactCodes.has(r.loc[0]));
  const bestScore = ranked[0]?.score || 1;
  const variedScore = varied[0]?.score || 1;

  const estOpts='<option value="">Todos los estantes</option>'+estantes.map(e=>`<option value="${e}"${estFilter===e?' selected':''}>${e}</option>`).join('');

  let html=`<div class="sugfiltrow">
    <div class="sughtitle">🎯 ${ranked.length} compatibles · ${freeCount} LIBRES · ${new Set(ranked.map(r => r.estName || 'SIN_ESTANTE')).size} estantes</div>
    <div class="chip">📦 <span class="n">${sugSelBin||sugSelSize}</span></div>
    ${sugSelABC?`<div class="chip g">ABC <span class="n">${sugSelABC}</span></div>`:''}
    <select class="fsel" id="sugEstFilter" onchange="doSuggest()" style="margin-left:auto">
      ${estOpts}
    </select>
  </div>`;

  if(!hasCfg&&!hasPrecisoData)html+=`<div class="nocfgbanner"><div class="nci">⚙️</div><div><div class="ncm">Sin perfiles activos — resultados por disponibilidad</div><div class="ncs">Carga el Excel con hoja PERFILES_ESTANTES para sugerencias precisas y automáticas</div></div></div>`;

  html+=`
    <div class="sugfiltrow" style="margin-top:0">
      <div class="sugcount-chip libre">Mejores exactas: ${exactTop.length}</div>
      <div class="sugcount-chip comp">Variedad por estante: ${varied.length}</div>
    </div>
    <div class="sugheader" style="margin-top:8px">
      <div class="sughtitle">Más exactas</div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text3)">Prioriza compatibilidad fuerte</div>
    </div>
    <div class="sugcards">${exactTop.map((r,i)=>sugCard(r,i,bestScore)).join('')}</div>
    <div style="height:14px"></div>
    <div class="sugheader">
      <div class="sughtitle">Variedad por estante</div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--text3)">Evita que todo salga de la misma serie</div>
    </div>
    <div class="sugcards">${varied.map((r,i)=>sugCard(r,i,variedScore)).join('')}</div>
  `;

  container.innerHTML=html;
}

function sugCard(r,i,maxScore){
  const rankCls=i===0?'r1':i===1?'r2':i===2?'r3':'';
  const cardCls=i===0?'top1':i<3?'top':'';
  const MAX_SCORE=132;
  const pct=Math.min(100,Math.round((r.score/MAX_SCORE)*100));
  const barC=pct>=70?'var(--green)':pct>=40?'var(--gold)':'#505870';
  const estNm=r.estName||r.estante?.[0]||'—';
  const zona=r.perfil?.zona||r.legacyProfile?.zona||'';
  const altura=r.perfil?.altura||r.legacyProfile?.altura||'';
  const tipoBin=r.perfil?.tipo_bin||r.perfil?.codigo||'';
  const rotacion=r.perfil?.rot||'';
  const locCode=r.loc[0];
  // Familia de color del BIN
  const binFam=tipoBin.startsWith('XS')?'XS':tipoBin.startsWith('S-')?'S':tipoBin.startsWith('M-')?'M':tipoBin.startsWith('L-')?'L':tipoBin.startsWith('XL')||tipoBin==='XXL'?'XL':'ESP';
  const metaParts=[estNm&&('Est '+estNm),zona&&('Zona '+zona),altura&&('Niv '+altura)].filter(Boolean);
  const badges=(r.reasons||[]).map(rsn=>`<span class="mbadge ${rsn.type}">${rsn.text}</span>`).join('');
  return`<div class="sugcard ${cardCls}" onclick="goBusUbi('${jsAttrSafe(locCode)}')">
    <div class="sugcardhead">
      <div style="display:flex;align-items:flex-start;gap:8px;flex:1;min-width:0">
        <div class="sugrank ${rankCls}">${i+1}</div>
        <div>
          <div class="sugloc">${locCode}</div>
          <div class="suglocmeta">${metaParts.join(' · ')}</div>
        </div>
      </div>
      <div class="sugheadright">
        ${r.score>0?`<span class="sugscorenum">${r.score} pts</span>`:''}
        <button class="cpbtn" title="Copiar" onclick="event.stopPropagation();copyCode('${jsAttrSafe(locCode)}',this)" style="font-size:10px;padding:2px 6px">⎘</button>
      </div>
    </div>
    <div class="sugcardmeta">
      <div class="sugbinrow">
        ${tipoBin?`<span class="sugbintag ${binFam}">${tipoBin}</span>`:''}
        ${rotacion?`<span class="sugrottag">↻ ${rotacion}</span>`:''}
      </div>
      ${r.score>0?`<div class="sugscorewrap">
        <div class="sugscorebar"><div class="sugscorebarfill" style="width:${pct}%;background:${barC}"></div></div>
        <span class="sugscorelab" style="color:${barC}">${pct}%</span>
      </div>`:''}
    </div>
    ${badges?`<div class="matchbadges">${badges}</div>`:''}
    <div class="sugcardfoot">
      <span style="font-family:var(--mono);font-size:9px;color:var(--green);letter-spacing:.03em">● LIBRE</span>
      <span class="sugfootlink" onclick="event.stopPropagation();goBusUbi('${jsAttrSafe(locCode)}')">Ver detalle →</span>
    </div>
  </div>`;
}

export { clearAllProfiles, clearSugProd, closePerfilesModal, closeSuggestModal, confirmSuggestModal, deleteProfile, doSuggest, lookupSugProd, openPerfilesModal, openSuggestModal, resetSugerir, saveGroupProfile, saveIndProfile, setCfgTab, setSugABC, setSugBin, setSugSize, syncSugBin, toggleABC, toggleTam, updateBinCounter, updateSugCounter };
