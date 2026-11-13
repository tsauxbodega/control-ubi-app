# Control UBI — despliegue modular en Cloudflare

Esta preparación conserva el Worker `tcu-api-proxy` existente y el VPC Service `PRIVATE_API` que apunta a `tcu-api-local` (`localhost:3500`). No crea un backend paralelo.

## Configuración ya incorporada

- Worker: `tcu-api-proxy` (mantiene la URL `https://tcu-api-proxy.anys.workers.dev`).
- Binding VPC: `PRIVATE_API`.
- Service ID: `01a0a563-a22f-77e3-b1b1-8607051568f4`.
- Secreto existente: `API_TOKEN` (se conserva como secreto del Worker y solo se reenvía al servicio privado).
- Proyecto Firebase: `tcutoyotanys`.
- Excel: `tsauxbodega/control-ubi-datos/CONTROL_UBI_cache.xlsx`, rama `main`.
- `ALLOW_LEGACY_API_TOKEN = "false"`: el token estático antiguo ya no abre nada. `REQUIRE_MFA = "true"`: todos los usuarios deben entrar con Google Authenticator (ver `docs/SEGURIDAD.md`, secciones 4 y 6).

## Antes de desplegar

1. Haz una copia del código actualmente desplegado del Worker `tcu-api-proxy`.
2. En Cloudflare, confirma que `API_TOKEN` sigue apareciendo como Secret en Production. No pongas su valor en `wrangler.toml`, GitHub ni en el frontend.
3. Crea la app en Cloudflare Pages. Cuando conozcas el dominio real, por ejemplo `https://control-ubi.pages.dev`, agrega ese origen a `ALLOWED_ORIGINS` en `worker/wrangler.toml`, separado por coma. No uses `*`.
4. El ZIP original no incluía un secret `GITHUB_TOKEN`. Esta configuración declara `API_TOKEN` y `GITHUB_TOKEN` como secretos obligatorios; Wrangler validará que ambos existan antes de desplegar. Crea un Fine-grained Personal Access Token de solo lectura (`Contents: Read-only`) para el repositorio que contiene el Excel.

## Desplegar el Worker

Desde una terminal, entra a la carpeta `worker`:

```bash
npx wrangler@latest login
npx wrangler@latest secret put GITHUB_TOKEN
npx wrangler@latest deploy
```

Al ejecutar `secret put`, pega el token de GitHub cuando Wrangler lo solicite. No pegues el token en el código ni en el TOML.

**No ejecutes `wrangler secret put API_TOKEN`** si no vas a reemplazar deliberadamente el secreto que ya está configurado. El despliegue utiliza el mismo nombre de Worker para conservar la configuración de Production existente; después del deploy, verifica que sigan presentes `API_TOKEN` y el binding `PRIVATE_API`.

## Desplegar Cloudflare Pages

En Workers & Pages → Create application → Pages → Connect to Git:

- Root directory: raíz del repositorio (donde está `package.json`).
- Build command: `npm run build`.
- Build output directory: `dist` (incluye `_headers` con la política de seguridad: no lo quites).
- Framework preset: None.

El frontend ya apunta a `https://tcu-api-proxy.anys.workers.dev` en `js/config.js`.

## Pruebas posteriores

1. Abre la URL `pages.dev` y verifica que el login Firebase funcione.
2. Comprueba que un usuario `operador` pueda consultar `/api/kaizen`.
3. Comprueba que un `operador` reciba 403 en `/api/sync-kaizen` y que un `admin` sí pueda ejecutarlo.
4. Comprueba que los precios se descarguen mediante `/api/excel`.
5. Comprueba que el túnel `tcu-servidor` siga Healthy y que el Worker pueda llegar a `localhost:3500`.

## Cerrar la transición

El puente antiguo ya viene apagado (`ALLOW_LEGACY_API_TOKEN = "false"`). Falta:

1. Publicar `firestore.rules` (Firebase Console → Firestore → Reglas) tras probarlas en el simulador.
2. Rota el token que usa el servicio local y actualiza `API_TOKEN` como Secret del Worker con el nuevo valor.
3. Confirma que ningún cliente antiguo dependa del token estático.

La validación de Firebase consulta `usuarios/{uid}` en Firestore y aplica los roles definidos en `worker/src/firebase-auth.js`. Revisa además las reglas de Firestore: cada usuario debe poder leer su propio documento, pero solo administradores deben modificar roles, estado y permisos.
