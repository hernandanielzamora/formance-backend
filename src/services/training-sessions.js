import { invalid } from './training.js';

export function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) invalid('Campos de sesión inválidos.');
}
export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('Fecha inválida.');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid('Fecha inválida.');
  return value;
}
export function timeZone(value) {
  if (typeof value !== 'string' || value.length > 80) invalid('Zona horaria inválida.');
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
  catch { invalid('Zona horaria inválida.'); }
}
export function localToday(zone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}
export function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) invalid('Referencia de sesión inválida.');
  return value;
}
export function calendarRange(query) {
  const from = date(query.from); const to = date(query.to); const zone = timeZone(query.timeZone);
  const days = (new Date(to) - new Date(from)) / 86400000;
  if (days < 0 || days > 30) invalid('Consultá un período de hasta 31 días.');
  return { from, to, zone };
}
export function sessionSnapshot(routine, assignment, input, now) {
  if (!assignment.exercises?.length) invalid('Esta rutina no tiene una planificación válida. Guardala nuevamente desde el editor.');
  return {
    schemaVersion: 1, id: input.sessionId, version: 1,
    routineId: routine.id, routineVersion: routine.version, routineName: routine.name,
    assignmentId: assignment.assignmentId, workoutId: assignment.workoutId, workoutVersion: assignment.workoutVersion,
    localDate: input.localDate, timeZone: input.timeZone, startedAt: now, finishedAt: null,
    status: 'in_progress', note: '', createdAt: now, updatedAt: now,
    workoutSnapshot: { name: assignment.name, entries: assignment.exercises.map((entry, index) => ({
      entryId: entry.entryId || `entry-${index}`, exerciseId: entry.exerciseId,
      exerciseVersion: entry.exerciseVersion || entry.exerciseSnapshot?.version || 1,
      exerciseName: entry.exerciseName || entry.exerciseSnapshot?.name || 'Ejercicio',
      tracking: entry.tracking || entry.exerciseSnapshot?.tracking || 'reps_weight',
      planned: { sets: entry.sets, repsMin: entry.repsMin, repsMax: entry.repsMax, restSeconds: entry.restSeconds },
    })) },
    performedEntries: assignment.exercises.map((entry, index) => ({ entryId: entry.entryId || `entry-${index}`, exerciseId: entry.exerciseId, sets: [] })),
  };
}
export function validateSessionUpdate(body, session) {
  fields(body, ['expectedVersion', 'status', 'note', 'performedEntries']);
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) invalid('Falta la versión de la sesión.');
  if (!['in_progress', 'completed', 'abandoned'].includes(body.status)) invalid('Estado de sesión inválido.');
  if (typeof body.note !== 'string' || body.note.length > 1500) invalid('La nota admite hasta 1500 caracteres.');
  const planned = session.workoutSnapshot.entries;
  if (!Array.isArray(body.performedEntries) || body.performedEntries.length !== planned.length) invalid('Revisá los ejercicios de la sesión.');
  const setIds = new Set();
  const performedEntries = body.performedEntries.map((entry, index) => {
    fields(entry, ['entryId', 'exerciseId', 'sets']);
    if (entry.entryId !== planned[index].entryId || entry.exerciseId !== planned[index].exerciseId) invalid('No se puede cambiar la planificación histórica de la sesión.');
    if (!Array.isArray(entry.sets) || entry.sets.length > 30) invalid('Registrá hasta 30 series por ejercicio.');
    const sets = entry.sets.map((set, order) => {
      fields(set, ['setId', 'order', 'reps', 'externalLoadKg', 'completed']);
      id(set.setId);
      if (setIds.has(set.setId) || set.order !== order) invalid('Identificadores u orden de series inválidos.');
      setIds.add(set.setId);
      if (set.reps !== null && (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 1000)) invalid('Repeticiones: entre 1 y 1000.');
      if (set.externalLoadKg !== null && (typeof set.externalLoadKg !== 'number' || !Number.isFinite(set.externalLoadKg) || set.externalLoadKg < 0 || set.externalLoadKg > 1000)) invalid('Carga externa: entre 0 y 1000 kg.');
      if (typeof set.completed !== 'boolean' || (set.completed && set.reps === null)) invalid('Ingresá las repeticiones de las series realizadas.');
      return { setId: set.setId, order, reps: set.reps, externalLoadKg: set.externalLoadKg, completed: set.completed };
    });
    return { entryId: entry.entryId, exerciseId: entry.exerciseId, sets };
  });
  if (body.status === 'completed' && !performedEntries.some(entry => entry.sets.some(set => set.completed))) invalid('Registrá al menos una serie realizada antes de finalizar.');
  return { status: body.status, note: body.note.trim(), performedEntries };
}
