import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { fixture } from '../test-support/firestore.js';
import { date, timeZone, calendarRange, validateSessionUpdate } from '../src/services/training-sessions.js';

test('Fechas locales, zonas horarias y entradas de series se validan sin convertir vacío en cero', () => {
  assert.throws(() => date('2026-02-30'));
  assert.throws(() => timeZone('No/Existe'));
  assert.throws(() => calendarRange({ from: '2026-01-01', to: '2026-03-01', timeZone: 'UTC' }));
  const session = { workoutSnapshot: { entries: [{ entryId: 'entry-0', exerciseId: 'squat' }] } };
  const body = { expectedVersion: 1, status: 'in_progress', note: '', performedEntries: [{ entryId: 'entry-0', exerciseId: 'squat', sets: [{ setId: 'set-1', order: 0, reps: 10, externalLoadKg: 0, completed: true }] }] };
  assert.equal(validateSessionUpdate(body, session).performedEntries[0].sets[0].externalLoadKg, 0);
  body.performedEntries[0].sets[0].externalLoadKg = null;
  assert.equal(validateSessionUpdate(body, session).performedEntries[0].sets[0].externalLoadKg, null);
  for (const value of [-1, '10', Infinity]) { body.performedEntries[0].sets[0].externalLoadKg = value; assert.throws(() => validateSessionUpdate(body, session)); }
  body.performedEntries[0].sets[0].externalLoadKg = 10;
  body.performedEntries[0].sets[0].reps = null;
  assert.throws(() => validateSessionUpdate(body, session));
  body.performedEntries[0].sets[0].completed = false;
  assert.throws(() => validateSessionUpdate({ ...body, status: 'completed' }, session));
  body.performedEntries[0].exerciseId = 'foreign';
  assert.throws(() => validateSessionUpdate(body, session));
});

test('Calendario y logs privados: snapshots, idempotencia, series, conflictos y cierre', async () => {
  const { db, store } = fixture();
  const app = createApp({ config: parseEnv({ NODE_ENV: 'test' }) });
  app.locals.firebase = { db, auth: { async verifyIdToken(uid) { return { uid, email_verified: true, admin: uid === 'admin' }; } } };
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/training`;
  const request = (path, method = 'GET', body, user = 'user') => fetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const workouts = [store.get('workouts/full-body-a') || [...store.entries()].find(([key]) => key.startsWith('workouts/'))[1]];
    const days = Array.from({ length: 7 }, (_, dayIndex) => ({ dayIndex, workoutIds: dayIndex === 0 ? [workouts[0].id, workouts[0].id] : [] }));
    const routineResponse = await request('routines', 'POST', { name: 'Plan semanal', days });
    assert.equal(routineResponse.status, 201); const { routine } = await routineResponse.json();
    await request('active-routine', 'PUT', { routineId: routine.id });
    const range = 'calendar?from=2026-01-05&to=2026-01-11&timeZone=America%2FArgentina%2FBuenos_Aires';
    const calendar = await (await request(range)).json();
    assert.equal(calendar.routine.id, routine.id); assert.equal(calendar.routine.days[1].assignments.length, 0);
    const input = { sessionId: 'session-1', routineId: routine.id, routineVersion: 1, assignmentId: 'day-0-slot-0', localDate: '2026-01-05', timeZone: 'America/Argentina/Buenos_Aires' };
    assert.equal((await request('sessions', 'POST', { ...input, ownerId: 'other' })).status, 400);
    assert.equal((await request('sessions', 'POST', { ...input, localDate: '2026-01-06' })).status, 400);
    assert.equal((await request('sessions', 'POST', { ...input, localDate: '2099-01-05' })).status, 400);
    assert.equal((await request('sessions', 'POST', { ...input, routineVersion: 2 })).status, 409);
    assert.equal((await request('sessions', 'POST', input, 'other')).status, 404);
    const created = await request('sessions', 'POST', input); assert.equal(created.status, 201);
    const original = (await created.json()).session;
    assert.equal(original.workoutSnapshot.entries[0].exerciseName, routine.days[0].assignments[0].exercises[0].exerciseName);
    assert.equal((await request('sessions', 'POST', input)).status, 200);
    assert.equal((await request('sessions', 'POST', { ...input, assignmentId: 'day-0-slot-1' })).status, 409);
    assert.equal((await request('sessions/session-1', 'GET', undefined, 'other')).status, 404);
    assert.equal((await request('sessions/session-1', 'GET', undefined, 'admin')).status, 404);
    const body = { expectedVersion: 1, status: 'in_progress', note: 'Primera sesión', performedEntries: original.performedEntries.map((entry, index) => ({ ...entry, sets: index === 0 ? [{ setId: 'set-1', order: 0, reps: 10, externalLoadKg: 0, completed: true }, { setId: 'set-2', order: 1, reps: 8, externalLoadKg: null, completed: true }] : [] })) };
    assert.equal((await request('sessions/session-1', 'PUT', body)).status, 200);
    assert.equal((await request('sessions/session-1', 'PUT', body)).status, 409);
    const second = await request('sessions', 'POST', { ...input, sessionId: 'session-2', assignmentId: 'day-0-slot-1' });
    assert.equal(second.status, 201);
    const interrupted = await request('sessions/session-2', 'PUT', { ...body, status: 'abandoned' });
    assert.equal(interrupted.status, 200);
    assert.equal((await interrupted.json()).session.status, 'abandoned');
    store.set(`routines/${routine.id}`, { ...store.get(`routines/${routine.id}`), name: 'Otro plan', version: 2, archived: true });
    const completed = await request('sessions/session-1', 'PUT', { ...body, expectedVersion: 2, status: 'completed' });
    assert.equal(completed.status, 200); const closed = (await completed.json()).session;
    assert.equal(closed.routineName, 'Plan semanal'); assert.equal(closed.routineVersion, 1); assert.ok(closed.finishedAt);
    assert.deepEqual(closed.workoutSnapshot, original.workoutSnapshot);
    assert.equal((await request('sessions/session-1', 'PUT', { ...body, expectedVersion: 3 })).status, 409);
    const result = await (await request(range)).json(); assert.equal(result.routine, null); assert.equal(result.sessions.length, 2);
    assert.equal(result.sessions[0].performedEntries[0].sets[0].externalLoadKg, 0);
    assert.equal((await (await request(range, 'GET', undefined, 'other')).json()).sessions.length, 0);
    assert.equal((await (await request(range.replace('America%2FArgentina%2FBuenos_Aires', 'UTC'))).json()).sessions.length, 2);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
