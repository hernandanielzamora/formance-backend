import { parseEnv } from '../src/config/env.js';
import { createFirebase } from '../src/config/firebase.js';

// Herramienta local con credenciales privilegiadas; nunca se expone como endpoint.
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Uso: npm run grant:admin -- correo@ejemplo.com');
  process.exit(1);
}
const timer = setTimeout(() => { console.error('La operación no respondió en 20 segundos.'); process.exit(1); }, 20000);
try {
  const firebase = createFirebase(parseEnv().firebaseProjectId);
  if (!firebase) throw { code: 'FIREBASE_NOT_CONFIGURED' };
  const user = await firebase.auth.getUserByEmail(email);
  if (user.disabled || !user.emailVerified) throw { code: 'VERIFIED_ACTIVE_ACCOUNT_REQUIRED' };
  await firebase.auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
  console.log('Permiso admin asignado a la cuenta verificada. Cerrar sesión y volver a entrar para actualizar el token.');
  clearTimeout(timer); process.exit(0);
} catch (error) {
  console.error('No se pudo asignar admin:', error.code || 'UNKNOWN_ERROR');
  if (error.code === 'auth/user-not-found') console.error('Primero iniciar sesión con esa cuenta desde la aplicación.');
  clearTimeout(timer); process.exit(1);
}
