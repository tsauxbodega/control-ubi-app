# Arquitectura de módulos

`index_1.html` (19.866 líneas, un solo script con ~850 símbolos globales) es ahora **43 módulos ES reales** + `js/main.js`.
Cada módulo declara con `import` lo que usa y con `export` lo que otros necesitan. No quedan variables globales accidentales.

## Cómo se hizo (y por qué es de fiar)
La migración la hizo un análisis de ámbito (no a mano) sobre el código completo:
- **Imports/exports generados** a partir de las 2.041 referencias entre archivos. `esbuild` valida que todo import tenga su export (0 avisos).
- **66 variables compartidas se reasignaban desde otros archivos** (`INV`, `PRICES`, `CURRENT_USER`, `ACTIVE_BODEGA`…). Un módulo no puede reasignar
  la variable de otro, así que el dueño exporta un *setter* (`set_INV(v)`) y las 140 escrituras se reescribieron a `set_X(...)`.
  Las lecturas siguen siendo normales (los `import` son enlaces vivos).
- **Orden de carga verificado.** Hay dependencias circulares entre módulos (normal en una app que creció en un solo archivo). Se simuló el orden de evaluación
  de ES modules y se comprobó que nada use al cargar un dato que aún no existe. Resultado: un solo ajuste (`session.js` se adelanta en `main.js`). **No reordenes los imports de `main.js` sin volver a correr `npm test`.**
- **Modo estricto:** se comprobó que ninguna función declarada dentro de un bloque se use fuera de él (único caso donde "estricto" cambia el comportamiento).

## Los `onclick="..."` del HTML (deuda consciente)
El HTML tiene ~413 manejadores inline y las plantillas JS ~212 más. Reescribirlos todos es una refactorización de comportamiento, no de estructura.
Mientras existan, `js/main.js` **expone explícitamente en `window`** las 315 funciones/variables que esos atributos usan (lista calculada por análisis, no "todo").
- Si añades una función que se llama desde un `onclick`: expórtala en su módulo y súmala a `main.js`.
- Cuando migres esos `onclick` a `addEventListener`/delegación, esa lista desaparece y podrás activar una *Content-Security-Policy* estricta.

## Mapa
| Archivo | Líneas del original | Líneas ahora |
|---|---|---|
| `js/config.js` | 6164–6192 | 36 |
| `js/auth.js` | 6193–6362 | 178 |
| `js/api.js` | (nuevo) | 19 |
| `js/session.js` | 6363–6650 | 300 |
| `js/cloud-sync.js` | 6651–6755 | 116 |
| `js/admin-usuarios.js` | 6756–6890 | 142 |
| `js/state-globals.js` | 6891–7065 | 226 |
| `js/file-upload.js` | 7066–7101 | 41 |
| `js/precios-divisor.js` | 7102–7461 | 368 |
| `js/inventario-sql.js` | 7462–8327 | 873 |
| `js/excel-respaldo.js` | 8328–8736 | 425 |
| `js/ui-header-tabs.js` | 8737–8892 | 176 |
| `js/buscador.js` | 8893–9114 | 235 |
| `js/precios.js` | 9115–9335 | 231 |
| `js/ubicaciones.js` | 9336–9618 | 292 |
| `js/estantes.js` | 9619–9745 | 133 |
| `js/nostock.js` | 9746–9772 | 33 |
| `js/sugerir.js` | 9773–10617 | 853 |
| `js/utils.js` | 10618–10980 | 370 |
| `js/autoload-excel.js` | 10981–11198 | 227 |
| `js/radar-precios.js` | 11199–11390 | 199 |
| `js/radar-cambios.js` | 11391–11938 | 563 |
| `js/modales-estante-panorama.js` | 11939–12460 | 531 |
| `js/escaner.js` | 12461–12577 | 122 |
| `js/foto.js` | 12578–12791 | 225 |
| `js/init.js` | 12792–12858 | 85 |
| `js/tema-historial.js` | 12859–12936 | 88 |
| `js/diagnostico-dpok.js` | 12937–13131 | 201 |
| `js/sugerido-max.js` | 13132–13932 | 811 |
| `js/multi-codigo.js` | 13933–14137 | 212 |
| `js/export.js` | 14138–14339 | 212 |
| `js/conteo.js` | 14340–14840 | 513 |
| `js/cruce-conteo.js` | 14841–15230 | 395 |
| `js/cruce-referencias.js` | 15231–15277 | 52 |
| `js/qr-estantes.js` | 15278–15402 | 130 |
| `js/cambio-ubicacion.js` | 15403–15560 | 165 |
| `js/qr-grid.js` | 15561–15913 | 363 |
| `js/reporte-imprimible.js` | 15914–16754 | 849 |
| `js/cotizador.js` | 16755–17770 | 1028 |
| `js/mantenimientos.js` | 17771–18221 | 459 |
| `js/command-palette.js` | 18222–18567 | 356 |
| `js/pwa-ui.js` | 18568–19071 | 416 |
| `js/etiquetas.js` | 19072–19858 | 792 |

## Verificación hecha
1. `esbuild` empaqueta sin avisos → todos los imports/exports resuelven.
2. Ejecución con **semántica nativa de módulos ES** (jsdom + `vm.SourceTextModule`): 44 módulos, 0 errores.
3. **Paridad con la versión de scripts clásicos:** mismo usuario, mismo inventario de prueba; se comparan estado, 13 pestañas y 4 búsquedas → 22 puntos, 0 diferencias.
4. `npm test` repite el arranque + 14 pestañas + búsqueda; `npm run test:dist` lo hace sobre el paquete de producción minificado.

Lo que esto **no** cubre: los flujos que exigen servicios reales (Firebase, ERP, escáner de cámara, impresión). Pruébalos tras desplegar.

## Siguientes pasos recomendados (en este orden)
1. Reemplazar `onclick` por delegación de eventos (`data-action`) módulo por módulo → CSP estricta.
2. Agrupar las 66 variables compartidas en un módulo `state.js` con acceso controlado (hoy son `let` + setters).
3. Dividir `css/app.css` (3.833 líneas) por componente.
4. Partir los módulos más grandes (`sugerido-max`, `inventario-sql`, `cotizador`, `conteo`) y añadir pruebas unitarias a la lógica pura (cálculos de sugerido, parseo de ubicaciones).
