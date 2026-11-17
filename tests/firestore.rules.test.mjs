// Prueba de las reglas contra el EMULADOR de Firestore (no corre con `npm test` porque necesita Java + firebase-tools).
//   npm i -D firebase-tools @firebase/rules-unit-testing firebase
//   npx firebase emulators:exec --only firestore "node tests/firestore.rules.test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'tcutoyotanys', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'usuarios/admin1'), { rol: 'admin', activo: true });
  await setDoc(doc(d, 'usuarios/sup1'),   { rol: 'supervisor', activo: true });
  await setDoc(doc(d, 'usuarios/op1'),    { rol: 'operador', activo: true });
  await setDoc(doc(d, 'usuarios/off1'),   { rol: 'operador', activo: false });
  await setDoc(doc(d, 'equipo/precio_divisores'), { items: [] });
  await setDoc(doc(d, 'estante_snapshots/A1'), { estante: 'A1' });
  await setDoc(doc(d, 'panorama_snapshot/current'), { nEst: 1 });
  await setDoc(doc(d, 'mant_combos/m1'), { x: 1 });
});
const mfa = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' } }).firestore();
const noMfa = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

let ok = 0, bad = 0;
const t = async (name, p) => { try { await p; ok++; console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, '\n     ', String(e.message).split('\n')[0]); } };

console.log('Sin sesión');
await t('no lee usuarios', assertFails(getDoc(doc(anon(), 'usuarios/op1'))));
await t('no lee equipo', assertFails(getDoc(doc(anon(), 'equipo/precio_divisores'))));
await t('no lee mant_combos', assertFails(getDoc(doc(anon(), 'mant_combos/m1'))));
await t('SÍ lee un snapshot de estante (QR invitado)', assertSucceeds(getDoc(doc(anon(), 'estante_snapshots/A1'))));
await t('SÍ lee el snapshot de panorama (QR invitado)', assertSucceeds(getDoc(doc(anon(), 'panorama_snapshot/current'))));
await t('NO lista snapshots', assertFails(getDocs(collection(anon(), 'estante_snapshots'))));
await t('no escribe snapshots', assertFails(setDoc(doc(anon(), 'estante_snapshots/A1'), { estante: 'X' })));
await t('no lee otra colección cualquiera', assertFails(getDoc(doc(anon(), 'otra/x'))));

console.log('Con sesión pero SIN segundo factor');
await t('admin sin MFA no lee usuarios', assertFails(getDoc(doc(noMfa('admin1'), 'usuarios/op1'))));
await t('operador sin MFA no lee equipo', assertFails(getDoc(doc(noMfa('op1'), 'equipo/precio_divisores'))));
await t('operador sin MFA no escribe snapshot', assertFails(setDoc(doc(noMfa('op1'), 'estante_snapshots/A1'), { estante: 'X' })));
await t('operador sin MFA no lee su propio perfil', assertFails(getDoc(doc(noMfa('op1'), 'usuarios/op1'))));

console.log('Operador con MFA');
await t('lee su perfil', assertSucceeds(getDoc(doc(mfa('op1'), 'usuarios/op1'))));
await t('no lee el perfil de otro', assertFails(getDoc(doc(mfa('op1'), 'usuarios/sup1'))));
await t('no lista usuarios', assertFails(getDocs(collection(mfa('op1'), 'usuarios'))));
await t('NO se sube el rol a admin', assertFails(updateDoc(doc(mfa('op1'), 'usuarios/op1'), { rol: 'admin' })));
await t('NO se crea un perfil admin para otro uid', assertFails(setDoc(doc(mfa('op1'), 'usuarios/nuevo'), { rol: 'admin', activo: true })));
await t('lee equipo', assertSucceeds(getDoc(doc(mfa('op1'), 'equipo/precio_divisores'))));
await t('guarda historial de cotización', assertSucceeds(setDoc(doc(mfa('op1'), 'equipo/cot_hist_1'), { kind: 'cot_historial' })));
await t('guarda consecutivo del cotizador', assertSucceeds(setDoc(doc(mfa('op1'), 'equipo/cotizador_seq'), { n: 5 })));
await t('NO cambia precio_divisores', assertFails(setDoc(doc(mfa('op1'), 'equipo/precio_divisores'), { items: [1] })));
await t('NO borra precio_divisores', assertFails(deleteDoc(doc(mfa('op1'), 'equipo/precio_divisores'))));
await t('mant_combos lectura/escritura', assertSucceeds(setDoc(doc(mfa('op1'), 'mant_combos/m2'), { x: 2 })));
await t('escribe snapshot (carga de Excel)', assertSucceeds(setDoc(doc(mfa('op1'), 'estante_snapshots/A1'), { estante: 'A1' })));
await t('lista snapshots', assertSucceeds(getDocs(collection(mfa('op1'), 'estante_snapshots'))));
await t('escribe su estado de sesión', assertSucceeds(setDoc(doc(mfa('op1'), 'usuarios/op1/estado/inv'), { v: 1 })));
await t('NO escribe el estado de otro', assertFails(setDoc(doc(mfa('op1'), 'usuarios/sup1/estado/inv'), { v: 1 })));

console.log('Supervisor / Admin con MFA');
await t('supervisor NO cambia precio_divisores (solo admin)', assertFails(setDoc(doc(mfa('sup1'), 'equipo/precio_divisores'), { items: [1] })));
await t('admin cambia precio_divisores', assertSucceeds(setDoc(doc(mfa('admin1'), 'equipo/precio_divisores'), { items: [1] })));
await t('admin lista usuarios', assertSucceeds(getDocs(collection(mfa('admin1'), 'usuarios'))));
await t('admin cambia rol', assertSucceeds(updateDoc(doc(mfa('admin1'), 'usuarios/op1'), { rol: 'supervisor' })));
await t('admin desactiva usuario', assertSucceeds(updateDoc(doc(mfa('admin1'), 'usuarios/op1'), { activo: false })));
await t('admin borra usuario', assertSucceeds(deleteDoc(doc(mfa('admin1'), 'usuarios/off1'))));

console.log('Usuario desactivado / sin perfil');
await t('desactivado lee su perfil (para avisarle)', assertSucceeds(getDoc(doc(mfa('off1'), 'usuarios/off1'))));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'usuarios/off2'), { rol: 'operador', activo: false }));
await t('desactivado NO lee equipo', assertFails(getDoc(doc(mfa('off2'), 'equipo/precio_divisores'))));
await t('desactivado NO escribe snapshots', assertFails(setDoc(doc(mfa('off2'), 'estante_snapshots/A1'), { estante: 'X' })));
await t('cuenta sin documento en /usuarios NO lee equipo', assertFails(getDoc(doc(mfa('fantasma'), 'equipo/precio_divisores'))));

await env.cleanup();
console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
