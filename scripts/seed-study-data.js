import { parseArgs } from 'node:util';
import { parseEnv } from '../src/config/env.js';
import { createFirebase } from '../src/config/firebase.js';
import { buildStudyData } from './lib/study-data.js';
import { localToday } from '../src/services/training-sessions.js';

const { values } = parseArgs({ options: {
  uid: { type: 'string' }, email: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
  'time-zone': { type: 'string', default: 'America/Argentina/Buenos_Aires' },
  'fallback-template': { type: 'string' }, apply: { type: 'boolean', default: false },
} });
if (!values.uid || !values.email || !values.from || !values.to) throw new Error('Indicar --uid, --email, --from y --to; --apply habilita la escritura.');
const firebase = createFirebase(parseEnv().firebaseProjectId);
if (!firebase) throw new Error('Configurar Firebase de Formance.');
const timeout = setTimeout(() => { console.error('Operación demorada. Verificar el manifiesto y ejecutar un dry-run antes de reintentar.'); process.exit(1); }, 90_000);
try {
  const account = await firebase.auth.getUser(values.uid);
  if (account.email?.toLowerCase() !== values.email.toLowerCase() || account.disabled || !account.emailVerified) throw new Error('Email/UID no coinciden o la cuenta no está activa y verificada. No se escribió nada.');
  const db = firebase.db; const user = db.collection('users').doc(values.uid);
  const result = await db.runTransaction(async tx => {
    const [profileDoc, settingsDoc, sessionsDoc, mealsDoc, weightsDoc] = await Promise.all([
      tx.get(user), tx.get(user.collection('settings').doc('training')),
      tx.get(user.collection('trainingSessions').where('localDate', '>=', values.from).where('localDate', '<=', values.to)),
      tx.get(user.collection('foodLogs').where('localDate', '>=', values.from).where('localDate', '<=', values.to)),
      tx.get(user.collection('weightMeasurements')),
    ]);
    if (!profileDoc.data()?.onboardingCompleted) throw new Error('La cuenta debe completar el onboarding antes de la carga.');
    const createdAt = new Date().toISOString();
    const activeId = settingsDoc.data()?.activeRoutineId;
    let routine; let newRoutine = null;
    if (activeId) {
      const doc = await tx.get(db.collection('routines').doc(activeId));
      if (!doc.exists || doc.data().archived || (doc.data().visibility !== 'public' && doc.data().ownerId !== values.uid)) throw new Error('La rutina activa no está disponible para la cuenta.');
      routine = { ...doc.data(), id: activeId };
    } else {
      if (!values['fallback-template']) throw new Error('La cuenta no tiene rutina activa. Indicar --fallback-template para crear una copia personal.');
      const templateId = values['fallback-template'];
      const template = await tx.get(db.collection('routines').doc(templateId));
      if (!template.exists || template.data().archived || template.data().visibility !== 'public') throw new Error('La plantilla alternativa no está disponible.');
      const id = `study-routine-v1-${templateId}`;
      const previous = await tx.get(db.collection('routines').doc(id));
      if (previous.exists) throw new Error('La rutina de demostración ya existe sin estar activa. Revisar antes de cargar.');
      routine = { ...template.data(), id, name: `Caso de estudio · ${template.data().name}`, ownerId: values.uid, visibility: 'private', source: 'personal', sourceTemplateId: templateId, version: 1, createdAt, updatedAt: createdAt, demoData: { simulated: true, purpose: 'presentation' } };
      newRoutine = routine;
    }
    const manifestRef = user.collection('studyImports').doc(`month-v1-${values.from}-${values.to}`);
    const manifest = await tx.get(manifestRef);
    if (manifest.exists) return { alreadyApplied: true, ...manifest.data() };
    const existing = {
      sessions: sessionsDoc.docs.map(doc => ({ ...doc.data(), id: doc.id })),
      meals: mealsDoc.docs.map(doc => ({ ...doc.data(), id: doc.id })),
      weights: weightsDoc.docs.map(doc => ({ ...doc.data(), id: doc.id })),
    };
    const plan = buildStudyData({ routine, profile: profileDoc.data(), from: values.from, to: values.to, zone: values['time-zone'], today: localToday(values['time-zone']), existing, createdAt });
    const documents = [
      ...plan.sessions.map(value => ({ ref: user.collection('trainingSessions').doc(value.id), value })),
      ...plan.meals.map(value => ({ ref: user.collection('foodLogs').doc(value.id), value })),
      ...plan.weights.map(value => ({ ref: user.collection('weightMeasurements').doc(value.id), value })),
    ];
    const writeCount = documents.length + plan.weights.length + (newRoutine ? 3 : 0) + 1;
    if (writeCount > 450) throw new Error('El plan excede el límite conservador de una transacción. Acortar el período.');
    const summary = { simulated: true, seedId: plan.seedId, from: plan.from, to: plan.to, timeZone: plan.timeZone, routineId: routine.id, routineName: routine.name, routineVersion: routine.version,
      added: { sessions: plan.sessions.length, meals: plan.meals.length, weights: plan.weights.length }, skipped: { sessions: plan.skipped.length, meals: plan.skippedMeals, weights: plan.skippedWeights },
      sessionStatuses: { completed: plan.sessions.filter(item => item.status === 'completed').length, abandoned: plan.sessions.filter(item => item.status === 'abandoned').length },
      historicalPlanSimulated: true, createdAt, newPersonalRoutine: Boolean(newRoutine), createdPaths: documents.map(item => item.ref.path) };
    if (values.apply) {
      if (newRoutine) {
        const ref = db.collection('routines').doc(newRoutine.id);
        tx.create(ref, newRoutine); tx.create(ref.collection('revisions').doc('1'), newRoutine);
        tx.set(user.collection('settings').doc('training'), { ...(settingsDoc.data() || {}), activeRoutineId: newRoutine.id, updatedAt: createdAt });
      }
      for (const { ref, value } of documents) {
        tx.create(ref, value);
        if (ref.parent.id === 'weightMeasurements') tx.create(ref.collection('revisions').doc('1'), value);
      }
      tx.create(manifestRef, summary);
    }
    return summary;
  });
  const { createdPaths, ...summary } = result;
  console.log(JSON.stringify({ mode: values.apply ? 'aplicado' : 'simulación sin escrituras', ...summary }, null, 2));
} finally { clearTimeout(timeout); await firebase.db.terminate(); }
