import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyReport, weeklyRange, shiftDate } from '../src/services/reports.js';
import { weeklyGlance, plannedWeekdays } from '../src/services/weekly-glance.js';

const zone = 'UTC';
const routine = { createdAt: '2026-01-01T00:00:00Z', days: Array.from({ length: 7 }, (_, i) => ({ assignments: [0, 1, 3, 4].includes(i) ? [{ assignmentId: `a${i}` }] : [] })) };
const targets = { calories: 2500, protein: 160, fat: 70, carbohydrates: 300 };
const session = (date, load, status = 'completed') => ({ id: `s-${date}`, localDate: date, status,
  workoutSnapshot: { name: 'W', entries: [{ entryId: 'e', exerciseId: 'squat', exerciseVersion: 1, exerciseName: 'Sentadilla con barra', tracking: 'reps_weight', planned: { sets: 1, repsMin: 8, repsMax: 10 } }] },
  performedEntries: [{ entryId: 'e', exerciseId: 'squat', sets: [{ setId: `x${date}`, reps: 8, externalLoadKg: load, completed: true }] }] });
const meal = (date, kcal, protein) => ({ id: `m-${date}`, localDate: date, mealType: 'lunch', archived: false, items: [{ itemId: 'i', totals: { calories: kcal, protein, fat: 50, carbohydrates: 200 } }] });
const weight = (date, kg) => ({ id: date, localDate: date, weightKg: kg, timeZone: zone });
const week = (monday, fn) => Array.from({ length: 7 }, (_, i) => fn(shiftDate(monday, i), i)).filter(Boolean);
function glance(weekStart, now, data, context = { goal: 'recomposition', targets, routine }) {
  return weeklyGlance(buildWeeklyReport(weeklyRange({ weekStart, timeZone: zone }, now), data.sessions, data.meals, data.weights), context);
}
const previous = { sessions: week('2026-01-05', (d, i) => [0, 1, 3, 4].includes(i) && session(d, 80)), meals: week('2026-01-05', d => meal(d, 2500, 160)), weights: week('2026-01-05', (d, i) => i % 2 === 0 && weight(d, 80)) };

test('Lectura: semana completa con récord, proteína y peso alineados, pico de fin de semana', () => {
  const current = { sessions: week('2026-01-12', (d, i) => [0, 1, 3, 4].includes(i) && session(d, 85)),
    meals: week('2026-01-12', (d, i) => meal(d, i === 5 ? 3400 : i === 6 ? 2900 : 2500, 165)), weights: week('2026-01-12', (d, i) => i % 2 === 0 && weight(d, 79.6)) };
  const g = glance('2026-01-12', '2026-01-20', { sessions: [...previous.sessions, ...current.sessions], meals: [...previous.meals, ...current.meals], weights: [...previous.weights, ...current.weights] });
  assert.equal(g.headline.tone, 'good');
  assert.equal(g.training.completedPlanned, 4); assert.equal(g.training.planned, 4);
  assert.deepEqual(g.training.records.map(item => [item.name, item.deltaKg]), [['Sentadilla con barra', 5]]);
  assert.match(g.headline.text, /^Cumpliste tu rutina, subiste carga en Sentadilla con barra y comiste en objetivo/);
  assert.match(g.wins[0].text, /4 de 4 días planificados y subiste carga en Sentadilla con barra \(85 kg, \+5 kg\)/);
  assert.equal(g.nutrition.onTargetDays, 5); assert.equal(g.nutrition.proteinDays, 7);
  assert.equal(g.weight.deltaKg, -0.4); assert.equal(g.weight.aligned, true);
  assert.match(g.improvements[0].text, /fin de semana comiste \d+ % más/);
  assert.equal(g.focus.href, '/app/alimentacion');
  assert.deepEqual(g.wins.map(item => item.area), ['training', 'nutrition', 'weight']);
});

test('Lectura: semana floja prioriza entrenamientos salteados, registro incompleto y peso opuesto al objetivo', () => {
  const current = { sessions: [session('2026-01-12', 80), session('2026-01-13', 80, 'abandoned')],
    meals: [meal('2026-01-12', 3000, 110), meal('2026-01-13', 3100, 100), meal('2026-01-17', 3300, 100)], weights: [weight('2026-01-12', 80.6), weight('2026-01-18', 80.8)] };
  const g = glance('2026-01-12', '2026-01-20', { sessions: [...previous.sessions, ...current.sessions], meals: [...previous.meals, ...current.meals], weights: [...previous.weights, ...current.weights] });
  assert.equal(g.headline.tone, 'attention');
  assert.deepEqual(g.training.missed, ['2026-01-15', '2026-01-16']);
  assert.equal(g.training.days[1].state, 'partial');
  assert.deepEqual(g.improvements.map(item => item.area), ['training', 'nutrition', 'weight']);
  assert.match(g.improvements[1].text, /3 de 7 días/);
  assert.equal(g.weight.aligned, false);
});

test('Lectura: semana en curso no cuenta días futuros ni el de hoy como salteados', () => {
  const g = glance('2026-01-19', '2026-01-20', { sessions: [...previous.sessions, session('2026-01-19', 85)], meals: [meal('2026-01-19', 2500, 160)], weights: [] });
  assert.equal(g.training.planned, 1); assert.deepEqual(g.training.missed, []);
  assert.equal(g.training.days[1].state, 'today'); assert.equal(g.training.days[3].state, 'future');
  assert.match(g.headline.title, /esta semana/);
});

test('Lectura: sin objetivo ni rutina describe lo registrado; sin registros invita a empezar', () => {
  const g = glance('2026-01-12', '2026-01-20', { sessions: [session('2026-01-12', 80)], meals: [meal('2026-01-12', 2000, 90)], weights: [] }, {});
  assert.equal(g.training.planned, null); assert.equal(g.nutrition.kcalTarget, null); assert.equal(g.nutrition.days[0].state, 'logged');
  const empty = glance('2026-01-12', '2026-01-20', { sessions: [], meals: [], weights: [] }, {});
  assert.equal(empty.headline.tone, 'empty'); assert.equal(empty.focus, null);
  assert.equal(plannedWeekdays(null), null);
  assert.deepEqual(plannedWeekdays(routine), [0, 1, 3, 4]);
});

test('Lectura: una semana sin logros claros rescata lo registrado', () => {
  const g = glance('2026-01-12', '2026-01-20', { sessions: [...previous.sessions, session('2026-01-12', 70)], meals: [meal('2026-01-12', 3200, 90), meal('2026-01-13', 3300, 90)], weights: [] });
  assert.equal(g.wins.length, 1); assert.match(g.wins[0].text, /^Completaste 1 entrenamiento y registraste comidas 2 días\.$/);
});
