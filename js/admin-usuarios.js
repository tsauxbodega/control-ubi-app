import { BODEGAS } from './config.js';
import { CURRENT_USER, db, fbAuth, firebaseConfig } from './auth.js';
import { setActiveBodega } from './inventario-sql.js';
import { escHtml, jsAttrSafe } from './utils.js';
// ═══ js/admin-usuarios.js — extraído de index.html (líneas 6756–6890 del original) ═══
// Módulo ES: importa lo que usa de otros módulos y exporta lo que otros necesitan (generado por análisis de ámbito; ver docs/MODULOS.md).
// ═══════════════════════════════════════════════════════════════════
// PANEL DE ADMINISTRACIÓN DE USUARIOS
// ═══════════════════════════════════════════════════════════════════
function uNotice(msg, ok){
  const el = document.getElementById('uCreateNotice');
  el.textContent = msg;
  el.className = 'unotice on ' + (ok?'ok':'err');
  setTimeout(()=>el.classList.remove('on'), 5000);
}
async function crearUsuario(){
  if(!CURRENT_USER || CURRENT_USER.rol!=='admin') return;
  const nombre = document.getElementById('uNewNombre').value.trim();
  const email = document.getElementById('uNewEmail').value.trim();
  const pass = document.getElementById('uNewPass').value;
  const rol = document.getElementById('uNewRol').value;
  const sede = Number(document.getElementById('uNewSede').value) || 130;
  if(!nombre||!email||!pass){ uNotice('Completa nombre, correo y contraseña.', false); return; }
  if(pass.length<6){ uNotice('La contraseña debe tener al menos 6 caracteres.', false); return; }
  const btn=document.getElementById('uCreateBtn'), spin=document.getElementById('uCreateSpin'), txt=document.getElementById('uCreateBtnTxt');
  btn.disabled=true; spin.classList.add('on'); txt.textContent='Creando…';
  // App secundaria de Firebase: crea la cuenta sin cerrar la sesión del admin actual
  const secondaryName = 'secondary-'+Date.now();
  const secondaryApp = firebase.initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = secondaryApp.auth();
  try{
    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, pass);
    const newUid = cred.user.uid;
    await db.collection('usuarios').doc(newUid).set({
      nombre, email, rol, sede, activo:true,
      creadoPor: CURRENT_USER.uid,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    await secondaryAuth.signOut();
    await secondaryApp.delete();
    uNotice('Usuario creado correctamente.', true);
    document.getElementById('uNewNombre').value='';
    document.getElementById('uNewEmail').value='';
    document.getElementById('uNewPass').value='';
    document.getElementById('uNewRol').value='operador';
    document.getElementById('uNewSede').value='130';
    renderUsersTable();
  }catch(e){
    await secondaryApp.delete().catch(()=>{});
    let msg='No se pudo crear el usuario.';
    if(e.code==='auth/email-already-in-use') msg='Ese correo ya está registrado.';
    else if(e.code==='auth/invalid-email') msg='Correo inválido.';
    else if(e.code==='auth/weak-password') msg='Contraseña muy débil (mín. 6 caracteres).';
    uNotice(msg, false);
  }finally{
    btn.disabled=false; spin.classList.remove('on'); txt.textContent='+ Crear usuario';
  }
}
async function renderUsersTable(){
  const tbody = document.getElementById('usersTableBody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text3)">Cargando usuarios…</td></tr>';
  try{
    const qs = await db.collection('usuarios').orderBy('email').get();
    if(qs.empty){ tbody.innerHTML='<tr><td colspan="7" style="color:var(--text3)">Sin usuarios registrados.</td></tr>'; return; }
    let rows='';
    qs.forEach(doc=>{
      const u = doc.data(); const uid = doc.id;
      const fecha = u.creadoEn && u.creadoEn.toDate ? u.creadoEn.toDate().toLocaleDateString('es-CO') : '—';
      const activo = u.activo!==false;
      rows += `<tr>
        <td>${escHtml(u.nombre||'')}</td>
        <td class="uemail">${escHtml(u.email||'')}</td>
        <td>
          <select class="urolesel" onchange="cambiarRolUsuario('${jsAttrSafe(uid)}', this.value)" ${uid===CURRENT_USER.uid?'disabled title="No puedes cambiar tu propio rol"':''}>
            <option value="operador" ${u.rol==='operador'?'selected':''}>Operador</option>
            <option value="supervisor" ${u.rol==='supervisor'?'selected':''}>Supervisor</option>
            <option value="admin" ${u.rol==='admin'?'selected':''}>Admin</option>
          </select>
        </td>
        <td>
          <select class="urolesel" onchange="cambiarSede('${jsAttrSafe(uid)}', this.value)">
            <option value="130" ${Number(u.sede)!==230?'selected':''}>Sur (130)</option>
            <option value="230" ${Number(u.sede)===230?'selected':''}>Norte (230)</option>
          </select>
        </td>
        <td><span class="uactive-pill ${activo?'si':'no'}" onclick="${uid===CURRENT_USER.uid?'':`toggleUsuarioActivo('${jsAttrSafe(uid)}',${activo})`}" title="${uid===CURRENT_USER.uid?'No puedes desactivar tu propia cuenta':'Clic para cambiar'}">${activo?'Activo':'Inactivo'}</span></td>
        <td>${fecha}</td>
        <td>
          <button class="uresetbtn" onclick="resetPasswordUsuario('${jsAttrSafe(u.email||'')}')">Reset pass</button>
          <button class="udelbtn" ${uid===CURRENT_USER.uid?'disabled':''} onclick="eliminarUsuario('${jsAttrSafe(uid)}')">Eliminar</button>
        </td>
      </tr>`;
    });
    tbody.innerHTML = rows;
  }catch(e){
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--red)">Error al cargar usuarios.</td></tr>';
  }
}
async function cambiarRolUsuario(uid, nuevoRol){
  try{
    await db.collection('usuarios').doc(uid).update({rol:nuevoRol});
    renderUsersTable();
  }catch(e){ alert('No se pudo actualizar el rol.'); renderUsersTable(); }
}
async function cambiarSede(uid, nuevaSede){
  const s = Number(nuevaSede);
  if(!BODEGAS[s]) return;
  try{
    await db.collection('usuarios').doc(uid).update({sede:s});
    uNotice(`Sede actualizada a ${BODEGAS[s].sede}.`, true);
    // Si el admin se cambió la sede a sí mismo, la sesión activa la toma
    // de inmediato (no hace falta recargar ni volver a iniciar sesión).
    if(uid === CURRENT_USER.uid){
      CURRENT_USER.sede = s;
      setActiveBodega(s);
    }
  }catch(e){ uNotice('No se pudo actualizar la sede.', false); }
}
async function toggleUsuarioActivo(uid, activoActual){
  try{
    await db.collection('usuarios').doc(uid).update({activo: !activoActual});
    renderUsersTable();
  }catch(e){ alert('No se pudo actualizar el estado.'); }
}
async function eliminarUsuario(uid){
  if(!confirm('Esto elimina el acceso del usuario a la app (su cuenta de Firebase Authentication debe borrarse aparte, desde la consola de Firebase, si quieres eliminarla por completo). ¿Continuar?')) return;
  try{
    await db.collection('usuarios').doc(uid).delete();
    renderUsersTable();
  }catch(e){ alert('No se pudo eliminar el usuario.'); }
}
async function resetPasswordUsuario(email){
  if(!email) return;
  try{
    await fbAuth.sendPasswordResetEmail(email);
    uNotice('Se envió un correo de restablecimiento a '+email, true);
  }catch(e){ uNotice('No se pudo enviar el correo de restablecimiento.', false); }
}

export { cambiarRolUsuario, cambiarSede, crearUsuario, eliminarUsuario, renderUsersTable, resetPasswordUsuario, toggleUsuarioActivo };
