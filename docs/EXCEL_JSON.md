# Excel → JSON automático con GitHub (carga mucho más rápida)

**Qué hace.** Cada vez que subes un `CONTROL_UBI_cache.xlsx` nuevo al repositorio de datos, GitHub lo convierte solo a
`CONTROL_UBI_cache.json` (en la rama `datos-json` del mismo repo, un solo commit que se reemplaza: no engorda el historial) con la misma lógica que usa la app (`js/excel-parse.js`). El Worker de Cloudflare lo
sirve en `/api/excel-json` y la app lo prefiere: se baja un archivo pequeño y comprimido y **no hay que interpretar el
.xlsx en cada dispositivo**. Si el JSON no existe, no coincide con el .xlsx actual o falla algo, la app usa el .xlsx de
siempre (que ahora se lee en un Web Worker, sin congelar la pantalla). Nada se rompe si algo de esto no está activado.

## Activarlo (una sola vez, ~5 minutos)
1. En `tsauxbodega/control-ubi-datos` crea el archivo `.github/workflows/excel-a-json.yml` con el contenido de
   `docs/github-actions/excel-a-json.yml` (de este repositorio). Es un solo archivo.
2. Pestaña **Actions → Excel a JSON → Run workflow** para generar el primer JSON (o sube un Excel nuevo).
   Debe terminar en verde y aparecer la rama `datos-json` con `CONTROL_UBI_cache.json`.
3. Despliega el Worker (`worker/`) para que exista la ruta `/api/excel-json`
   (`cd worker && npx wrangler deploy`). Si tu JSON no se llama igual que el .xlsx define `GITHUB_JSON_FILE`; si usas otra rama, `GITHUB_JSON_REF` (por defecto `datos-json`).
4. Despliega la app (Cloudflare Pages, rama `main`). Abre la app: en las DevTools → Network debe verse `excel-json`
   y ya no la descarga del `.xlsx`.

## Cómo se mantiene al día
- El JSON guarda el tamaño y el *hash* del .xlsx del que salió. En cada revisión la app compara con el .xlsx que hay hoy en
  el repositorio: si no coinciden (el flujo aún está convirtiendo, o falló), **usa el .xlsx** y vuelve al JSON cuando esté al día.
- Si el libro llega roto o sin las hojas principales, el conversor falla (flujo en rojo) y **no sobrescribe** el último JSON bueno.
- Seguridad: el repositorio de datos sigue privado; el JSON solo lo entrega el Worker a usuarios con sesión y MFA, igual que el .xlsx.
  El flujo descarga el conversor del repositorio público de la app; cuando quieras fijarlo, cambia `ref: main` por una etiqueta o SHA.

## Cuota de Firestore
Los resúmenes de estantes para el QR sin sesión (`estante_snapshots`, `panorama_snapshot`) los escribe **un solo cliente por
versión de datos**: el primero que carga los datos nuevos reclama esa versión con una transacción en `panorama_snapshot/current`
y los demás no escriben nada. Todos siguen viendo los datos completos porque los leen del Excel/JSON, no de esos resúmenes.
Si quien reclamó no termina (se cierra la pestaña, sin red), a los 10 min otro cliente retoma. La carga manual de un archivo
local escribe como antes.
