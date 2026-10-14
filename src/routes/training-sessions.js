import { Router } from 'express';
import { canRead, invalid } from '../services/training.js';
import { fields, date, timeZone, localToday, id, calendarRange, sessionSnapshot, validateSessionUpdate } from '../services/training-sessions.js';

export const sessionRoutes = Router();
const failure = (res, status, message) => res.status(status).json({ error: { code: status === 409 ? 'VERSION_CONFLICT' : 'NOT_FOUND', message } });
async function sessionsInRange(req, range) {
  const snapshot = await req.trainingUser.collection('trainingSessions').where('localDate', '>=', range.from).where('localDate', '<=', range.to).limit(201).get();
  if (snapshot.docs.length > 200) invalid('Hay demasiadas sesiones en este período. Consultá menos días.');
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
sessionRoutes.get('/calendar', async (req, res) => {
  const range = calendarRange(req.query);
  const db = req.app.locals.firebase.db;
  const [settings, sessions] = await Promise.all([req.trainingUser.collection('settings').doc('training').get(), sessionsInRange(req, range)]);
  const activeId = settings.exists ? settings.data().activeRoutineId : null;
  let routine = null;
  if (activeId) {
    const doc = await db.collection('routines').doc(activeId).get();
    if (doc.exists && !doc.data().archived && canRead(req.identity, doc.data())) routine = { ...doc.data(), id: doc.id };
  }
  res.json({ routine, sessions, timeZone: range.zone, today: localToday(range.zone) });
});
sessionRoutes.get('/sessions/:id', async (req, res) => {
  const doc = await req.trainingUser.collection('trainingSessions').doc(id(req.params.id)).get();
  if (!doc.exists) return failure(res, 404, 'Sesión no encontrada.');
  res.json({ session: { ...doc.data(), id: doc.id } });
});
sessionRoutes.post('/sessions', async (req, res) => {
  fields(req.body, ['sessionId', 'routineId', 'routineVersion', 'assignmentId', 'localDate', 'timeZone']);
  const input = { sessionId: id(req.body.sessionId), routineId: id(req.body.routineId), routineVersion: req.body.routineVersion, assignmentId: id(req.body.assignmentId), localDate: date(req.body.localDate), timeZone: timeZone(req.body.timeZone) };
  if (!Number.isInteger(input.routineVersion) || input.routineVersion < 1) invalid('Versión de rutina inválida.');
  if (input.localDate > localToday(input.timeZone)) invalid('No se pueden registrar entrenamientos futuros.');
  const db = req.app.locals.firebase.db;
  const ref = req.trainingUser.collection('trainingSessions').doc(input.sessionId);
  const result = await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const session = existing.data();
      if (['routineId', 'routineVersion', 'assignmentId', 'localDate', 'timeZone'].every(key => session[key] === input[key])) return { session, existing: true };
      return { status: 409, message: 'El identificador ya pertenece a otra sesión.' };
    }
    const settings = await tx.get(req.trainingUser.collection('settings').doc('training'));
    const snapshot = await tx.get(db.collection('routines').doc(input.routineId));
    if (!settings.exists || settings.data().activeRoutineId !== input.routineId || !snapshot.exists || snapshot.data().archived || !canRead(req.identity, snapshot.data())) return { status: 404, message: 'La rutina activa ya no está disponible.' };
    const routine = { ...snapshot.data(), id: snapshot.id || input.routineId };
    if (routine.version !== input.routineVersion) return { status: 409, message: 'La rutina cambió. Actualizá el calendario antes de registrar.' };
    const dayIndex = (new Date(`${input.localDate}T12:00:00Z`).getUTCDay() + 6) % 7;
    const assignment = routine.days[dayIndex]?.assignments?.find(item => item.assignmentId === input.assignmentId);
    if (!assignment) invalid('Este workout no está planificado para ese día.');
    const session = sessionSnapshot(routine, assignment, input, new Date().toISOString());
    tx.set(ref, session);
    return { session };
  });
  if (result.status) return failure(res, result.status, result.message);
  res.status(result.existing ? 200 : 201).json({ session: result.session });
});
sessionRoutes.put('/sessions/:id', async (req, res) => {
  const ref = req.trainingUser.collection('trainingSessions').doc(id(req.params.id));
  const result = await req.app.locals.firebase.db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) return { status: 404, message: 'Sesión no encontrada.' };
    const current = doc.data();
    const update = validateSessionUpdate(req.body, current);
    if (current.version !== req.body.expectedVersion) return { status: 409, message: 'La sesión cambió en otra pestaña. Recargá antes de guardar.' };
    if (current.status !== 'in_progress') return { status: 409, message: 'Esta sesión ya está cerrada y conserva su registro.' };
    const now = new Date().toISOString();
    const session = { ...current, ...update, version: current.version + 1, updatedAt: now, finishedAt: update.status === 'in_progress' ? null : now };
    tx.set(ref, session); return { session };
  });
  if (result.status) return failure(res, result.status, result.message);
  res.json({ session: result.session });
});
