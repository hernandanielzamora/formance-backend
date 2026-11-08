import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrainingCatalog } from '../scripts/lib/training-catalog.js';
import { buildDemoStory } from '../scripts/lib/demo-story.js';
import { applyDemoStory, storyRoutineId } from '../scripts/lib/demo-story-apply.js';
import { createFakeFirestore } from '../test-support/memory-firestore.js';
import { buildWeeklyReport, weeklyRange } from '../src/services/reports.js';

const catalog = planTrainingCatalog({}, 'admin', '2026-01-01T00:00:00Z');
const template = catalog.creates.find(item => item.id === 'upper-lower-4').value;
const profile = { onboardingCompleted: true, name: 'Demo', age: 27, sex: 'male', heightCm: 178, initialWeightKg: 79, activity: 'moderate', goal: 'maintain', targets: { calories: 2800, protein: 140, fat: 80, carbohydrates: 350 } };
const zone = 'America/Argentina/Buenos_Aires';
const story = () => buildDemoStory({ profile, routine: { ...template, id: 'r' }, from: '2026-10-01', to: '2026-11-11', zone, createdAt: '2026-11-08T12:00:00Z' });

test('Historia demo: determinista, con altibajos y progresión de cargas', () => {
  const a = story(); const b = story();
  assert.deepEqual(a, b);
  assert.equal(a.goal, 'recomposition');
  assert.equal(a.sessions.filter(item => item.status === 'abandoned').length, 1);
  const squat = day => a.sessions.find(item => item.localDate === day).performedEntries[0].sets[0].externalLoadKg;
  assert.ok(squat('2026-11-10') > squat('2026-10-06'));
  const floja = a.meals.filter(item => item.localDate >= '2026-10-19' && item.localDate <= '2026-10-25');
  assert.equal(new Set(floja.map(item => item.localDate)).size, 4);
  assert.ok(a.weights.at(-1).weightKg < a.weights[0].weightKg);
  assert.ok(a.meals.every(item => item.items.every(food => food.totals.calories !== null)));
});

test('Historia demo: la semana del 2/11 es completa y comparable', () => {
  const a = story();
  const range = weeklyRange({ weekStart: '2026-11-02', timeZone: zone }, '2026-11-11');
  const report = buildWeeklyReport(range, a.sessions, a.meals, a.weights);
  assert.equal(report.current.training.sessions.completed, 4);
  assert.equal(report.current.food.daysWithRecords, 7);
  assert.ok(report.comparison.exercises.some(item => item.maxLoadDelta > 0));
});

test('Historia demo: archiva demos previas, conserva registros reales y es idempotente', async () => {
  const db = createFakeFirestore({
    'users/u': profile, 'users/u/settings/training': { activeRoutineId: 'old' }, 'routines/upper-lower-4': template,
    'users/u/foodLogs/old-meal': { localDate: '2026-09-20', mealType: 'lunch', archived: false, demoData: { simulated: true } },
    'users/u/weightMeasurements/2026-09-20': { localDate: '2026-09-20', weightKg: 80, demoData: { simulated: true } },
    'users/u/weightMeasurements/2026-09-20/revisions/1': { weightKg: 80 },
    'users/u/foodLogs/real-meal': { localDate: '2026-11-04', mealType: 'lunch', archived: false },
    'users/u/weightMeasurements/initial': { weightKg: 79 },
  });
  const dry = await applyDemoStory({ db, uid: 'u', now: '2026-11-08T12:00:00Z' });
  assert.equal(db.store.has('users/u/foodLogs/old-meal'), true);
  assert.deepEqual(dry.realRecordsKept.foodLogs, ['2026-11-04']);
  const done = await applyDemoStory({ db, uid: 'u', apply: true, now: '2026-11-08T12:00:00Z' });
  assert.equal(done.status, 'done');
  assert.equal(db.store.has('users/u/foodLogs/old-meal'), false);
  assert.equal(db.store.has('users/u/weightMeasurements/2026-09-20/revisions/1'), false);
  assert.ok(db.store.has('users/u/demoArchive/foodLogs-old-meal'));
  assert.ok(db.store.has('users/u/foodLogs/real-meal'));
  assert.equal(db.store.has('users/u/foodLogs/demo2-2026-11-04-lunch'), false);
  assert.ok(db.store.has('users/u/weightMeasurements/initial'));
  assert.equal(db.store.get('users/u/settings/training').activeRoutineId, storyRoutineId);
  assert.equal(db.store.get('users/u').goal, 'recomposition');
  assert.equal(done.original.profile.goal, 'maintain');
  const size = db.store.size;
  assert.equal((await applyDemoStory({ db, uid: 'u', apply: true })).alreadyApplied, true);
  assert.equal(db.store.size, size);
});
