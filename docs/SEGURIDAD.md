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

## 4. Verificación en dos pasos (Google Authenticator / TOTP)
Cada usuario puede activarla desde el botón 🔐 del encabezado (opcional). Con ella activa, el login pide, después de la contraseña, el código de 6 dígitos de la app.
Código: `js/mfa.js`. La app usa el SDK *compat* de Firebase, que no trae TOTP; solo esa pieza se carga del SDK modular oficial (`firebase-auth.js`, misma versión **10.13.2**, import dinámico).
Si cambias la versión de los `<script>` de Firebase en `index.html`, cambia también `FIREBASE_VERSION` en `js/mfa.js` (deben coincidir).

**Para que funcione, una sola vez en Firebase:**
1. Firebase Console → Authentication → *Configuración / Upgrade* → pasar a **Identity Platform** (TOTP no está en el plan básico de Authentication).
2. Authentication → *Sign-in method* → **Multi-factor authentication** → activar **TOTP**.
3. El correo del usuario debe estar **verificado** para poder inscribir el factor (la ventana 🔐 ofrece enviar el correo de verificación). Los usuarios que crea el admin no lo tienen verificado por defecto.

**Exigirlo en el servidor (opcional):** en el Worker define la variable `REQUIRE_MFA`:
- vacía / `false` → no se exige (comportamiento anterior);
- `true` → todos los usuarios; o una lista de roles, por ejemplo `admin,supervisor`.

El Worker comprueba el claim `firebase.sign_in_second_factor === "totp"` del ID token. **Cuidado:** quien no haya activado su factor recibirá 403 en `/api/*`;
actívalo primero para todos los roles afectados y recién entonces define `REQUIRE_MFA`. La app no se rompe para ellos, pero no cargará inventario ni precios.

**Si alguien pierde el celular:** desde la consola de Firebase no se puede quitar el factor de otro usuario; hace falta el Admin SDK
(`updateUser(uid, { multiFactor: { enrolledFactors: null } })`), idealmente una función del Worker solo para admin (ver "Crear usuarios" abajo).
Mientras tanto, la salida es crear de nuevo la cuenta.

## Pendiente de revisar (no se ve desde el código)
- **Reglas de Firestore.** Hoy los roles se comprueban en el navegador (`TAB_PERMISSIONS`). Si las reglas no lo impiden, cualquier usuario autenticado
  podría escribir `usuarios/{uid}.rol = 'admin'` desde la consola. Exige: solo admin escribe `usuarios` (rol/activo/sede), cada quien lee su documento,
  y las demás colecciones piden usuario activo.
- **Clave de Firebase:** en Google Cloud Console → Credenciales, restringe la API key a tus dominios.
- **Librerías por CDN:** `unpkg.com/html5-qrcode` no tiene versión fija; fíjala y, si puedes, añade SRI.
- **Crear usuarios** se hace desde el navegador con una app secundaria de Firebase; solo las reglas impiden abusos.
  Lo más sólido es una función del Worker con el Admin SDK (también serviría para quitar el MFA a quien pierda el celular).
- **Cabeceras / CSP:** no se pueden endurecer del todo mientras existan los `onclick` inline (ver docs/MODULOS.md).
