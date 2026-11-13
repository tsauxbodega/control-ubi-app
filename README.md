# Toyota · Control UBI

```
index.html          estructura (un solo <script type="module" src="js/main.js">)
css/app.css         estilos
js/main.js          punto de entrada: carga los módulos y expone lo que usan los onclick del HTML
js/*.js             43 módulos ES (ver docs/MODULOS.md)
sw.js               Service Worker (PWA offline)
worker/             Worker de la API: verifica usuarios Firebase, roles y sirve el Excel privado (con pruebas)
tests/              prueba de arranque con módulos ES reales
build.mjs           construcción de producción (esbuild)
docs/               MODULOS.md · SEGURIDAD.md
```

## Uso
```bash
npm install
npm test            # arranque + 14 pestañas + búsqueda; y las pruebas del Worker
npm run build       # genera dist/ (un js/app.js minificado, css minificado, sw.js a medida)
npm run test:dist   # la misma prueba de arranque sobre dist/
```
- **Desarrollo:** sirve la carpeta raíz con cualquier servidor estático (los módulos ES no funcionan con `file://`).
- **Producción:** sube el **contenido de `dist/`** (menos peticiones, archivo minificado).

**Antes de publicar lee `docs/SEGURIDAD.md`**: el Worker debe desplegarse primero y el token del ERP debe rotarse.
