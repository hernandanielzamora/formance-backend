import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { fixture } from '../test-support/firestore.js';
import { weeklyRange, trainingMetrics, buildWeeklyReport } from '../src/services/reports.js';
const entry = (entryId = 'entry-0', version = 1) => ({ entryId, exerciseId: 'squat', exerciseVersion: version, exerciseName: 'Sentadilla histórica', tracking: 'reps_weight', planned: { sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 } });
const set = (reps, load, completed = true) => ({ setId: `set-${reps}-${load}`, order: 0, reps, externalLoadKg: load, completed });
function session(id, localDate, status, sets, version = 1) {
  return { id, localDate, timeZone: 'America/Argentina/Buenos_Aires', status, routineName: 'Rutina histórica', note: 'Nota original', workoutSnapshot: { name: 'Workout histórico', entries: [entry('entry-0', version)] }, performedEntries: [{ entryId: 'entry-0', exerciseId: 'squat', sets }] };
}
function meal(id, localDate, totals, source = 'manual', archived = false) {
  return { id, localDate, timeZone: 'UTC', mealType: 'lunch', note: '', archived, items: [{ itemId: 'food-1', name: 'Comida histórica', grams: 100, source, totals }] };
}
test('Semanas locales de lunes a domingo y comparación parcial con idénticos días transcurridos', () => {
  const range = weeklyRange({ weekStart: '2026-10-12', timeZone: 'America/Argentina/Buenos_Aires' }, '2026-10-14');
  assert.equal(range.through, '2026-10-14'); assert.equal(range.elapsedDays, 3); assert.equal(range.previousFrom, '2026-10-05'); assert.equal(range.previousThrough, '2026-10-07');
  assert.equal(weeklyRange({ weekStart: '2026-10-05', timeZone: 'UTC' }, '2026-10-14').elapsedDays, 7);
  assert.equal(weeklyRange({ weekStart: '2025-12-29', timeZone: 'UTC' }, '2026-01-01').to, '2026-01-04');
  assert.throws(() => weeklyRange({ weekStart: '2026-10-13', timeZone: 'UTC' }, '2026-10-14'));
  assert.throws(() => weeklyRange({ weekStart: '2026-10-19', timeZone: 'UTC' }, '2026-10-14'));
  assert.throws(() => weeklyRange({ weekStart: '2026-02-30', timeZone: 'UTC' }));
  assert.throws(() => weeklyRange({ weekStart: '2026-10-12', timeZone: 'Invalid/Zone' }));
});
test('Series realizadas, repeticiones y carga externa: cero, desconocido, ejercicios repetidos y versiones', () => {
  const repeated = session('first', '2026-10-12', 'completed', [set(10, 20), set(999, 999, false)]);
  repeated.workoutSnapshot.entries.push(entry('entry-1'));
  repeated.performedEntries.push({ entryId: 'entry-1', exerciseId: 'squat', sets: [set(8, 0)] });
  const interrupted = session('second', '2026-10-13', 'abandoned', [set(5, null)]);
  const open = session('third', '2026-10-14', 'in_progress', [set(2, 5)]);
  const metrics = trainingMetrics([repeated, interrupted, open]);
  assert.equal(metrics.completedSets, 4); assert.equal(metrics.reps, 25); assert.equal(metrics.externalVolumeKg, 210); assert.equal(metrics.recordedLoadSets, 3); assert.equal(metrics.setsWithoutRecordedLoad, 1);
  assert.deepEqual(metrics.sessions, { completed: 1, abandoned: 1, in_progress: 1 });
  assert.equal(metrics.exercises.length, 1); assert.equal(metrics.exercises[0].sessions, 3); assert.equal(metrics.exercises[0].maxLoadKg, 20);
  assert.equal(trainingMetrics([session('unknown', '2026-10-12', 'completed', [set(10, null)])]).externalVolumeKg, null);
  assert.equal(trainingMetrics([session('bodyweight', '2026-10-12', 'completed', [set(10, 0)])]).externalVolumeKg, 0);
  assert.equal(trainingMetrics([session('v1', '2026-10-12', 'completed', [set(10, 5)], 1), session('v2', '2026-10-13', 'completed', [set(10, 5)], 2)]).exercises.length, 2);
});
test('Promedios sobre días con datos, comidas archivadas, fuentes IA y ausencia de registros', () => {
  const range = weeklyRange({ weekStart: '2026-10-12', timeZone: 'UTC' }, '2026-10-14');
  const report = buildWeeklyReport(range, [session('past', '2026-10-08', 'completed', [set(1, 100)]), session('now', '2026-10-12', 'completed', [set(10, 0)])], [
    meal('one', '2026-10-12', { calories: 100, protein: 10, fat: 0, carbohydrates: null }),
    meal('two', '2026-10-12', { calories: 200, protein: 20, fat: 10, carbohydrates: 20 }, 'gemini'),
    meal('three', '2026-10-14', { calories: null, protein: 5, fat: null, carbohydrates: null }),
    meal('archived', '2026-10-12', { calories: 999, protein: 999, fat: 999, carbohydrates: 999 }, 'manual', true),
    meal('future', '2026-10-15', { calories: 9999, protein: 999, fat: 999, carbohydrates: 999 }),
  ]);
  assert.equal(report.current.food.daysWithRecords, 2); assert.equal(report.current.food.meals, 3); assert.equal(report.current.food.estimatedItems, 1);
  assert.equal(report.current.food.nutrients.calories.value, 300); assert.equal(report.current.food.nutrients.calories.average, 300); assert.equal(report.current.food.nutrients.calories.daysWithData, 1);
  assert.equal(report.current.food.nutrients.protein.average, 17.5); assert.equal(report.current.food.nutrients.protein.daysWithData, 2);
  assert.equal(report.current.food.nutrients.fat.value, 10); assert.equal(report.current.food.nutrients.carbohydrates.complete, false);
  assert.equal(report.current.days[1].food.nutrients.calories.value, null); assert.equal(report.current.days[1].food.meals, 0);
  assert.equal(report.previous.training.sessions.completed, 0); assert.equal(report.logs.length, 4);
  assert.equal(report.logs.find(log => log.type === 'training').entries[0].name, 'Sentadilla histórica');
  const empty = buildWeeklyReport(range, [], []); assert.equal(empty.current.food.nutrients.calories.average, null); assert.equal(empty.current.training.externalVolumeKg, null);
  assert.equal(empty.limitations.historicalPlanAvailable, false); assert.equal(empty.comparison.externalVolumeDelta, null);
  const zero = buildWeeklyReport(range, [session('zero', '2026-10-12', 'completed', [set(10, 0)]), session('zero-old', '2026-10-05', 'completed', [set(10, 0)])], []);
  assert.equal(zero.comparison.exercises[0].maxLoadDelta, 0);
});
test('Reporte HTTP privado, lectura sin escrituras ni proveedores de IA y validación de rango', async () => {
  const { db, store } = fixture();
  store.set('users/report-user/trainingSessions/one', session('one', '2026-01-05', 'completed', [set(10, 12)]));
  store.set('users/report-user/foodLogs/one', meal('one', '2026-01-05', { calories: 250, protein: null, fat: 0, carbohydrates: 30 }));
  store.set('users/other/foodLogs/private', meal('private', '2026-01-05', { calories: 9000, protein: 100, fat: 100, carbohydrates: 100 }));
  const before = structuredClone([...store]);
  const app = createApp({ config: parseEnv({ NODE_ENV: 'test' }) });
  app.locals.firebase = { db, auth: { async verifyIdToken(uid) { return { uid, email_verified: uid !== 'unverified', admin: uid === 'admin' }; } } };
  app.locals.foodProviders = new Proxy({}, { get() { throw new Error('No se deben consumir proveedores desde reportes'); } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/reports/weekly?weekStart=2026-01-05&timeZone=UTC`;
  const request = (uid, url = base) => fetch(url, { headers: uid ? { Authorization: `Bearer ${uid}` } : {} });
  try {
    assert.equal((await request()).status, 401); assert.equal((await request('unverified')).status, 403);
    const response = await request('report-user'); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const report = await response.json(); assert.equal(report.current.training.externalVolumeKg, 120); assert.equal(report.current.food.nutrients.calories.value, 250); assert.equal(report.logs.length, 2);
    assert.equal((await (await request('admin')).json()).logs.length, 0);
    assert.equal((await (await request('report-user', `${base}&uid=other`)).json()).current.food.nutrients.calories.value, 250);
    assert.equal((await request('report-user', base.replace('2026-01-05', '2026-01-06'))).status, 400);
    assert.equal((await request('report-user', base.replace('2026-01-05', '2099-01-05'))).status, 400);
    assert.deepEqual([...store], before);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
