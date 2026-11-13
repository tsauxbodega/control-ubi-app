import { ESTANTES, INV, KAIZEN_EXT, NOSTOCK_UBI, PRICES, SHELF_PROFILES, SM_MAP, UBI2_MAP, UBI_PERFIL_MAP, UBI_TEO, _dupUbisCache, loadFromStorage, loadShelfProfiles, set_ESTANTES, set_INV, set_KAIZEN_EXT, set_NOSTOCK_UBI, set_PRICES, set_SHELF_PROFILES, set_SM_MAP, set_UBI2_MAP, set_UBI_PERFIL_MAP, set_UBI_TEO, set__dupUbisCache, updateProfileBadge } from './state-globals.js';
import { buildPriceIndex } from './file-upload.js';
import { applyPriceDivisors, watchPriceDiv } from './precios-divisor.js';
import { loadInvFromSQL } from './inventario-sql.js';
import { updateBackButton, updateUI } from './ui-header-tabs.js';
import { renderBusEmpty } from './buscador.js';
import { renderNS } from './nostock.js';
import { _dupCodsCache, renderPickUI, set, set__dupCodsCache } from './utils.js';
import { startFreshTicker, updateFreshBadge } from './autoload-excel.js';
import { startRadarPriceListener } from './radar-precios.js';
import { handleQRParam, updateNovBadge } from './radar-cambios.js';
import { updateHistBtn } from './tema-historial.js';
import { relocLoad } from './cambio-ubicacion.js';
import { startMantListener } from './mantenimientos.js';
import { initPWA, initTabbarFade } from './pwa-ui.js';
// ═══ js/init.js — extraído de index.html (líneas 12792–12858 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== INIT =====================
// ===================== INIT (se ejecuta tras autenticar, no en window.onload) =====================
function initAppData(){
  set_SHELF_PROFILES(loadShelfProfiles());
  updateProfileBadge();
  relocLoad(); // caché local rápida; watchSharedReloc() la reconcilia con Firestore en cuanto llega el primer snapshot
  watchPriceDiv(); // divisores de precio (tinas/cajas) compartidos por todo el equipo
  renderPickUI(); // PICKLIST ya se cargó (nube/local) en hydrateUserCloudData()
  const stored=loadFromStorage();
  if(stored&&stored.inv&&stored.inv.length){
    set_INV(stored.inv||[]);set_PRICES(stored.prices||{});buildPriceIndex();applyPriceDivisors();
    set_UBI_TEO(stored.ubi||[]);set_ESTANTES(stored.estantes||[]);set_NOSTOCK_UBI(stored.nostock||[]);
    // BUG que esto corrige: getDupUbis()/getDupCods() cachean su resultado en
    // _dupUbisCache/_dupCodsCache, y esa caché antes SOLO se invalidaba
    // dentro de processExcel(). Si algo llegaba a llamarlas antes de este
    // punto en la sesión (o si autoLoadExcel() decide más abajo que el Excel
    // remoto no cambió y por eso NO vuelve a llamar processExcel()), la
    // caché se quedaba pegada — por eso "DUP" podía verse en 0 aunque sí
    // hubiera ubicaciones duplicadas en los datos recién restaurados.
    set__dupUbisCache(null); set__dupCodsCache(null);
    // Restaurar UBI_PERFIL_MAP (Modo Preciso) desde caché
    if(stored.perfilMap&&Object.keys(stored.perfilMap).length){
      set_UBI_PERFIL_MAP(stored.perfilMap);
    }
    if(stored.smMap&&Object.keys(stored.smMap).length){
      set_SM_MAP(stored.smMap);
    }
    if(stored.kaizenExt&&Object.keys(stored.kaizenExt).length){
      set_KAIZEN_EXT(stored.kaizenExt);
    }
    if(stored.ubi2map&&Object.keys(stored.ubi2map).length){
      set_UBI2_MAP(stored.ubi2map);
    }
    updateUI();
    renderPickUI();
    updateFreshBadge(stored.ts||0);
    startFreshTicker();
    const age=Math.round((Date.now()-(stored.ts||0))/60000);
    document.getElementById('hstattext').textContent=INV.length+' refs · '+Object.keys(PRICES).length.toLocaleString('es-CO')+' precios · caché '+age+'min';
    // Si venimos de un QR físico (escaneo), no esperamos a que termine la
    // descarga de red en autoLoadExcel() para mostrar el modal — con los
    // datos en caché ya alcanza. Esto es lo que realmente hacía sentir
    // lento el escaneo: cada apertura de link nuevo esperaba la ida y
    // vuelta completa a la red (y el reprocesamiento del Excel) antes de
    // mostrar nada. handleQRParam() se protege con _qrHandled, así que la
    // llamada posterior dentro de autoLoadExcel() no hace nada si esta ya
    // mostró el modal.
    handleQRParam();
  }else{
    renderBusEmpty();renderNS();
    set('pEmSub','Carga un Excel para comenzar');
  }
  updateBackButton();
  ['bus','prec','ubi'].forEach(updateHistBtn);
  updateNovBadge();
  startRadarPriceListener();
  // loadInvFromSQL siempre llama autoLoadExcel al terminar, así que en el
  // arranque normal no hace falta dispararlo aquí también. Pero si SQL falla
  // y quedamos con datos de localStorage, autoLoadExcel NUNCA se llamaría
  // (porque loadInvFromSQL no terminó bien). Se protege con un flag para
  // que solo corra una vez por sesión y no se solape con la llamada de SQL.
  loadInvFromSQL();
  initPWA();       // PWA: manifest, icono, install prompt, service worker
  initTabbarFade(); // Indicador de scroll en tabbar
  startMantListener(); // Mantenimientos: combos de repuestos por vehículo
}

export { initAppData };
