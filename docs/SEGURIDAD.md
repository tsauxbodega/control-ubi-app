# Seguridad: qué se arregló, qué falta

## Lo que NO se puede esconder en una app de navegador
Todo lo que viaja al navegador es visible (código, `firebaseConfig`, URLs). Modularizar no oculta nada: ordena el código.
La seguridad real está en el servidor: reglas de Firestore y el Worker. El `apiKey` de Firebase es público por diseño;
lo que protege los datos son las reglas.

## 1. El token de la API (`API_TOKEN`) — ya no está en el código
Era una llave estática y visible que abría `/api/kaizen` (inventario y precios del ERP), `/api/imagenes` y `/api/sync-kaizen`
(dispara `SP_TCU` en el SQL Server). **Considérala comprometida** aunque ya no esté: sigue en historiales y cachés.

Ahora cada petición lleva el ID token de Firebase del usuario; el Worker (`worker/`) lo verifica, lee su rol en `usuarios/{uid}`
y aplica la política (`/api/sync-kaizen*` solo admin; el resto, cualquier usuario activo). Hay pruebas: `cd worker && node test/firebase-auth.test.mjs`.

## 2. El Excel de precios: repositorio privado
La app ya no lee `raw.githubusercontent.com`: pide `/api/excel` al Worker, que lo lee con un token de GitHub **que solo vive como secreto del Worker**.
El navegador nunca ve ese token ni la URL del repositorio. La detección de cambios (ETag) sigue funcionando.

Pasos, **en este orden** (si haces el repo privado antes, la app vieja deja de cargar precios):
1. GitHub → *Settings → Developer settings → Fine-grained personal access tokens → Generate*.
   Resource owner `tsauxbodega`, **solo** el repositorio `control-ubi-datos`, permiso **Contents: Read-only**, vencimiento 1 año (pon un recordatorio).
2. `wrangler secret put GITHUB_TOKEN` (pega el token). En `wrangler.toml` ajusta `GITHUB_REPO`, `GITHUB_FILE`, `GITHUB_REF` (ver `worker/wrangler.example.toml`).
3. Despliega el Worker con la ruta `/api/excel` (`worker/src/excel.js`, ejemplo en `index.example.js`).
4. Despliega la app nueva. Entra con un usuario y comprueba que los precios cargan.
5. **Ahora sí**: repositorio → *Settings → Danger Zone → Change visibility → Private*.
6. Revisa quién más lee esa URL "raw" sin token (otra app, un script, el cotizador): dejará de funcionar y habrá que apuntarlo también al Worker.
   Quien **sube** el Excel al repo (script o Action) sigue funcionando si se autentica con su propio token.
Lo que ya fue público antes del paso 5 se debe dar por copiado.

## 3. Rotar el token del ERP — orden de despliegue sin cortar el servicio
1. Worker: integra `authorize()` en `tcu-api-proxy`; pon `LEGACY_TOKEN` = el token actual **temporalmente** (la app vieja sigue funcionando).
2. Publica la app nueva (usa Firebase ID tokens). Prueba login, inventario y, como admin, sincronizar.
3. Genera un token **nuevo** hacia el ERP/túnel (`wrangler secret put UPSTREAM_TOKEN`), cámbialo en el servicio puente y **borra `LEGACY_TOKEN`**.
4. Verifica que la llamada con el token viejo responde 401.

## 4. Verificación en dos pasos (Google Authenticator) — OBLIGATORIA para todos
- **En la app (`js/mfa.js`, `js/session.js`):** quien entra sin Google Authenticator activado queda bloqueado en una pantalla de inscripción (QR + código). No se lee ni Firestore hasta activarlo. Al terminar, la sesión se cierra para volver a entrar *con* el código. Ya no se puede desactivar desde la app.
- **En el servidor (lo que de verdad protege):** el Worker (`REQUIRE_MFA`, obligatorio por defecto: si la variable no existe, se exige) y las reglas de Firestore (`firestore.rules`) exigen que el token traiga `firebase.sign_in_second_factor = "totp"`. Aunque alguien manipule el JavaScript del navegador para saltarse la pantalla, el servidor no le entrega nada.
- La app usa el SDK *compat* de Firebase (10.13.2), que no trae TOTP; solo esa pieza se carga del SDK modular oficial (misma versión). Si cambias la versión de los scripts de Firebase en `index.html`, cambia también `FIREBASE_VERSION` en `js/mfa.js`.

**Pasos únicos en Firebase** (sin esto el MFA no funciona):
1. Authentication → pasar a **Identity Platform** (TOTP no está en el plan básico).
2. Authentication → *Sign-in method* → **Multi-factor authentication** → activar **TOTP**.
3. Los usuarios deben tener el **correo verificado** para inscribirse (la pantalla ofrece enviar el correo). Los que crea el admin no lo traen verificado.
4. Publicar `firestore.rules` (ver sección 6).

**Orden de puesta en marcha para no dejar a nadie fuera:** el Worker ya viene con MFA obligatorio. Despliega la app primero, haz que cada usuario la active (la pantalla se lo pide al entrar) y despliega el Worker y las reglas después. Mientras alguien no la active, el Worker responde 403 y no verá datos.

**Si alguien pierde el celular:** desde la consola de Firebase no se puede quitar el factor de otro usuario; hace falta el Admin SDK (`updateUser(uid, { multiFactor: { enrolledFactors: null } })`), idealmente una función del Worker solo para admin (ver "Crear usuarios" abajo).

## 5. Tiempo de sesión por inactividad
Admin **30 min**; supervisor y operador **15 min**. Aviso 2 minutos antes y cierre automático. Los valores están fijos en `js/session.js`: antes se podían alargar desde el inspector con `localStorage`, y eso se eliminó. Un vigilante compara con la hora real cada 15 s (los temporizadores se retrasan con la pestaña en segundo plano o el equipo suspendido).
Límite honesto: es un cierre **del lado del navegador**. Para invalidar también del lado del servidor haría falta revocar tokens con el Admin SDK; los ID tokens de Firebase duran 1 h y el Worker los vuelve a validar en cada petición.

## 6. Lo que se ve en el inspector del navegador, y por qué no es un riesgo
Todo código que llega al navegador es visible: no se puede ocultar y no es el objetivo. El objetivo es que **lo visible no sirva para nada**: sin secretos en el cliente y con todo el control de acceso en el servidor.

| Lo que se ve | Es secreto? | Qué lo protege |
|---|---|---|
| `firebaseConfig` (apiKey, projectId…) | No: es un identificador público por diseño | Reglas de Firestore + MFA; además **restringe la API key** (abajo) |
| URL del Worker (`API_URL`) | No | El Worker exige ID token Firebase + rol + MFA; CORS solo al origen de la app; el token estático antiguo está apagado |
| Token del ERP / token de GitHub | **Nunca llegan al navegador** | Viven como secretos del Worker |
| Roles y permisos de pestañas (`TAB_PERMISSIONS`) | No | Solo ocultan botones; el servidor vuelve a comprobar el rol |
| Mensajes internos en consola | Antes sí | El build de producción elimina todos los `console.*` |
| Dependencias | Antes venían de CDN sin versión fija | Ahora están en `vendor/` con versión y firma SHA-256 (`vendor/README.md`) |
| Códigos QR | Antes se pedían a un servicio externo (filtraba direcciones de estantes) | Ahora se generan en el navegador, sin terceros |
| Fuentes | Antes Google Fonts | Ahora propias, y funcionan sin internet |

**Cabeceras de seguridad (`_headers`, Cloudflare Pages):** CSP con `default-src 'none'`, scripts solo propios y de `gstatic.com` (Firebase), **sin `eval` y sin scripts en línea**, `frame-ancestors 'none'` (no se puede incrustar la app), HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (solo la cámara del escáner), `noindex`. Las ventanas de impresión ya no llevan `<script>` en línea (imprime el código de la app).
**Límite conocido de la CSP:** la app tiene ~540 manejadores `onclick="..."` en línea (deuda descrita en `docs/MODULOS.md`), por eso la CSP incluye `script-src-attr 'unsafe-inline'`. Bloquea scripts inyectados y cargas externas, pero no un `<img onerror=…>` inyectado. Cerrar eso del todo exige migrar esos manejadores a `addEventListener` (siguiente fase).

**Reglas de Firestore (`firestore.rules`):** todo exige sesión con segundo factor y usuario activo; solo el admin crea o cambia roles/estado/sede; denegar por defecto. **Cambio de comportamiento:** los resúmenes de estantes/panorama que usaba la vista rápida de QR para invitados **ya no son públicos** (eran legibles sin iniciar sesión: códigos, descripciones y stock). Quien escanee un QR sin sesión verá el login y luego el estante. Si decides volver a exponerlos, es una decisión consciente: cambia `allow read: if activo()` por `allow get: if true` en esas dos colecciones y acepta que esa información queda pública.
Este archivo se escribió leyendo el código, **no se ha ejecutado contra Firebase**: pruébalo en el *Simulador de reglas* antes de publicar.

**Pasos manuales que no se pueden hacer desde el código:**
1. Google Cloud Console → Credenciales → restringir la API key de Firebase a tu(s) dominio(s) (`*.pages.dev` o el dominio final) y a las APIs *Identity Toolkit* y *Cloud Firestore*.
2. Considerar **Firebase App Check** (reCAPTCHA Enterprise) para que solo tu app pueda hablar con Firestore/Auth.
3. **Rotar `API_TOKEN`** (el que estuvo visible en versiones anteriores) y desplegar el Worker con `ALLOW_LEGACY_API_TOKEN = "false"`, que ya es el valor del repositorio.
4. Cloudflare: poner la regla de *rate limiting* sobre `/api/*` del Worker y agregar el origen final de Pages a `ALLOWED_ORIGINS`.

**Riesgos que quedan (por transparencia):** (a) Firestore guarda una copia en IndexedDB del dispositivo para trabajar sin conexión; en equipos compartidos conviene usar perfiles de navegador separados. (b) SheetJS 0.18.5 es la última versión en npm y tiene un aviso conocido de *prototype pollution* al abrir archivos manipulados; la app solo abre Excel propios. (c) No se ha hecho una auditoría de XSS línea por línea del HTML generado por plantillas.

## Pendiente de revisar (no se ve desde el código)
- **Publicar y probar `firestore.rules`** (sección 6). Hasta que se publiquen, los roles solo se comprueban en el navegador y cualquier usuario autenticado podría escribir `usuarios/{uid}.rol = 'admin'` desde la consola.
- **Clave de Firebase:** en Google Cloud Console → Credenciales, restringe la API key a tus dominios.
- **Crear usuarios** se hace desde el navegador con una app secundaria de Firebase; solo las reglas impiden abusos.
  Lo más sólido es una función del Worker con el Admin SDK (también serviría para quitar el MFA a quien pierda el celular).
