// Web Worker: lee el .xlsx fuera del hilo principal. build.mjs empaqueta este archivo en dist/js/excel-parse.worker.js;
// SheetJS se carga con importScripts desde vendor/ (la misma copia local verificada con SHA-256 que usa la página).
import { parseWorkbook } from './excel-parse.js';

importScripts('../vendor/xlsx.full.min.js');   // define self.XLSX

self.onmessage = (ev) => {
  try{
    const { buf, opts } = ev.data;
    self.postMessage({ data: parseWorkbook(self.XLSX, buf, opts || {}) });
  }catch(e){
    self.postMessage({ error: String((e && e.message) || e) });
  }
};
