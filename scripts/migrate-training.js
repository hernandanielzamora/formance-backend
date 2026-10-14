import { parseEnv } from '../src/config/env.js';
import { createFirebase } from '../src/config/firebase.js';
import { exercises, workouts, routineTemplates } from './fixtures/training.js';
import { validateWorkout, validateRoutine } from '../src/services/training.js';

// Idempotente: solo crea documentos ausentes y conserva los originales legacy.
const firebase = createFirebase(parseEnv().firebaseProjectId);
if (!firebase) throw new Error('Configurar Firebase antes de migrar.');
const admin = await firebase.auth.getUserByEmail('hernanzamora1999@gmail.com');
if (!admin.emailVerified || admin.disabled || admin.customClaims?.admin !== true) throw new Error('Se requiere la cuenta admin verificada.');
let created = 0, existing = 0;
const now = new Date().toISOString();
async function createOnce(kind, id, value, revisions = []) {
  const ref = firebase.db.collection(kind).doc(id);
  await firebase.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) { existing++; return; }
    transaction.set(ref, value);
    transaction.set(ref.collection('revisions').doc(String(value.version)), value);
    for (const revision of revisions) transaction.set(ref.collection('revisions').doc(revision.id), revision.value);
    created++;
  });
}
const base = { ownerId: admin.uid, visibility: 'public', source: 'catalog', archived: false, version: 1, createdAt: now, updatedAt: now };
for (const item of exercises) await createOnce('exercises', item.id, { ...item, ...base });
const seededWorkouts = workouts.map(item => ({ ...validateWorkout({ name:item.name, focus:item.focus, exercises:item.exercises }, exercises), ...base, id:item.id }));
for (const item of seededWorkouts) await createOnce('workouts', item.id, item);
for (const item of routineTemplates) await createOnce('routines', item.id, { ...validateRoutine({ name:item.name, days:item.days, sourceTemplateId:null, goals:item.goals }, seededWorkouts, exercises), ...base, id:item.id, description:item.description, level:item.level, rationale:item.rationale });
for (const kind of ['workouts','routines']) {
  const legacy = await firebase.db.collectionGroup(kind).get();
  for (const doc of legacy.docs) {
    const match = /^users\/([^/]+)\/(workouts|routines)\/([^/]+)$/.exec(doc.ref.path);
    if (!match) continue;
    const data = doc.data();
    const ref = firebase.db.collection(kind).doc(doc.id);
    const target = await ref.get();
    if (target.exists && target.data().ownerId !== match[1]) throw new Error('Colisión de identidad durante la migración. No se sobrescribió el documento.');
    const revisions = await doc.ref.collection('revisions').get();
    await createOnce(kind, doc.id, { ...data, id:doc.id, ownerId:match[1], visibility:'private', source:'personal', archived:false, version:data.version || 1, updatedAt:data.updatedAt || data.createdAt || now, ...(kind==='routines'?{goals:data.goals || []}:{} ) }, revisions.docs.map(r=>({id:r.id,value:r.data()})));
  }
}
console.log(`Migración verificada: ${created} documentos creados, ${existing} ya existentes. Originales conservados.`);
await firebase.db.terminate();
