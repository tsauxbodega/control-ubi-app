// ═══ js/qr-local.js — generador de códigos QR 100 % local ═══
// Antes cada QR se pedía a un servicio externo de terceros: eso enviaba a un tercero la dirección de cada estante y
// obligaba a tener internet para imprimir etiquetas. Ahora se dibuja aquí con vendor/qrcode.js
// (qrcode-generator 1.4.4, cargado por index.html) y la imagen viaja como data:URL.
export function qrDataUrl(text, px = 260){
  const qr = window.qrcode(0, 'M');           // corrección de errores M, como antes
  qr.addData(String(text));
  qr.make();
  const margin = 2;                           // zona de silencio, en módulos
  const cell = Math.max(2, Math.ceil(px / (qr.getModuleCount() + margin * 2)));
  return qr.createDataURL(cell, cell * margin);
}
