import { API_URL } from './config.js';
import { fbAuth } from './auth.js';
// ═══ js/api.js — cliente de la API puente (NUEVO) ═══
// Este archivo NO contiene secretos. Cada petición viaja con el ID token de Firebase del usuario conectado;
// el Worker (carpeta worker/) lo verifica, comprueba su rol en Firestore y solo entonces habla con el ERP.
// Si el token venció o fue revocado, se renueva una sola vez antes de rendirse.
async function apiFetch(path, opts = {}) {
  const user = fbAuth.currentUser;
  if (!user) throw new Error('Sesión no iniciada');
  const send = async (force) => {
    const token = await user.getIdToken(force);
    return fetch(API_URL + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  };
  let res = await send(false);
  if (res.status === 401) res = await send(true);
  return res;
}

export { apiFetch };
