import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyRange, shiftDate } from '../src/services/reports.js';
import { weeklyTrend, exerciseProgress, userNotes, trendReadFrom } from '../src/services/weekly-trend.js';

const zone = 'UTC';
const session = (date, load, note = '') => ({ id: `s-${date}`, localDate: date, status: 'completed', note, workoutSnapshot: { name: 'Tren inferior A', entries: [
  { entryId: 'e', exerciseId: 'squat', exerciseVersion: 1, exerciseName: 'Sentadilla con barra', tracking: 'reps_weight', planned: { sets: 1, repsMin: 8, repsMax: 10 } },
  { entryId: 'b', exerciseId: 'dead-bug', exerciseVersion: 1, exerciseName: 'Dead bug', tracking: 'reps_weight', planned: { sets: 1, repsMin: 8, repsMax: 10 } }] },
  performedEntries: [{ entryId: 'e', exerciseId: 'squat', sets: [{ setId: `x${date}`, reps: 8, externalLoadKg: load, completed: true }] }, { entryId: 'b', exerciseId: 'dead-bug', sets: [{ setId: `y${date}`, reps: 10, externalLoadKg: 0, completed: true }] }] });
const meal = (date, kcal, note = '', mealType = 'lunch') => ({ id: `m-${date}-${mealType}`, localDate: date, mealType, note, archived: false, items: [{ itemId: 'i', totals: { calories: kcal, protein: 150, fat: 50, carbohydrates: 200 } }] });
const range = weeklyRange({ weekStart: '2026-02-02', timeZone: zone }, '2026-02-09');
const mondays = [-21, -14, -7, 0].map(offset => shiftDate('2026-02-02', offset));

test('Tendencia: cuatro semanas en orden, con constancia, fines de semana y cambio de peso', () => {
  const sessions = mondays.flatMap((monday, i) => [session(monday, 80 + i * 2.5)]);
  const meals = mondays.flatMap(monday => Array.from({ length: 7 }, (_, d) => meal(shiftDate(monday, d), d >= 5 ? 3200 : 2500)));
  const weights = mondays.flatMap((monday, i) => [0, 2].map(d => ({ id: shiftDate(monday, d), localDate: shiftDate(monday, d), weightKg: 80 - i * .3, timeZone: zone })));
  const routine = { createdAt: '2026-01-01', days: Array.from({ length: 7 }, (_, i) => ({ assignments: i === 0 ? [{}] : [] })) };
  const trend = weeklyTrend({ range, sessions, meals, weights, context: { goal: 'recomposition', targets: { calories: 2600, protein: 150 }, routine } });
  assert.deepEqual(trend.weeks.map(week => week.weekStart), mondays);
  assert.equal(trend.summary.weeksAllPlannedDone, 4);
  assert.equal(trend.summary.weeksWithHeavierWeekend, 4);
  assert.equal(trend.summary.weightChangeKg, -0.9);
  assert.equal(trend.weeks[3].training.loadIncreases, 1);
  assert.equal(trendReadFrom(range), '2026-01-05');
});

test('Progreso por ejercicio: carga máxima semanal de ejercicios con carga, principales primero', () => {
  const progress = exerciseProgress({ range, sessions: [session(mondays[0], 80), session(mondays[1], 82.5), session(shiftDate(mondays[1], 3), 85), session(mondays[3], 90)] });
  assert.equal(progress.length, 1);
  assert.equal(progress[0].name, 'Sentadilla con barra');
  assert.deepEqual(progress[0].weeks.map(week => [week.weekStart, week.maxLoadKg]), [[mondays[0], 80], [mondays[1], 85], [mondays[3], 90]]);
  assert.equal(progress[0].deltaKg, 10);
});

test('Notas: sesiones de 4 semanas y comidas de la semana, recortadas y sin identificadores', () => {
  const long = 'x'.repeat(400);
  const notes = userNotes({ range, sessions: [session(mondays[0], 80, 'Viaje: corté antes'), session(shiftDate(mondays[0], -7), 80, 'fuera de rango')],
    meals: [meal(mondays[3], 2500, 'Asado de cumpleaños', 'dinner'), meal(mondays[2], 2500, 'semana anterior'), meal(shiftDate(mondays[3], 1), 2500, long)] });
  assert.deepEqual(notes.map(note => [note.date, note.type, note.about]), [[mondays[0], 'training', 'Tren inferior A'], [mondays[3], 'food', 'cena'], [shiftDate(mondays[3], 1), 'food', 'almuerzo']]);
  assert.equal(notes[2].text.length, 240);
  assert.ok(notes.every(note => !('id' in note)));
});
