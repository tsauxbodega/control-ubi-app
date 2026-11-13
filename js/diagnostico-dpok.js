import { KAIZEN_EXT } from './state-globals.js';
import { normCode } from './file-upload.js';
import { INV_SOURCE } from './excel-respaldo.js';
// ═══ js/diagnostico-dpok.js — extraído de index.html (líneas 12937–13131 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ===================== DIAGNÓSTICO CRUZADO =====================
// ══════════════════════════════════════════════════════════════════════════════
//  DPOK — GUÍA DE ABASTECIMIENTO TOYOTA
//  calcGA(cod) decide, con la lógica del SOP-DPOK, si una referencia DEBE estar
//  en stock (GA=SI), no (GA=NO) o requiere decisión humana (GA=REVISAR).
//
//  Datos por referencia (KAIZEN_EXT, todos del SQL):
//    fr         → Frecuencia: meses de los últimos 6 con ventas (0-6)
//    mad        → Promedio mensual de ventas = (M1+…+M6)/6
//    clasifDPOK → MP | RG | COLISION | ACCESORIOS | INSUMOS | OTRO (según SubGrupo3)
//    fase_in    → 1 si la referencia está entrando en fase para vehículos nuevos
//
//  Retorna {ga:'SI'|'NO'|'REVISAR', motivo}. REVISAR cuando el SOP pide un dato
//  que el SQL no entrega — no se inventa una respuesta.
// ══════════════════════════════════════════════════════════════════════════════

/** Frecuencia: número de meses (M1-M6) con ventas > 0 */
function calcFR(cod){
  const ext = KAIZEN_EXT[cod] ?? KAIZEN_EXT[normCode(cod)];
  return ext ? ext.fr : 0;
}

/**
 * Clasificación GA (SI / NO / REVISAR) según el SOP de la Guía de Abastecimiento.
 * Se resuelve por completo cuando la regla depende solo de datos que el SQL
 * sí entrega (FR, MAD, fase, SubGrupo3). Cuando el SOP exige un dato que no
 * viaja en el extracto (antigüedad del vehículo, ciudad del concesionario,
 * "criterio del concesionario"), se marca REVISAR en vez de inventar una
 * respuesta — es más útil y más honesto.
 * @returns {{ga:'SI'|'NO'|'REVISAR', motivo:string}}
 */
function calcGA(cod){
  const ext=KAIZEN_EXT[cod] ?? KAIZEN_EXT[normCode(cod)];
  if(!ext) return {ga:'REVISAR', motivo:'Sin datos de ventas (M1-M6)'};
  const {clasifDPOK, fr, mad} = ext;

  if(ext.fase_in===1) return {ga:'SI', motivo:'En FASE de entrada (vehículo nuevo)'};
  if(INV_SOURCE==='excel') return {ga:'REVISAR', motivo:'Modo respaldo Excel — el libro no trae SubGrupo3 del ERP'};
  if(clasifDPOK===undefined) return {ga:'REVISAR', motivo:'Sin SubGrupo3 en los datos guardados — se completa al actualizar desde el SQL'};

  if(clasifDPOK==='MP'){
    if(fr>=4) return {ga:'SI', motivo:`FR=${fr} — Mantenimiento (≥4)`};
    return {ga:'NO', motivo:`FR=${fr} — Mantenimiento (≤3)`};
  }
  if(clasifDPOK==='RG'){
    if(fr>=4) return {ga:'SI', motivo:`FR=${fr} — Repuesto General (≥4)`};
    if(fr===3){
      if(mad>0.33) return {ga:'REVISAR', motivo:'FR=3, MAD>0.33 — falta antigüedad y costo unitario del SOP'};
      return {ga:'NO', motivo:'FR=3 pero MAD≤0.33'};
    }
    return {ga:'NO', motivo:`FR=${fr} — Repuesto General (≤2)`};
  }
  if(clasifDPOK==='COLISION'){
    return {ga:'REVISAR', motivo:'SOP requiere ciudad del concesionario + Lead Time (no disponibles en SQL)'};
  }
  if(clasifDPOK==='ACCESORIOS'||clasifDPOK==='INSUMOS'){
    return {ga:'REVISAR', motivo:'SOP: "bajo criterio del concesionario" — decisión manual'};
  }
  return {ga:'REVISAR', motivo:'SubGrupo3 sin clasificación DPOK reconocida'};
}

/**
 * DETECTOR DE FLUJO — compara los 3 meses más recientes (M1+M2+M3) contra
 * los 3 anteriores (M4+M5+M6) para clasificar hacia dónde va la demanda
 * de una referencia. M1 = mes más reciente, M6 = hace 6 meses — mismo
 * orden que V1-V6 en la Guía de Abastecimiento DPOK.
 *
 * Umbral de ±20% para "estable": una referencia con demanda irregular
 * mes a mes (normal en repuestos de baja rotación) no debe parpadear
 * entre SUBIENDO/BAJANDO por ruido — solo un cambio sostenido de verdad
 * cruza ese umbral.
 */
function calcFlujo(meses){
  if(!meses || meses.length<6) return {trend:'SIN_DATOS',deltaPct:null,hRecent:0,hPrior:0,frReciente:0};
  const hRecent = (meses[0]||0)+(meses[1]||0)+(meses[2]||0); // M1+M2+M3
  const hPrior  = (meses[3]||0)+(meses[4]||0)+(meses[5]||0); // M4+M5+M6
  // Conteo (no suma) de meses con venta>0 dentro del último trimestre —
  // distinto de hRecent (que suma unidades). Una devolución podría dejar
  // hRecent en 0 aunque sí hubo una venta real ese trimestre; frReciente
  // no tiene ese punto ciego porque cuenta meses, no unidades netas.
  let frReciente=0;
  for(let i=0;i<3;i++) if((meses[i]||0)>0) frReciente++;

  if(hRecent===0 && hPrior===0) return {trend:'SIN_VENTAS',deltaPct:null,hRecent,hPrior,frReciente};
  if(hPrior===0  && hRecent>0)  return {trend:'NUEVO',     deltaPct:null,hRecent,hPrior,frReciente};
  if(hRecent===0 && hPrior>0)   return {trend:'APAGADO',   deltaPct:-100,hRecent,hPrior,frReciente};

  const deltaPct=((hRecent-hPrior)/hPrior)*100;
  if(deltaPct>=20)  return {trend:'SUBIENDO',deltaPct,hRecent,hPrior,frReciente};
  if(deltaPct<=-20) return {trend:'BAJANDO', deltaPct,hRecent,hPrior,frReciente};
  return {trend:'ESTABLE',deltaPct,hRecent,hPrior,frReciente};
}

/**
 * REGULARIDAD DE LA DEMANDA — distingue ventas genuinamente recurrentes
 * de "demanda creada": referencias con pocas ventas sueltas, espaciadas
 * varios meses entre sí (ej. venta en M6, luego M3, luego M1 — con 2-3
 * meses de silencio entre cada una). FR por sí solo no distingue esto:
 * FR=3 le da igual si las 3 ventas fueron consecutivas (M3,M2,M1 — demanda
 * reciente real) o repartidas por todo el semestre (M6,M3,M1 — probable
 * venta puntual/pedido especial que no se repite con regularidad).
 *
 * Calcula el mayor "hueco" (en meses) entre dos ventas consecutivas.
 * `regular=true` cuando las ventas están razonablemente juntas (hueco
 * máximo de 1 mes — o sea, meses seguidos o casi); `regular=false` cuando
 * hay al menos un mes completo sin ninguna venta entre dos ventas.
 */
function calcRegularidad(meses){
  if(!meses || meses.length<6) return {regular:null, maxGap:null, nVentas:0};
  const idx=[];
  for(let i=0;i<6;i++) if(meses[i]>0) idx.push(i);
  if(idx.length<2) return {regular:true, maxGap:0, nVentas:idx.length}; // 0 ó 1 venta: no hay hueco que medir
  let maxGap=0;
  for(let i=1;i<idx.length;i++) maxGap=Math.max(maxGap, idx[i]-idx[i-1]);
  return {regular:maxGap<=1, maxGap, nVentas:idx.length};
}

/**
 * LIBERADOR DE UBICACIONES — solo aplica cuando stock=0. Decide, con FR
 * (6 meses), la tendencia de calcFlujo(), frReciente (meses con venta en
 * el último trimestre), el hueco de calcRegularidad() y días desde la
 * última compra, si la ubicación asignada a esa referencia se puede
 * liberar con confianza, si conviene mantenerla reservada, o si es zona
 * gris y toca decidir a mano.
 *
 * Calibrado en tres rondas contra validación real — la última comparando
 * modales de detalle uno por uno contra lo que el usuario esperaba:
 *
 * FR=1 → SIEMPRE LIBERAR, nunca MANTENER. Una sola venta en 6 meses es
 *        muy poca evidencia para reservar espacio — incluye tanto el
 *        caso "apareció una venta suelta sin historial" (tendencia
 *        NUEVO) como el caso "esa única venta ya quedó vieja"
 *        (tendencia APAGADO). Con solo 1 venta total, FR=1 nunca puede
 *        mostrar tendencia SUBIENDO/ESTABLE/BAJANDO (esas requieren
 *        actividad en ambas mitades del semestre), así que esta regla
 *        cubre el 100% de los casos FR=1 sin dejar huecos.
 *
 * frReciente≥2 → MANTENER. Si 2 o más de los últimos 3 meses tuvieron
 *        venta, es una señal reciente y concentrada — se mantiene sin
 *        importar el FR de los 6 meses completos o la tendencia.
 *
 * SUBIENDO / ESTABLE / BAJANDO — mismo trato para las tres (antes
 *        SUBIENDO devolvía MANTENER sin mirar la dispersión, dejando
 *        pasar "tendencias" armadas con apenas 2 ventas sueltas separadas
 *        por varios meses — ruido estadístico disfrazado de señal):
 *   - patrón regular (hueco máximo de 1 mes) → MANTENER.
 *   - patrón disperso con FR≥3 → REVISAR. Suficiente volumen histórico
 *     para no decidir solo, aunque estén repartidas.
 *   - patrón disperso con FR=2 y compra dentro de los últimos 90 días
 *     (UMBRAL_COMPRA_RECIENTE_DIAS) → REVISAR. El pedido reciente es una
 *     señal de interés operativo actual que el historial de ventas por
 *     sí solo no captura.
 *   - patrón disperso con FR=2 sin compra reciente → LIBERAR. Poca
 *     evidencia y nada reciente que sugiera que se necesita pronto.
 *
 * APAGADO/SIN_VENTAS → LIBERAR (cero actividad en los últimos 3 meses).
 *
 * Nota: frReciente≥2 y FR=1 son excluyentes entre sí (con solo 1 venta
 * total, frReciente nunca puede llegar a 2), así que el orden de estos
 * dos chequeos no cambia el resultado en ningún caso.
 */

// Ventana de "compra reciente" para el liberador — 90 días, la misma
// noción de "último trimestre" que ya usa frReciente/hRecent en todo
// este motor. Referencias con pedido dentro de esta ventana se tratan
// como interés operativo activo, aunque su historial de VENTAS de 6
// meses se vea débil o disperso (alguien la acaba de pedir por algo).
const UMBRAL_COMPRA_RECIENTE_DIAS = 90;

function calcLiberacion(flujoTrend, stock, regular, frReciente, fr, maxGap, diasUltCompra){
  if(stock>0) return null;
  if(fr===1) return 'LIBERAR';
  if(frReciente>=2) return 'MANTENER';

  // SUBIENDO/ESTABLE/BAJANDO: mismo trato para las tres — antes SUBIENDO
  // se mantenía ciego a la dispersión (regresaba MANTENER siempre), lo
  // cual dejaba pasar "tendencias" armadas con 2 ventas sueltas con
  // meses de por medio: ruido estadístico disfrazado de señal.
  if(flujoTrend==='SUBIENDO' || flujoTrend==='ESTABLE' || flujoTrend==='BAJANDO'){
    if(regular) return 'MANTENER';
    // Disperso (hueco>1 mes entre ventas):
    if(fr>=3) return 'REVISAR'; // suficiente volumen histórico para no decidir solo
    // fr===2 disperso (fr===1 ya resuelto arriba). La compra reciente
    // pesa más que el patrón de ventas — alguien la pidió hace poco.
    const compraReciente = diasUltCompra!=null && diasUltCompra>0 && diasUltCompra<=UMBRAL_COMPRA_RECIENTE_DIAS;
    return compraReciente ? 'REVISAR' : 'LIBERAR';
  }

  if(flujoTrend==='APAGADO' || flujoTrend==='SIN_VENTAS') return 'LIBERAR';
  // NUEVO con fr≥2 siempre cae en frReciente≥2 arriba (si hPrior=0, todas
  // las ventas de fr están en el trimestre reciente) — esta línea queda
  // como red de seguridad, no debería alcanzarse en la práctica.
  return 'REVISAR';
}

export { UMBRAL_COMPRA_RECIENTE_DIAS, calcFlujo, calcGA, calcLiberacion, calcRegularidad };
