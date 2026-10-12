import { parseEnv } from '../src/config/env.js';
import { createFirebase } from '../src/config/firebase.js';

const timer = setTimeout(() => {
  console.error('Firebase no respondió en 20 segundos. Revisar credenciales, conexión y APIs habilitadas.');
  process.exit(1);
}, 20000);
let stage = 'configuración';
try {
  const config = parseEnv();
  const firebase = createFirebase(config.firebaseProjectId);
  if (!firebase) {
    console.error('Firebase pendiente: completar FIREBASE_PROJECT_ID y GOOGLE_APPLICATION_CREDENTIALS en .env.');
    clearTimeout(timer);
    process.exit(1);
  }
  // Solo lecturas. No muestra usuarios ni datos del proyecto.
  stage = 'Authentication';
  await firebase.auth.listUsers(1);
  console.log('Firebase Authentication: conexión verificada.');
  stage = 'Cloud Firestore';
  await firebase.db.collection('_connection_check').limit(1).get();
  console.log('Conexión verificada: Firebase Authentication y Cloud Firestore.');
  clearTimeout(timer);
  process.exit(0);
} catch (error) {
  console.error(`No se pudo verificar ${stage}:`, error.code || 'CONFIGURATION_ERROR');
  if (stage === 'Cloud Firestore' && error.details) {
    console.error('Detalle de Firestore:', error.details);
  }
  console.error('Revisar .env, la cuenta de servicio y la creación de Authentication/Firestore.');
  clearTimeout(timer);
  process.exit(1);
}
