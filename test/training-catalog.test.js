import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSeeds, catalogGoals, planTrainingCatalog, seedTrainingCatalog } from '../scripts/lib/training-catalog.js';
import { sessionSnapshot } from '../src/services/training-sessions.js';

const blank = () => ({ exercises: new Map(), workouts: new Map(), routines: new Map() });
function memoryDb() {
  const store = new Map();
  const ref = path => ({ path, collection: kind => ({ doc: id => ref(`${path}/${kind}/${id}`) }) });
  return { store, collection: kind => ({ doc: id => ref(`${kind}/${id}`) }), async runTransaction(callback) {
    const staged = [];
    const result = await callback({
      async get(reference) { return { exists: store.has(reference.path), data: () => structuredClone(store.get(reference.path)) }; },
      create(reference, value) { assert.ok(!store.has(reference.path)); staged.push([reference.path, structuredClone(value)]); },
    });
    for (const [path, value] of staged) store.set(path, value);
    return result;
  } };
}

test('Catálogo completo: objetivos con tres opciones distintas, referencias y snapshots registrables', () => {
  const plan = planTrainingCatalog(blank(), 'admin');
  assert.deepEqual(plan.totals, { exercises: 42, workouts: 20, routines: 12 });
  for (const goal of catalogGoals) {
    const routines = plan.creates.filter(item => item.kind === 'routines' && item.value.goals.includes(goal));
    assert.ok(routines.length >= 3);
    assert.equal(new Set(routines.map(item => JSON.stringify(item.value.days.map(day => day.workoutIds)))).size, routines.length);
  }
  const usedExercises = new Set(); const usedWorkouts = new Set();
  for (const { value: routine } of plan.creates.filter(item => item.kind === 'routines')) {
    assert.equal(routine.days.length, 7);
    assert.ok(routine.days.some(day => !day.assignments.length));
    for (const day of routine.days) for (const assignment of day.assignments) {
      usedWorkouts.add(assignment.workoutId);
      const session = sessionSnapshot(routine, assignment, { sessionId: 'preview', localDate: '2026-10-12', timeZone: 'UTC' }, '2026-10-12T12:00:00Z');
      for (const entry of session.workoutSnapshot.entries) {
        usedExercises.add(entry.exerciseId);
        assert.ok(entry.exerciseName && entry.planned.sets > 0 && entry.planned.repsMin <= entry.planned.repsMax);
        assert.equal(entry.tracking, 'reps_weight');
      }
    }
  }
  assert.equal(usedWorkouts.size, 20);
  // Some standalone exercise alternatives need not appear in an initial template.
  assert.ok(usedExercises.size >= 38);
});

test('Carga idempotente y atómica: dry-run sin escrituras, revisiones, documentos personales e historial intactos', async () => {
  const db = memoryDb();
  db.store.set('users/person/trainingSessions/log', { note: 'Histórico' });
  db.store.set('routines/personal', { visibility: 'private', ownerId: 'person' });
  const before = structuredClone(db.store);
  const preview = await seedTrainingCatalog(db, 'admin');
  assert.equal(preview.creates.length, 74); assert.deepEqual(db.store, before);
  const first = await seedTrainingCatalog(db, 'admin', true);
  assert.equal(first.creates.length, 74);
  for (const item of first.creates) assert.deepEqual(db.store.get(`${item.kind}/${item.id}/revisions/1`), db.store.get(`${item.kind}/${item.id}`));
  const existing = structuredClone(db.store);
  const again = await seedTrainingCatalog(db, 'admin', true);
  assert.equal(again.creates.length, 0); assert.equal(again.preserved.length, 74);
  assert.deepEqual(db.store, existing);
  for (const [path, value] of before) assert.deepEqual(db.store.get(path), value);
});

test('Las nuevas rutinas usan nombres/versiones reales, sin restaurar fixtures sobre ediciones admin', () => {
  const old = planTrainingCatalog(blank(), 'admin', '2026-01-01T00:00:00Z');
  const current = blank();
  for (const item of old.creates.filter(item => item.kind !== 'routines')) current[item.kind].set(item.id, item.value);
  const workout = current.workouts.get('machines-full-a');
  workout.name = 'Máquinas personalizado'; workout.version = 7;
  workout.exercises[0].exerciseSnapshot.name = 'Nombre histórico del ejercicio';
  const before = structuredClone(current);
  const plan = planTrainingCatalog(current, 'admin');
  const routine = plan.creates.find(item => item.id === 'fat-loss-machines-2').value;
  const assignment = routine.days[1].assignments[0];
  assert.equal(assignment.name, workout.name); assert.equal(assignment.workoutVersion, 7);
  assert.equal(assignment.exercises[0].exerciseName, 'Nombre histórico del ejercicio');
  assert.deepEqual(current, before);
});

test('Colisión con documentos privados/archivados bloquea la operación completa', async () => {
  for (const document of [{ visibility: 'private', source: 'personal', version: 1 }, { visibility: 'public', source: 'catalog', version: 1, archived: true }]) {
    const db = memoryDb(); db.store.set('workouts/full-body-a', document);
    const before = structuredClone(db.store);
    await assert.rejects(seedTrainingCatalog(db, 'admin', true), /Conflicto/);
    assert.deepEqual(db.store, before);
  }
  assert.equal(Object.values(catalogSeeds).flat().length, 74);
});
