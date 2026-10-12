import { parseEnv } from './config/env.js';
import { createFirebase } from './config/firebase.js';
import { createApp } from './app.js';

const config = parseEnv();
const firebase = createFirebase(config.firebaseProjectId);
const app = createApp({ config });
// Disponible para los módulos de usuario y admin del paso 2.
app.locals.firebase = firebase;
const server = app.listen(config.port, () => {
  console.log(`Formance API: http://localhost:${config.port}`);
  console.log(firebase ? 'Firebase inicializado. Ejecutar npm run check:firebase para verificar acceso.' : 'Firebase pendiente de configuración.');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
