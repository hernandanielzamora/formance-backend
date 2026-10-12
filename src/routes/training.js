import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { workouts } from '../data/training.js';
import { validateWorkout, validateRoutine, catalogForGoal } from '../services/training.js';

export const trainingRoutes = Router();
trainingRoutes.use(requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.identity.email_verified) return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu correo para continuar.' } });
  req.trainingUser = req.app.locals.firebase.db.collection('users').doc(req.identity.uid);
  next();
});
async function personalWorkouts(req) {
  const snapshot = await req.trainingUser.collection('workouts').orderBy('createdAt', 'desc').limit(100).get();
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
}
trainingRoutes.get('/catalog', async (req, res) => {
  const [profile, custom] = await Promise.all([req.trainingUser.get(), personalWorkouts(req)]);
  res.json(catalogForGoal(profile.exists ? profile.data().goal : null, custom));
});
trainingRoutes.post('/workouts', async (req, res) => {
  const input = validateWorkout(req.body);
  const id = randomUUID();
  const workout = { ...input, id, source: 'personal', version: 1, createdAt: new Date().toISOString() };
  await req.trainingUser.collection('workouts').doc(id).set(workout);
  res.status(201).json({ workout });
});
trainingRoutes.get('/routines', async (req, res) => {
  const [snapshot, settings] = await Promise.all([
    req.trainingUser.collection('routines').orderBy('updatedAt', 'desc').limit(100).get(),
    req.trainingUser.collection('settings').doc('training').get(),
  ]);
  res.json({ routines: snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })), activeRoutineId: settings.exists ? settings.data().activeRoutineId : null });
});
trainingRoutes.post('/routines', async (req, res) => {
  const input = validateRoutine(req.body, [...workouts, ...await personalWorkouts(req)]);
  const id = randomUUID();
  const now = new Date().toISOString();
  const routine = { ...input, id, version: 1, createdAt: now, updatedAt: now };
  const reference = req.trainingUser.collection('routines').doc(id);
  const batch = req.app.locals.firebase.db.batch();
  batch.set(reference, routine);
  batch.set(reference.collection('revisions').doc('1'), routine);
  await batch.commit();
  res.status(201).json({ routine });
});
trainingRoutes.put('/routines/:id', async (req, res) => {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(req.params.id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rutina no encontrada.' } });
  const input = validateRoutine(req.body, [...workouts, ...await personalWorkouts(req)], true);
  const reference = req.trainingUser.collection('routines').doc(req.params.id);
  const result = await req.app.locals.firebase.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return { status: 404, message: 'Rutina no encontrada.' };
    const current = snapshot.data();
    if (current.version !== req.body.expectedVersion) return { status: 409, message: 'La rutina cambió en otra ventana. Recargá antes de editar.' };
    const routine = { ...input, id: req.params.id, version: current.version + 1, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
    transaction.set(reference, routine);
    transaction.set(reference.collection('revisions').doc(String(routine.version)), routine);
    return { routine };
  });
  if (result.status) return res.status(result.status).json({ error: { code: 'ROUTINE_CONFLICT', message: result.message } });
  res.json(result);
});
trainingRoutes.put('/active-routine', async (req, res) => {
  const id = req.body?.routineId;
  if (Object.keys(req.body || {}).length !== 1 || typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return res.status(400).json({ error: { code: 'INVALID_ROUTINE', message: 'Elegí una rutina propia.' } });
  const reference = req.trainingUser.collection('routines').doc(id);
  const success = await req.app.locals.firebase.db.runTransaction(async (transaction) => {
    const routine = await transaction.get(reference);
    if (!routine.exists) return false;
    transaction.set(req.trainingUser.collection('settings').doc('training'), { activeRoutineId: id, updatedAt: new Date().toISOString() });
    return true;
  });
  if (!success) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rutina no encontrada en tu cuenta.' } });
  res.json({ activeRoutineId: id });
});
