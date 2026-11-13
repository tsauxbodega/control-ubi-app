# Librerías de terceros (servidas desde el propio sitio)

Se guardan aquí, con versión fija, en vez de cargarlas de un CDN: así nadie puede cambiarlas por detrás y la app funciona sin depender de otros dominios.
Las firmas SHA-256 permiten comprobar que no se alteraron (`cd vendor && sha256sum -c SHA256SUMS`).

| Archivo | Paquete | Versión | Licencia |
|---|---|---|---|
| `xlsx.full.min.js` | SheetJS `xlsx` | 0.18.5 | Apache-2.0 |
| `html5-qrcode.min.js` | `html5-qrcode` | 2.3.8 | Apache-2.0 |
| `qrcode.js` | `qrcode-generator` | 1.4.4 | MIT |
| `fonts/*.woff2` | `@fontsource/ibm-plex-mono` / `-sans` (subconjunto latin) | última al 2026-11 | SIL OFL 1.1 |

Nota: SheetJS 0.18.5 es la última versión publicada en npm; las correcciones posteriores solo se distribuyen desde cdn.sheetjs.com.
La app solo abre Excel de fuentes propias (el archivo del repositorio privado y los que sube el propio personal).
