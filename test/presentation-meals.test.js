import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrainingCatalog } from '../scripts/lib/training-catalog.js';
import { buildStudyData } from '../scripts/lib/study-data.js';
import { planPresentationRefinement } from '../scripts/lib/presentation-meals.js';
import { scale, total } from '../src/services/food.js';

function fixture() {
  const catalog = planTrainingCatalog({ exercises: new Map(), workouts: new Map(), routines: new Map() }, 'admin');
  const routine = { ...catalog.creates.find(item => item.id === 'flexible-3').value, name: 'Caso de estudio · Fuerza flexible · 3 días', demoData: { simulated: true }, updatedAt: '2026-10-16T12:00:00Z' };
  const data = buildStudyData({ routine, profile: { initialWeightKg: 80 }, from: '2026-09-16', to: '2026-10-15', zone: 'America/Argentina/Buenos_Aires', today: '2026-10-16', createdAt: routine.updatedAt });
  const manifest = { seedId: data.seedId, simulated: true, routineId: routine.id, routineVersion: 1, from: data.from, to: data.to, createdAt: routine.updatedAt };
  return { ...data, routine, manifest, updatedAt: '2026-10-16T16:00:00Z' };
}

test('Comidas variadas, porciones consistentes y nutrientes recalculados conservan identidad y procedencia', () => {
  const data = fixture(); const plan = planPresentationRefinement(data);
  const meals = plan.changes.filter(item => item.kind === 'foodLogs').map(item => item.value);
  assert.equal(meals.length, 120);
  for (const mealType of ['breakfast', 'lunch', 'snack', 'dinner']) assert.equal(new Set(meals.filter(item => item.mealType === mealType).map(item => item.note)).size, 7);
  for (const meal of meals) {
    assert.equal(meal.version, 2); assert.equal(meal.demoData.simulated, true);
    assert.equal(meal.demoData.nutritionValues, 'illustrative-estimates');
    assert.ok(!/demo|simulad|fictici|ilustrativ/i.test(meal.note));
    assert.ok(meal.items.every(item => item.source === 'manual' && item.grams > 0));
    for (const item of meal.items) assert.deepEqual(item.totals, scale(item.nutrients, item.grams / 100));
    assert.deepEqual(meal.totals, total(meal.items));
    const before = data.meals.find(item => item.id === meal.id);
    assert.equal(meal.localDate, before.localDate); assert.equal(meal.createdAt, before.createdAt);
  }
  assert.ok(plan.changes.every(item => item.kind === 'foodLogs'));
});

test('No modifica registros ajenos, archivados o editados y la repetición no sobrescribe cambios', () => {
  const data = fixture(); data.meals[0].version = 3; data.meals[1].archived = true;
  data.meals.push({ id: 'real-meal', note: 'Mi registro' });
  data.sessions[0].version = 2;
  const plan = planPresentationRefinement(data);
  assert.equal(plan.skipped.length, 2);
  assert.ok(!plan.changes.some(item => item.id === 'real-meal' || item.id === data.meals[0].id || item.id === data.meals[1].id));
  assert.ok(!plan.changes.some(item => item.kind === 'routines'));
  const again = planPresentationRefinement({ ...data, manifest: { ...data.manifest, foodPresentationRefinement: { version: 2 } } });
  assert.equal(again.changes.length, 0); assert.equal(again.alreadyApplied, true);
});
