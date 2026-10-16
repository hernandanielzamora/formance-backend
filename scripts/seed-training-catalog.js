import { parseEnv } from '../src/config/env.js';
import { createFirebase } from '../src/config/firebase.js';
import { seedTrainingCatalog } from './lib/training-catalog.js';

const args = process.argv.slice(2);
const emailIndex = args.indexOf('--admin-email');
if (emailIndex < 0 || !args[emailIndex + 1] || args.some((arg, index) => arg !== '--apply' && arg !== '--admin-email' && index !== emailIndex + 1)) throw new Error('Uso: npm run seed:training -- --admin-email CORREO [--apply]. Sin --apply solo muestra el plan.');
const config = parseEnv();
const firebase = createFirebase(config.firebaseProjectId);
if (!firebase) throw new Error('Configurar Firebase de Formance antes de cargar el catálogo.');
const timer = setTimeout(() => { console.error('Firebase no respondió en 60 segundos; la transacción podría seguir en curso. Revisar el resultado con un dry-run antes de reintentar.'); process.exit(1); }, 60_000);
try {
  const admin = await firebase.auth.getUserByEmail(args[emailIndex + 1]);
  if (!admin.emailVerified || admin.disabled || admin.customClaims?.admin !== true) throw new Error('Se requiere una cuenta administradora activa con correo verificado.');
  const apply = args.includes('--apply');
  const plan = await seedTrainingCatalog(firebase.db, admin.uid, apply);
  console.log(JSON.stringify({ mode: apply ? 'aplicado' : 'simulación sin escrituras', project: config.firebaseProjectId, created: plan.creates.length, preserved: plan.preserved.length, totals: plan.totals, routinesByGoal: plan.coverage, additions: plan.creates.map(item => `${item.kind}/${item.id}`) }, null, 2));
} finally { clearTimeout(timer); await firebase.db.terminate(); }
