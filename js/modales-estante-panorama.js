import { CURRENT_USER, _authResolved, waitForAppData, waitForAuthResolved } from './auth.js';
import { ESTANTES, INV, UBI_TEO, cleanNumber } from './state-globals.js';
import { computePanoramaKPIs, fetchPanoramaSnapshot, fetchShelfSnapshot } from './precios-divisor.js';
import { escHtml, jsAttrSafe } from './utils.js';
import { _qrGuestModalActive, set__qrGuestModalActive } from './radar-cambios.js';
import { CONTEO_STORE } from './conteo.js';
// ═══ js/modales-estante-panorama.js — extraído de index.html (líneas 11939–12460 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ── MODAL QR DE ESTANTE ──────────────────────────────────────────────────────
async function openQRShelfModal(name){
  const overlay=document.getElementById('qrSmOverlay');
  const card=document.getElementById('qrSmCard');
  if(!overlay||!card)return;

  // Buscar datos del estante (búsqueda insensible a mayúsculas)
  const n=String(name||'').trim().toUpperCase();

  // Mostrar el overlay con un estado de carga instantáneo. Si los datos ya
  // están en memoria (caso normal, ya logueado) esto ni se alcanza a pintar
  // porque no hay ningún await de por medio. Si no hay datos aún (QR
  // escaneado sin sesión — típico en iOS, que siempre abre en Safari), esto
  // cubre el pequeño tiempo que toma traer el snapshot público.
  overlay.classList.add('on');
  card.innerHTML=
    '<div class="qrsm-header"><div><div class="qrsm-pill">🏢 Estante · QR</div>'
    +'<div class="qrsm-name" style="font-size:26px">'+escHtml(n)+'</div>'
    +'<div class="qrsm-sub">Cargando…</div></div>'
    +'<button class="qrsm-close" onclick="closeQRShelfModal()" title="Cerrar">✕</button></div>'
    +'<div style="padding:44px 20px;text-align:center"><div class="authloadspin" style="margin:0 auto"></div></div>';

  let est=ESTANTES.find(e=>String(e[0]||'').trim().toUpperCase()===n);
  let estRowsOverride=null;    // si viene de snapshot público, ya trae las ubicaciones listas
  let conteoRowsOverride=null;

  // Ocultar la pantalla de login DE INMEDIATO si estamos en modo QR sin
  // sesión — no esperar a que el snapshot público tenga éxito. authOverlay
  // tiene mayor z-index (5000) que este modal (2000), así que si se deja
  // visible mientras se intenta el fetch, cualquier falla (permisos de
  // Firestore, red, snapshot aún no sincronizado) deja al usuario viendo
  // la pantalla de login sin ninguna pista de que el modal existe detrás.
  // Con esto, el usuario SIEMPRE ve el modal — con datos si el snapshot
  // llega, o con el mensaje de fallback + botón de login si no llega.
  if(!est && !CURRENT_USER){
    set__qrGuestModalActive(true);
    const ao=document.getElementById('authOverlay'); if(ao) ao.style.display='none';
  }

  if(!est){
    // Sin datos en memoria todavía: intentar con el snapshot público de
    // solo lectura (sin costos ni precios) para no depender de sesión.
    try{
      const snap=await fetchShelfSnapshot(n);
      if(snap){
        est=[snap.estante, snap.total, snap.ocupadas, snap.libres, snap.pctLibre];
        estRowsOverride=(snap.ubicaciones||[]).map(u=>[u.loc,u.cod,u.desc,u.stock,u.estado]);
        conteoRowsOverride=[]; // el snapshot ligero no incluye estado de conteo
      }
    }catch(e){ console.warn('[QR] fetchShelfSnapshot (1er intento) falló para',n,':',e&&e.message||e); }

    // Si seguimos sin datos Y la sesión de Firebase Auth todavía no ha
    // terminado de resolver (típico justo después de escanear un QR: este
    // modal se abre en paralelo, sin esperar a onAuthStateChanged — ver
    // comentario en handleQRParam), TODAVÍA NO asumimos "sin sesión": sería
    // un falso negativo para un usuario que sí está logueado pero cuya
    // sesión no ha terminado de restaurarse. Esperamos un momento corto y
    // reintentamos con los datos ya frescos.
    if(!est && !_authResolved){
      await waitForAuthResolved(3500);
      // El usuario pudo cerrar el modal mientras esperábamos.
      if(!overlay.classList.contains('on')) return;
      // Reintentar en memoria: si había sesión, initAppData() ya debió
      // haber poblado ESTANTES para este momento.
      est=ESTANTES.find(e=>String(e[0]||'').trim().toUpperCase()===n);
      if(!est){
        try{
          const snap=await fetchShelfSnapshot(n);
          if(snap){
            est=[snap.estante, snap.total, snap.ocupadas, snap.libres, snap.pctLibre];
            estRowsOverride=(snap.ubicaciones||[]).map(u=>[u.loc,u.cod,u.desc,u.stock,u.estado]);
            conteoRowsOverride=[];
          }
        }catch(e){ console.warn('[QR] fetchShelfSnapshot (reintento tras auth) falló para',n,':',e&&e.message||e); }
      }
    }
  }

  // Ya sabemos si hay estante o no — pero antes de decidir qué botones
  // mostrar (acciones completas vs. "Iniciar sesión para más opciones"),
  // hace falta saber con certeza si hay sesión. El bloque de arriba solo
  // esperaba a que resolviera el auth cuando "est" seguía sin encontrarse;
  // pero ahora que el snapshot público SÍ suele responder rápido, "est"
  // puede llegar ANTES de que Firebase Auth confirme la sesión — dejando
  // a un usuario ya logueado viendo el CTA de invitado por una fracción
  // de segundo que, sin este freno, quedaba congelada en el render.
  if(!_authResolved){
    await waitForAuthResolved(3500);
    if(!overlay.classList.contains('on')) return; // se cerró mientras esperábamos
  }

  // Si el usuario cerró el modal mientras se esperaba el snapshot, no seguir.
  if(!overlay.classList.contains('on')) return;

  // Helpers de color
  const pctColor=p=>
    p>=0.4?'var(--green)':p>=0.2?'var(--amber)':p>=0.1?'var(--gold)':'var(--red)';
  const urgLabel=p=>{
    if(p>=0.4)return{txt:'HOLGADO',   bg:'rgba(31,199,106,.12)',  color:'var(--green)', border:'rgba(31,199,106,.25)'};
    if(p>=0.2)return{txt:'PRECAUCIÓN',bg:'rgba(232,156,32,.12)', color:'var(--gold2)', border:'rgba(232,156,32,.25)'};
    if(p>=0.1)return{txt:'CRÍTICO',   bg:'rgba(192,57,43,.12)',   color:'var(--amber)', border:'rgba(192,57,43,.25)'};
    return       {txt:'LLENO',       bg:'rgba(232,64,64,.15)',    color:'var(--red)',   border:'rgba(232,64,64,.3)'};
  };

  // Escape seguro para usar en atributos onclick — función global jsAttrSafe()

  const now=new Date().toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});
  let inner='';

  if(est){
    const pct=Number(est[4])||0;
    const pct100=Math.round(pct*100);
    const total=Number(est[1])||0;
    const ocu=Number(est[2])||0;
    const lib=Number(est[3])||0;
    const bc=pctColor(pct);
    const urg=urgLabel(pct);
    const pOcu=total>0?Math.round((ocu/total)*100):0;
    const pLib=total>0?Math.round((lib/total)*100):0;
    const occupC=pOcu>=90?'var(--red)':pOcu>=80?'var(--amber)':pOcu>=60?'var(--gold)':'var(--blue)';

    // Conteo status — CONTEO_STORE puede estar vacío si no hay datos de conteo
    const conteoRows=conteoRowsOverride || (typeof CONTEO_STORE!=='undefined'&&CONTEO_STORE[est[0]])||[];
    const conteos=conteoRows.filter(d=>d.conteo!==null).length;
    const diffs=conteoRows.filter(d=>d.conteo!==null&&d.conteo!==d.sistema).length;

    // Bloque de info de conteo (solo si hay datos)
    const conteoInfoHtml=conteos>0
      ?('<div style="display:flex;align-items:center;gap:6px;padding:9px 18px 4px;flex-wrap:wrap">'
        +'<span style="font-family:var(--mono);font-size:9px;padding:2px 8px;border-radius:10px;background:rgba(74,142,240,.1);color:var(--blue);border:1px solid rgba(74,142,240,.2)">📋 '+conteos+' contados</span>'
        +(diffs>0?'<span style="font-family:var(--mono);font-size:9px;padding:2px 8px;border-radius:10px;background:rgba(232,64,64,.1);color:var(--red);border:1px solid rgba(232,64,64,.2)">⚠ '+diffs+' difs</span>':'')
        +'</div>')
      :'';

    const estNomHtml=escHtml(est[0]);
    const estNomJS=jsAttrSafe(est[0]);

    // Ubicaciones del estante, clasificadas: ocupadas+stock, ocupadas sin stock, libres
    const prefix2=n;
    const estRows=estRowsOverride || UBI_TEO.filter(u=>{
      const ubi=String(u[0]||'').trim().toUpperCase();
      if(!ubi.startsWith(prefix2))return false;
      const rest=ubi.slice(prefix2.length);
      return /^[A-Z]?\d/.test(rest)||/^\d/.test(rest);
    }).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));

    const conStock=[],sinStock=[],libres=[];
    estRows.forEach(u=>{
      const stk=cleanNumber(u[3]);
      const estado=String(u[4]||'').trim().toUpperCase();
      const tieneCodigo=String(u[1]||'').trim()!=='';
      if(stk>0)conStock.push(u);
      else if(tieneCodigo||estado==='OCUPADA')sinStock.push(u);
      else libres.push(u);
    });

    const renderItem=(u,dotColor,qtyColor,qtyTxt)=>
      '<div class="qrsm-proditem">'
        +'<span class="qrsm-proditem-dot" style="background:'+dotColor+'"></span>'
        +'<span class="qrsm-proditem-loc">'+escHtml(u[0])+'</span>'
        +'<div class="qrsm-proditem-body">'
          +'<div class="qrsm-proditem-code">'+(escHtml(u[1])||'—')+'</div>'
          +'<div class="qrsm-proditem-desc">'+(escHtml(u[2])||'Sin descripción')+'</div>'
        +'</div>'
        +'<span class="qrsm-proditem-qty" style="color:'+qtyColor+'">'+qtyTxt+'</span>'
      +'</div>';

    const listHtml=(rows,dotColor,qtyColor,emptyTxt,qtyFn)=>
      rows.length
        ?rows.map(u=>renderItem(u,dotColor,qtyColor,qtyFn(u))).join('')
        :'<div class="qrsm-prodempty">'+emptyTxt+'</div>';

    const html_con=listHtml(conStock,'var(--green)','var(--green)','Sin productos con stock registrados',u=>cleanNumber(u[3]));
    const html_sin=listHtml(sinStock,'var(--red)','var(--red)','No hay ubicaciones ocupadas sin stock',u=>'0');
    const html_lib=listHtml(libres,'var(--green)','var(--text3)','No hay ubicaciones libres',u=>'libre');

    const prodSectionHtml=''
      +'<div class="qrsm-prodhead"><span class="qrsm-prodhead-lbl">📦 Detalle de ubicaciones</span></div>'
      +'<div class="qrsm-prodtabs">'
        +'<div class="qrsm-prodtab active" id="qrsmTab0" onclick="qrsmSwitchTab(0)">'
          +'<span class="qrsm-prodtab-n" style="color:var(--green)">'+conStock.length+'</span>'
          +'<span class="qrsm-prodtab-lbl">Con stock</span>'
        +'</div>'
        +'<div class="qrsm-prodtab" id="qrsmTab1" onclick="qrsmSwitchTab(1)">'
          +'<span class="qrsm-prodtab-n" style="color:var(--red)">'+sinStock.length+'</span>'
          +'<span class="qrsm-prodtab-lbl">Sin stock</span>'
        +'</div>'
        +'<div class="qrsm-prodtab" id="qrsmTab2" onclick="qrsmSwitchTab(2)">'
          +'<span class="qrsm-prodtab-n" style="color:var(--text3)">'+libres.length+'</span>'
          +'<span class="qrsm-prodtab-lbl">Libres</span>'
        +'</div>'
      +'</div>'
      +'<div class="qrsm-prodlist" id="qrsmList0">'+html_con+'</div>'
      +'<div class="qrsm-prodlist" id="qrsmList1" style="display:none">'+html_sin+'</div>'
      +'<div class="qrsm-prodlist" id="qrsmList2" style="display:none">'+html_lib+'</div>';

    inner=''
      +'<div class="qrsm-header">'
        +'<div>'
          +'<div class="qrsm-pill">🏢 Estante Toyota · Auditoría</div>'
          +'<div class="qrsm-name">'+estNomHtml+'</div>'
          +'<div class="qrsm-sub">Bodega de Repuestos Genuinos</div>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">'
          +'<button class="qrsm-close" onclick="closeQRShelfModal()" title="Cerrar">✕</button>'
          +'<span class="qrsm-badge" style="background:'+urg.bg+';color:'+urg.color+';border:1px solid '+urg.border+'">'+urg.txt+'</span>'
        +'</div>'
      +'</div>'
      +'<div class="qrsm-card-body">'
      +'<div class="qrsm-sparkwrap">'
        +'<div class="qrsm-sparkbar">'
          +'<div class="qrsm-sparkbar-ocu" style="flex:'+pOcu+';background:'+occupC+';opacity:.75;min-width:'+(pOcu>0?'4':'0')+'px"></div>'
          +'<div class="qrsm-sparkbar-lib" style="flex:'+pLib+';background:var(--green);opacity:.8;min-width:'+(pLib>0?'4':'0')+'px"></div>'
        +'</div>'
        +'<div class="qrsm-sparklabels">'
          +'<span style="font-family:var(--mono);font-size:9px;color:'+occupC+'">Ocupado '+pOcu+'%</span>'
          +'<span style="font-family:var(--mono);font-size:9px;color:var(--green)">Libre '+pLib+'%</span>'
        +'</div>'
      +'</div>'
      +'<div class="qrsm-stats">'
        +'<div class="qrsm-stat"><div class="qrsm-stat-val">'+total+'</div><div class="qrsm-stat-lbl">Total</div></div>'
        +'<div class="qrsm-stat"><div class="qrsm-stat-val" style="color:'+occupC+'">'+ocu+'</div><div class="qrsm-stat-lbl">Ocupadas</div></div>'
        +'<div class="qrsm-stat"><div class="qrsm-stat-val" style="color:'+bc+'">'+lib+'</div><div class="qrsm-stat-lbl">Libres</div></div>'
        +'<div class="qrsm-stat"><div class="qrsm-stat-val" style="color:'+bc+'">'+pct100+'%</div><div class="qrsm-stat-lbl">% Libre</div></div>'
      +'</div>'
      +conteoInfoHtml
      +prodSectionHtml
      +(CURRENT_USER
        ?('<div class="qrsm-actions">'
          +'<button class="qrsm-btn" onclick="closeQRShelfModal();goEstante(\''+estNomJS+'\')">'
            +'<span class="qrsm-btn-ico">📍</span>'
            +'<span>Ver ubicaciones</span>'
          +'</button>'
          +'<button class="qrsm-btn primary" onclick="closeQRShelfModal();irConteoEstante(\''+estNomJS+'\')">'
            +'<span class="qrsm-btn-ico">📋</span>'
            +'<span>Contar estante</span>'
          +'</button>'
        +'</div>')
        :('<div class="qrsm-actions" style="grid-template-columns:1fr">'
          +'<button class="qrsm-btn primary" onclick="focusLoginFromQR()">'
            +'<span class="qrsm-btn-ico">🔑</span>'
            +'<span>Iniciar sesión para más opciones</span>'
          +'</button>'
        +'</div>')
      )
      +'<div class="qrsm-footer">'
        +'<span class="qrsm-footer-brand">Toyota · Control UBI</span>'
        +'<span class="qrsm-footer-ts">'+now+'</span>'
      +'</div>'
      +'</div>';

  } else {
    // Estante no encontrado — puede ser que datos aún no cargaron, nombre
    // incorrecto, o que no hay sesión y el snapshot público no está disponible.
    const nomHtml=escHtml(n||name);
    const hasData=ESTANTES.length>0;
    const noSession=!CURRENT_USER;
    let subMsg,bodyMsg,footMsg;
    if(hasData){
      subMsg='No encontrado en los datos';
      bodyMsg='El estante <strong>'+nomHtml+'</strong> no aparece en los datos cargados.';
      footMsg='Verifica que la hoja DASH_ESTANTES incluya este estante.';
    } else if(noSession){
      subMsg='No disponible en este momento';
      bodyMsg='No se pudo obtener una vista rápida de <strong>'+nomHtml+'</strong> sin conexión.';
      footMsg='Revisa tu conexión a internet, o inicia sesión para ver los datos completos.';
    } else {
      subMsg='Cargando datos...';
      bodyMsg='Los datos aún no han cargado. Espera un momento y vuelve a intentarlo.';
      footMsg='El archivo Excel se carga automáticamente al inicio.';
    }
    inner=''
      +'<div class="qrsm-header">'
        +'<div>'
          +'<div class="qrsm-pill">🏢 Estante · QR</div>'
          +'<div class="qrsm-name" style="font-size:26px">'+nomHtml+'</div>'
          +'<div class="qrsm-sub">'+subMsg+'</div>'
        +'</div>'
        +'<button class="qrsm-close" onclick="closeQRShelfModal()" title="Cerrar">✕</button>'
      +'</div>'
      +'<div style="padding:22px 18px;text-align:center">'
        +'<div style="font-size:32px;margin-bottom:10px;opacity:.5">📭</div>'
        +'<div style="font-family:var(--sans);font-size:13px;color:var(--text2);margin-bottom:8px">'+bodyMsg+'</div>'
        +'<div style="font-family:var(--mono);font-size:10px;color:var(--text3)">'+footMsg+'</div>'
      +'</div>'
      +'<div class="qrsm-actions" style="grid-template-columns:1fr">'
        +'<button class="qrsm-btn primary" onclick="closeQRShelfModal();goTab(\'estantes\',document.querySelector(\'.tab[data-tab=\\\'estantes\\\']\'))">'
          +'<span class="qrsm-btn-ico">🏢</span>'
          +'<span>Ver todos los estantes</span>'
        +'</button>'
      +'</div>';
  }

  card.innerHTML=inner;
  overlay.classList.add('on');
  document.body.style.overflow='hidden';
}

function closeQRShelfModal(){
  const overlay=document.getElementById('qrSmOverlay');
  if(overlay){overlay.classList.remove('on');}
  document.body.style.overflow='';
  if(_qrGuestModalActive){
    set__qrGuestModalActive(false);
    if(!CURRENT_USER){
      const ao=document.getElementById('authOverlay'); if(ao) ao.style.display='flex';
    }
  }
}

function focusLoginFromQR(){
  closeQRShelfModal();
  const email=document.getElementById('authEmail');
  if(email) setTimeout(()=>email.focus(),150);
}

// ── MODAL PANORAMA GENERAL (KPIs totales de ubicaciones y referencias) ───────
// Reutiliza el mismo overlay/card que el modal QR de estante (#qrSmOverlay,
// #qrSmCard) y su cierre (closeQRShelfModal) — mismo shell visual, contenido
// distinto. Pensado para que el auditor escanee un único QR "general" (o
// pulse el botón de la pestaña Estantes) y vea el total antes de entrar a
// analizar estante por estante.
// Arma el HTML del panel de KPIs del panorama a partir de un objeto de
// KPIs (mismo "shape" que devuelve computePanoramaKPIs() y que un doc de
// 'panorama_snapshot'). Reutilizada en los 3 casos posibles del modal:
//   'live'    → sesión activa, datos completos ya cargados en memoria.
//   'partial' → sesión activa pero ESTANTES/UBI_TEO/INV siguen cargando en
//               segundo plano; se usa el snapshot público mientras tanto.
//               Ya tiene sesión, así que puede navegar igual.
//   'guest'   → sin sesión, snapshot público. Sin botón de navegación —
//               solo puede iniciar sesión o cerrar (vuelve al login).
function renderPanoramaCard(k, mode){
  const pctColor=p=>p>=.4?'var(--green)':p>=.2?'var(--amber)':p>=.1?'var(--gold)':'var(--red)';
  const urgLabel=p=>{
    if(p>=.4)return{txt:'SALUDABLE',bg:'rgba(31,199,106,.12)',color:'var(--green)',border:'rgba(31,199,106,.25)'};
    if(p>=.2)return{txt:'PRECAUCIÓN',bg:'rgba(232,156,32,.12)',color:'var(--gold2)',border:'rgba(232,156,32,.25)'};
    if(p>=.1)return{txt:'CRÍTICO',bg:'rgba(192,57,43,.12)',color:'var(--amber)',border:'rgba(192,57,43,.25)'};
    return{txt:'SATURADO',bg:'rgba(232,64,64,.15)',color:'var(--red)',border:'rgba(232,64,64,.3)'};
  };
  const kpi=(val,lbl,color)=>
    '<div class="pano-kpi"><div class="pano-kpi-val" style="color:'+(color||'var(--text)')+'">'+val+'</div><div class="pano-kpi-lbl">'+lbl+'</div></div>';
  const group=(icon,title,kpisHtml)=>
    '<div class="pano-group"><div class="pano-group-hdr"><span>'+icon+'</span><span>'+title+'</span></div>'
    +'<div class="pano-kpi-grid">'+kpisHtml+'</div></div>';
  const now=new Date().toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});

  const pOcuGen=Number(k.pOcuGen)||0, pLibGen=Number(k.pLibGen)||0;
  const bc=pctColor(pLibGen/100), urg=urgLabel(pLibGen/100);

  const pillSuffix = mode==='live' ? ' · Auditoría' : mode==='guest' ? ' · Invitado' : ' · Vista rápida';
  const subText = mode==='partial' ? 'Cargando datos completos…' : 'Bodega de Repuestos Genuinos';

  const actionsHtml = mode==='guest'
    ? ('<div class="qrsm-actions" style="grid-template-columns:1fr">'
        +'<button class="qrsm-btn primary" onclick="focusLoginFromQR()">'
          +'<span class="qrsm-btn-ico">🔑</span><span>Iniciar sesión para más opciones</span>'
        +'</button>'
      +'</div>')
    : ('<div class="qrsm-actions" style="grid-template-columns:1fr">'
        +'<button class="qrsm-btn primary" onclick="closeQRShelfModal();goTab(\'estantes\',document.querySelector(\'.tab[data-tab=\\\'estantes\\\']\'))">'
          +'<span class="qrsm-btn-ico">🏢</span><span>Analizar por estantes</span>'
        +'</button>'
      +'</div>');

  return ''
    +'<div class="qrsm-header">'
      +'<div>'
        +'<div class="qrsm-pill">📊 Panorama General'+pillSuffix+'</div>'
        +'<div class="qrsm-name" style="font-size:22px">TOYOTA · CONTROL UBI</div>'
        +'<div class="qrsm-sub">'+subText+'</div>'
      +'</div>'
      +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">'
        +'<button class="qrsm-close" onclick="closeQRShelfModal()" title="Cerrar">✕</button>'
        +'<span class="qrsm-badge" style="background:'+urg.bg+';color:'+urg.color+';border:1px solid '+urg.border+'">'+urg.txt+'</span>'
      +'</div>'
    +'</div>'
    +'<div class="qrsm-card-body">'
    +'<div class="qrsm-sparkwrap">'
      +'<div class="qrsm-sparkbar">'
        +'<div class="qrsm-sparkbar-ocu" style="flex:'+pOcuGen+';background:var(--blue);opacity:.75;min-width:'+(pOcuGen>0?'4':'0')+'px"></div>'
        +'<div class="qrsm-sparkbar-lib" style="flex:'+Math.round(pLibGen)+';background:var(--green);opacity:.8;min-width:'+(pLibGen>0?'4':'0')+'px"></div>'
      +'</div>'
      +'<div class="qrsm-sparklabels">'
        +'<span style="font-family:var(--mono);font-size:9px;color:var(--blue)">Ocupado '+pOcuGen+'%</span>'
        +'<span style="font-family:var(--mono);font-size:9px;color:var(--green)">Libre '+pLibGen.toFixed(1)+'%</span>'
      +'</div>'
    +'</div>'
    +group('🏢','Estantes',
        kpi(k.nEst,'Total')
        +kpi(k.okEst,'✅ OK','var(--green)')
        +kpi(k.warnEst,'⚠️ Crítico',k.warnEst>0?'var(--red)':'var(--text)')
    )
    +group('📍','Ubicaciones',
        kpi(k.uTot,'Total')
        +kpi(k.uOcu,'Ocupadas','var(--blue)')
        +kpi(k.uLib,'Libres',bc)
        +kpi(pLibGen.toFixed(1)+'%','% Libre gral.',bc)
        +kpi(k.dupRefs,'Refs. duplic.',k.dupRefs>0?'#b09cff':'var(--text)')
    )
    +group('📦','Referencias',
        kpi(k.rTot,'Total inv.')
        +kpi(k.rStk,'Con stock','var(--green)')
        +kpi(k.rSinUbi,'Sin ubicación',k.rSinUbi>0?'var(--red)':'var(--text)')
        +kpi(k.rZero,'Ocup. sin stock',k.rZero>0?'var(--gold2)':'var(--text)')
    )
    +actionsHtml
    +'<div class="qrsm-footer">'
      +'<span class="qrsm-footer-brand">Toyota · Control UBI</span>'
      +'<span class="qrsm-footer-ts">'+now+'</span>'
    +'</div>'
    +'</div>';
}

async function openPanoramaModal(){
  const overlay=document.getElementById('qrSmOverlay');
  const card=document.getElementById('qrSmCard');
  if(!overlay||!card)return;

  overlay.classList.add('on');
  document.body.style.overflow='hidden';
  card.innerHTML=
    '<div class="qrsm-header"><div><div class="qrsm-pill">📊 Panorama General</div>'
    +'<div class="qrsm-name" style="font-size:22px">TOYOTA · CONTROL UBI</div>'
    +'<div class="qrsm-sub">Cargando…</div></div>'
    +'<button class="qrsm-close" onclick="closeQRShelfModal()" title="Cerrar">✕</button></div>'
    +'<div style="padding:44px 20px;text-align:center"><div class="authloadspin" style="margin:0 auto"></div></div>';

  // Igual que en openQRShelfModal: no asumir "sin sesión" hasta que Firebase
  // Auth termine de resolver — evita un falso negativo justo tras escanear.
  if(!_authResolved){
    await waitForAuthResolved(3500);
    if(!overlay.classList.contains('on'))return; // se cerró mientras esperábamos
  }

  if(!CURRENT_USER){
    set__qrGuestModalActive(true);
    const ao=document.getElementById('authOverlay'); if(ao)ao.style.display='none';

    // El panorama SÍ tiene ahora un snapshot público — UN SOLO documento con
    // los totales (ver syncShelfSnapshots/computePanoramaKPIs), no uno por
    // estante, así que no suma ~cientos de escrituras extra por sync. Se
    // intenta usarlo para dar una vista rápida de invitado; si todavía no
    // existe (nadie con sesión ha sincronizado desde que se activó esto, o
    // las reglas de 'panorama_snapshot' aún no están publicadas), se cae al
    // pedido de login de siempre.
    let psnap=null;
    try{ psnap=await fetchPanoramaSnapshot(); }catch(e){ console.warn('[Panorama] fetchPanoramaSnapshot falló:', e&&e.message||e); }
    if(!overlay.classList.contains('on'))return; // se cerró mientras esperábamos

    if(psnap){ card.innerHTML=renderPanoramaCard(psnap,'guest'); return; }

    // Sin snapshot disponible todavía: mismo pedido de login de siempre.
    card.innerHTML=
      '<div class="qrsm-header"><div><div class="qrsm-pill">📊 Panorama General</div>'
      +'<div class="qrsm-name" style="font-size:22px">TOYOTA · CONTROL UBI</div>'
      +'<div class="qrsm-sub">Requiere sesión</div></div>'
      +'<button class="qrsm-close" onclick="closeQRShelfModal()" title="Cerrar">✕</button></div>'
      +'<div style="padding:22px 18px;text-align:center">'
        +'<div style="font-size:32px;margin-bottom:10px;opacity:.5">🔒</div>'
        +'<div style="font-family:var(--sans);font-size:13px;color:var(--text2)">Aún no hay una vista rápida disponible sin sesión. Inicia sesión para calcular los totales del panorama.</div>'
      +'</div>'
      +'<div class="qrsm-actions" style="grid-template-columns:1fr">'
        +'<button class="qrsm-btn primary" onclick="focusLoginFromQR()"><span class="qrsm-btn-ico">🔑</span><span>Iniciar sesión</span></button>'
      +'</div>';
    return;
  }
  if(!overlay.classList.contains('on'))return;

  if(!ESTANTES.length && !UBI_TEO.length && !INV.length){
    // BUG QUE ESTO CORRIGE: justo tras loguearse desde un QR, _authResolved
    // ya está en true (se fija apenas se confirma el doc de 'usuarios'),
    // pero ESTANTES/UBI_TEO/INV se llenan después, vía
    // hydrateUserCloudData()+initAppData(), que tardan un poco más en
    // responder. Antes esto mostraba de una vez "los datos aún no están
    // cargados" sin volver a intentarlo — por eso con sesión se veía roto
    // mientras que sin sesión (que lee directo el snapshot de Firestore, sin
    // depender de este estado local) sí funcionaba. Se espera un poco antes
    // de rendirse.
    await waitForAppData(4500);
    if(!overlay.classList.contains('on'))return;
  }

  if(!ESTANTES.length && !UBI_TEO.length && !INV.length){
    // Los datos completos siguen sin llegar tras la espera: en vez de dejar
    // al usuario mirando una pantalla vacía, se usa el mismo snapshot
    // público que ven los invitados — así al menos hay totales (aunque no
    // sean del segundo exacto) mientras el resto termina de cargar en
    // segundo plano, y como ya hay sesión puede navegar igual.
    let fallbackSnap=null;
    try{ fallbackSnap=await fetchPanoramaSnapshot(); }catch(e){ console.warn('[Panorama] fetchPanoramaSnapshot (fallback con sesión) falló:', e&&e.message||e); }
    if(!overlay.classList.contains('on'))return;

    if(fallbackSnap){ card.innerHTML=renderPanoramaCard(fallbackSnap,'partial'); return; }

    card.innerHTML=
      '<div class="qrsm-header"><div><div class="qrsm-pill">📊 Panorama General</div>'
      +'<div class="qrsm-name" style="font-size:22px">TOYOTA · CONTROL UBI</div>'
      +'<div class="qrsm-sub">Cargando datos…</div></div>'
      +'<button class="qrsm-close" onclick="closeQRShelfModal()" title="Cerrar">✕</button></div>'
      +'<div style="padding:22px 18px;text-align:center">'
        +'<div style="font-size:32px;margin-bottom:10px;opacity:.5">📭</div>'
        +'<div style="font-family:var(--sans);font-size:13px;color:var(--text2)">Los datos aún no han cargado. Espera un momento y vuelve a intentarlo.</div>'
      +'</div>'
      +'<div class="qrsm-actions" style="grid-template-columns:1fr">'
        +'<button class="qrsm-btn primary" onclick="openPanoramaModal()"><span class="qrsm-btn-ico">🔄</span><span>Reintentar</span></button>'
      +'</div>';
    return;
  }

  card.innerHTML=renderPanoramaCard(computePanoramaKPIs(),'live');
}

function qrsmSwitchTab(idx){
  for(let i=0;i<3;i++){
    const tab=document.getElementById('qrsmTab'+i);
    const list=document.getElementById('qrsmList'+i);
    if(!tab||!list)continue;
    if(i===idx){tab.classList.add('active');list.style.display='block';}
    else{tab.classList.remove('active');list.style.display='none';}
  }
}

export { closeQRShelfModal, focusLoginFromQR, openPanoramaModal, openQRShelfModal, qrsmSwitchTab };
