import test from 'node:test';
import assert from 'node:assert/strict';
import { exercises, workouts, routineTemplates } from '../src/data/training.js';
import { catalogForGoal, validateRoutine, validateWorkout } from '../src/services/training.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

test('Catálogo íntegro y sugerencias sin bloquear otros objetivos', () => {
  assert.equal(new Set(exercises.map((e) => e.id)).size, exercises.length);
  for (const workout of workouts) validateWorkout({ name: workout.name, focus: workout.focus, exercises: workout.exercises });
  for (const template of routineTemplates) validateRoutine({ name: template.name, days: template.days, sourceTemplateId: template.id }, workouts);
  const catalog = catalogForGoal('fat_loss');
  assert.equal(catalog.routineTemplates.length, routineTemplates.length);
  assert.equal(catalog.routineTemplates[0].recommended, true);
  assert.ok(catalog.routineTemplates.some((r) => r.goals.includes('muscle')));
  assert.equal(catalogForGoal(null).routineTemplates.length, routineTemplates.length);
});
test('Rutina conserva repeticiones de ejercicios/asignaciones y rechaza datos no autorizados', () => {
  const days = routineTemplates[0].days.map((d) => ({ ...d, workoutIds: [...d.workoutIds] }));
  days[0].workoutIds = ['full-body-a', 'full-body-a'];
  const body = { name: 'Mi semana', days };
  const result = validateRoutine(body, workouts);
  assert.notEqual(result.days[0].assignments[0].assignmentId, result.days[0].assignments[1].assignmentId);
  assert.equal(result.days[0].assignments[0].exercises[0].exerciseVersion, 1);
  assert.throws(() => validateRoutine({ ...body, owner: 'other' }, workouts));
  assert.throws(() => validateRoutine({ name: 'Invalid', days: days.slice(1) }, workouts));
  assert.throws(() => validateRoutine({ ...body, expectedVersion: 0 }, workouts, true));
  const foreign = structuredClone(body); foreign.days[0].workoutIds = ['private-other'];
  assert.throws(() => validateRoutine(foreign, workouts));
  const repeat = validateWorkout({ name: 'Repeated', focus: 'Core', exercises: [workouts[0].exercises[0], workouts[0].exercises[0]] });
  assert.notEqual(repeat.exercises[0].entryId, repeat.exercises[1].entryId);
});

function fakeDb() {
  const store = new Map([['users/owner', { goal: 'fat_loss' }]]);
  function ref(path) { return { path, collection: (name) => collection(`${path}/${name}`), async get() { return { exists: store.has(path), data: () => structuredClone(store.get(path)) }; }, async set(data) { store.set(path, structuredClone(data)); } }; }
  function collection(path) {
    const query = { doc: (id) => ref(`${path}/${id}`), orderBy: () => query, limit: () => query, async get() { return { docs: [...store.entries()].filter(([key]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).indexOf('/') < 0).map(([key, value]) => ({ id: key.split('/').pop(), data: () => structuredClone(value) })) }; } };
    return query;
  }
  const db = { collection, batch() { const writes = []; return { set: (reference, value) => writes.push([reference.path, value]), async commit() { for (const [path, value] of writes) store.set(path, structuredClone(value)); } }; }, async runTransaction(callback) { const batch = db.batch(); const result = await callback({ get: (reference) => reference.get(), set: batch.set }); await batch.commit(); return result; } };
  return { db, store };
}
test('API aísla cuentas y guarda revisiones atómicas sin modificar snapshots anteriores', async () => {
  const { db, store } = fakeDb();
  const app = createApp({ config: parseEnv({ NODE_ENV: 'test' }) });
  app.locals.firebase = { db, auth: { async verifyIdToken(token) { return { uid: token === 'other' ? 'other' : 'owner', email_verified: token !== 'unverified' }; } } };
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/training`;
  const request = (path, method = 'GET', body, token = 'owner') => fetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await request('catalog', 'GET', undefined, 'unverified')).status, 403);
    const catalog = await (await request('catalog')).json();
    assert.equal(catalog.userGoal, 'fat_loss');
    const template = catalog.routineTemplates[0];
    const create = await request('routines', 'POST', { name: 'Mi rutina', days: template.days, sourceTemplateId: template.id });
    assert.equal(create.status, 201);
    const { routine } = await create.json();
    assert.equal(routine.version, 1);
    const revision = structuredClone(store.get(`users/owner/routines/${routine.id}/revisions/1`));
    assert.equal((await request('active-routine', 'PUT', { routineId: routine.id }, 'other')).status, 404);
    assert.equal((await request('routines', 'GET', undefined, 'other')).status, 200);
    assert.equal((await (await request('routines', 'GET', undefined, 'other')).json()).routines.length, 0);
    assert.equal((await request('active-routine', 'PUT', { routineId: routine.id })).status, 200);
    const updateBody = { name: 'Editada', days: template.days, sourceTemplateId: template.id, expectedVersion: 1 };
    assert.equal((await request(`routines/${routine.id}`, 'PUT', updateBody, 'other')).status, 404);
    const update = await request(`routines/${routine.id}`, 'PUT', updateBody);
    assert.equal(update.status, 200);
    assert.equal((await update.json()).routine.version, 2);
    assert.deepEqual(store.get(`users/owner/routines/${routine.id}/revisions/1`), revision);
    assert.equal((await request(`routines/${routine.id}`, 'PUT', updateBody)).status, 409);
    const custom = await request('workouts', 'POST', { name: 'Personal', focus: 'Core', exercises: [workouts[0].exercises[0]] });
    assert.equal(custom.status, 201);
    const customId = (await custom.json()).workout.id;
    assert.ok((await (await request('catalog')).json()).workouts.some((w) => w.id === customId));
    assert.ok(!(await (await request('catalog', 'GET', undefined, 'other')).json()).workouts.some((w) => w.id === customId));
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
