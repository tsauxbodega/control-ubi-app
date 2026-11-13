// Prueba de humo: arranca la app con módulos ES REALES (vm.SourceTextModule) en un navegador simulado (jsdom),
// con un usuario admin y 300 filas de inventario falsas. Falla si hay errores, si no entra al panel o si una pestaña revienta.
// Uso: node --experimental-vm-modules tests/boot.test.mjs [carpeta]   (por defecto ".", o "dist" tras `npm run build`)
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import assert from 'node:assert/strict'; import { createRequire } from 'module';
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom');
const root = path.resolve(process.argv[2] || '.');
const entryFile = fs.existsSync(path.join(root, 'js/app.js')) ? 'js/app.js' : 'js/main.js';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const errors = []; const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push((e.detail && e.detail.message) || e.message)); vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window, ctx = dom.getInternalVMContext(), doc = w.document;
w.addEventListener('error', (e) => errors.push(e.message));
const rows = Array.from({ length: 300 }, (_, i) => ({ bodega: i % 3 ? 130 : 230, codigo: '0888' + (1000 + i), Descripcion: (i % 2 ? 'FILTRO ACEITE ' : 'PASTILLA FRENO ') + i, Stock: i % 7, Ubicacion: 'B' + (1 + i % 5) + 'E0' + (1 + i % 9), ABC: 'ABC'[i % 3], Costo_Inventario: 1000 + i }));
w.eval(`window.__rows=${JSON.stringify(rows)};
 window.__dcl=[]; const _d=document.addEventListener.bind(document); document.addEventListener=function(t,f,o){ if(t==='DOMContentLoaded'){window.__dcl.push(f);return;} return _d(t,f,o); };
 const noop=()=>{}; const snap={exists:false,data:()=>({}),docs:[],forEach:noop}; const udoc={exists:true,data:()=>({rol:'admin',activo:true,nombre:'Tester',sede:130})};
 const docRef=(c)=>({get:async()=>c==='usuarios'?udoc:snap,set:async()=>{},update:async()=>{},delete:async()=>{},onSnapshot:()=>noop,collection:(x)=>colRef(x)});
 const colRef=(c)=>({doc:()=>docRef(c),get:async()=>snap,orderBy:()=>colRef(c),where:()=>colRef(c),limit:()=>colRef(c),onSnapshot:()=>noop,add:async()=>({})});
 const user={uid:'u1',email:'t@x.co',getIdToken:async()=>'tok'};
 window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
 window.XLSX={utils:{},read(){},writeFile(){}}; window.Html5Qrcode=function(){}; window.Html5QrcodeScanner=function(){};
 const auth={onAuthStateChanged:(cb)=>{setTimeout(()=>cb(user),0);return noop;},currentUser:user,signOut:async()=>{}};
 window.firebase={initializeApp:()=>({}),auth:()=>auth,firestore:()=>({collection:colRef,doc:(p)=>docRef(p.split('/')[0]),enablePersistence:async()=>{},batch:()=>({set:noop,commit:async()=>{}}),runTransaction:async()=>{}})};
 window.firebase.firestore.FieldValue={serverTimestamp:()=>0,increment:()=>0};
 window.fetch=async(u)=>String(u).includes('/api/kaizen')?{ok:true,status:200,json:async()=>window.__rows,headers:{get:()=>null}}:{ok:false,status:404,json:async()=>({}),headers:{get:()=>null},arrayBuffer:async()=>new ArrayBuffer(0)};`);
const cache = new Map(); const load = (f) => cache.get(f) || (cache.set(f, new vm.SourceTextModule(fs.readFileSync(f, 'utf8'), { context: ctx, identifier: f })), cache.get(f));
const entry = load(path.join(root, entryFile)); await entry.link((s, r) => load(path.resolve(path.dirname(r.identifier), s))); await entry.evaluate();
w.eval(`for (const f of window.__dcl) f.call(document, new Event('DOMContentLoaded'));`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); await sleep(4000);
assert.equal(doc.getElementById('appShell').style.display, 'block', 'no entró al panel principal');
assert.equal(doc.getElementById('authOverlay').style.display, 'none', 'la pantalla de login sigue visible');
assert.match(doc.getElementById('ubadgeName').textContent, /Tester/, 'no se mostró el usuario');
for (const t of ['bus', 'ubi', 'prec', 'estantes', 'sugerir', 'diagnostico', 'nostock', 'exportar', 'novedades', 'conteo', 'usuarios', 'etiquetas']) {
  w.goTab(t); await sleep(120);
  assert.ok(doc.getElementById('panel-' + t)?.classList.contains('active'), 'no abre la pestaña ' + t);
}
w.goTab('mant'); await sleep(120); // mantenimientos no tiene panel propio: solo se comprueba que no falle
w.goTab('bus'); const q = doc.getElementById('busQ'); q.value = 'FILTRO'; q.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(500);
assert.ok(doc.querySelector('#panel-bus').textContent.length > 400, 'la búsqueda no pintó nada');
// Verificación en dos pasos: el paso del código reemplaza al formulario y se puede cancelar sin errores
assert.equal(typeof w.submitMfaChallenge, 'function', 'falta submitMfaChallenge en window'); assert.equal(typeof w.openMfaModal, 'function', 'falta openMfaModal en window');
assert.ok(doc.getElementById('authMfaForm') && doc.getElementById('mfaBtn'), 'falta el HTML del paso MFA / botón 🔐');
assert.deepEqual(errors, [], 'errores en ejecución:\n' + errors.join('\n'));
console.log(`OK  (${cache.size} módulo(s), 14 pestañas, búsqueda, sin errores)`);
process.exit(0);
