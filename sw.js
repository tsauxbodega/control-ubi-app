// Toyota · Control UBI — Service Worker v2
// ─────────────────────────────────────────────────────────────────────────
// Vive junto a index.html (raíz del sitio). Al cambiar el listado STATIC o la estrategia, sube el número de CACHE.
// ─────────────────────────────────────────────────────────────────────────
const CACHE  = 'control-ubi-v11';
const STATIC = [
  './',
  'css/app.css',
  'js/main.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'js/config.js',
  'js/auth.js',
  'js/mfa.js',
  'js/qr-local.js',
  'js/api.js',
  'js/session.js',
  'js/cloud-sync.js',
  'js/admin-usuarios.js',
  'js/state-globals.js',
  'js/file-upload.js',
  'js/precios-divisor.js',
  'js/inventario-sql.js',
  'js/excel-respaldo.js',
  'js/ui-header-tabs.js',
  'js/buscador.js',
  'js/precios.js',
  'js/ubicaciones.js',
  'js/estantes.js',
  'js/nostock.js',
  'js/sugerir.js',
  'js/utils.js',
  'js/autoload-excel.js',
  'js/radar-precios.js',
  'js/radar-cambios.js',
  'js/modales-estante-panorama.js',
  'js/escaner.js',
  'js/foto.js',
  'js/init.js',
  'js/tema-historial.js',
  'js/diagnostico-dpok.js',
  'js/sugerido-max.js',
  'js/multi-codigo.js',
  'js/export.js',
  'js/conteo.js',
  'js/cruce-conteo.js',
  'js/cruce-referencias.js',
  'js/qr-estantes.js',
  'js/cambio-ubicacion.js',
  'js/qr-grid.js',
  'js/reporte-imprimible.js',
  'js/cotizador.js',
  'js/mantenimientos.js',
  'js/command-palette.js',
  'js/pwa-ui.js',
  'js/etiquetas.js',
  'vendor/xlsx.full.min.js',
  'vendor/html5-qrcode.min.js',
  'vendor/qrcode.js',
  'vendor/fonts/ibm-plex-mono-latin-400-normal.woff2',
  'vendor/fonts/ibm-plex-mono-latin-500-normal.woff2',
  'vendor/fonts/ibm-plex-mono-latin-700-normal.woff2',
  'vendor/fonts/ibm-plex-sans-latin-400-normal.woff2',
  'vendor/fonts/ibm-plex-sans-latin-500-normal.woff2',
  'vendor/fonts/ibm-plex-sans-latin-600-normal.woff2',
  'vendor/fonts/ibm-plex-sans-latin-700-normal.woff2'
];

// URLs de datos que NUNCA se deben cachear — siempre ir a red
const NO_CACHE_PATTERNS = [
  'tcu-api-proxy.anys.workers.dev', // API puente SQL (Cloudflare Worker) — nunca cachear, siempre red
  '/api/kaizen',                    // por ruta también, para no repetir este bug si el dominio vuelve a cambiar
  '.xlsx',
  '.xls',
  '.csv',
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com',
  'firebasestorage.googleapis.com'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(STATIC.map(u =>
        c.add(new Request(u, { mode: 'no-cors' })).catch(err => {
          console.warn('[SW] No se pudo pre-cachear (no crítico):', u, err && err.message || err);
        })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Datos dinámicos → siempre red, nunca caché
  const url = e.request.url;
  if (NO_CACHE_PATTERNS.some(p => url.includes(p))) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Documento principal (el HTML de la app) → RED PRIMERO, con la caché
  // solo como respaldo si no hay conexión. Antes era "caché primero" para
  // todo, incluido este documento — por eso un celular que ya tenía la app
  // instalada seguía viendo la versión vieja para siempre después de cada
  // actualización, aunque el archivo en Netlify ya estuviera al día.
  const isNavigation = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('./')))
    );
    return;
  }

  // Archivos propios (js/css/imágenes) → RED PRIMERO, caché de respaldo sin conexión.
  // Con "caché primero" una actualización de js/*.js no llegaría nunca a quien ya tiene la app.
  if (new URL(url).origin === self.location.origin) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
        return res;
      }).catch(() => caches.match(e.request).then(c => c || new Response('', { status: 503 })))
    );
    return;
  }

  // Resto de archivos estáticos (librerías externas) → caché primero, igual que antes.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200) return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    }).catch(() => new Response('', { status: 503 }))
  );
});
