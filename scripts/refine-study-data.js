import { parseArgs } from 'node:util';
import { parseEnv } from '../src/config/env.js';
import { createFirebase } from '../src/config/firebase.js';
import { planPresentationRefinement } from './lib/presentation-meals.js';

const { values } = parseArgs({ options: { uid: { type: 'string' }, email: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, apply: { type: 'boolean', default: false } } });
if (!values.uid || !values.email || !values.from || !values.to) throw new Error('Indicar --uid, --email, --from, --to y opcionalmente --apply.');
const firebase = createFirebase(parseEnv().firebaseProjectId);
if (!firebase) throw new Error('Configurar Firebase de Formance.');
const timeout = setTimeout(() => { console.error('Operación demorada. Verificar el manifiesto antes de reintentar.'); process.exit(1); }, 90_000);
try {
  const account = await firebase.auth.getUser(values.uid);
  if (account.email?.toLowerCase() !== values.email.toLowerCase() || account.disabled) throw new Error('La cuenta no coincide con el UID/email indicado.');
  const db = firebase.db; const user = db.collection('users').doc(values.uid);
  const result = await db.runTransaction(async tx => {
    const manifestRef = user.collection('studyImports').doc(`month-v1-${values.from}-${values.to}`);
    const snapshot = await tx.get(manifestRef);
    if (!snapshot.exists || !snapshot.data().simulated) throw new Error('No existe una carga simulada para este período.');
    const manifest = snapshot.data();
    if (manifest.foodPresentationRefinement?.version === 2) return { alreadyApplied: true, ...manifest.foodPresentationRefinement };
    const foodDoc = await tx.get(user.collection('foodLogs').where('demoData.seedId', '==', manifest.seedId));
    const meals = foodDoc.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    const updatedAt = new Date().toISOString();
    const plan = planPresentationRefinement({ manifest, meals, updatedAt });
    const summary = { version: 2, updatedAt, counts: { foodLogs: plan.changes.length }, skippedUserChanges: plan.skipped, simulated: true, nutritionValues: 'illustrative-estimates' };
    if (plan.changes.length * 3 + 1 > 450) throw new Error('Se excedió el límite conservador de escrituras.');
    if (values.apply) {
      for (const change of plan.changes) {
        if (change.kind !== 'foodLogs') throw new Error('La operación solo permite actualizar comidas.');
        const ref = user.collection('foodLogs').doc(change.id);
        tx.create(manifestRef.collection('beforePresentationV2').doc(`${change.kind}-${change.id}`), { path: ref.path, value: change.before, capturedAt: updatedAt });
        tx.set(ref, change.value);
      }
      tx.update(manifestRef, { foodPresentationRefinement: summary });
    }
    return summary;
  });
  console.log(JSON.stringify({ mode: values.apply ? 'aplicado' : 'simulación sin escrituras', ...result }, null, 2));
} finally { clearTimeout(timeout); await firebase.db.terminate(); }
