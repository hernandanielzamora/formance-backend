import test from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, buildMonthlyReport } from '../src/services/monthly-report.js';
import { shiftDate } from '../src/services/reports.js';

const session = (date, load, status = 'completed') => ({ id: `s-${date}`, localDate: date, status, workoutSnapshot: { name: 'W', entries: [{ entryId: 'e', exerciseId: 'squat', exerciseVersion: 1, exerciseName: 'Sentadilla con barra', tracking: 'reps_weight', planned: { sets: 1, repsMin: 8, repsMax: 10 } }] },
  performedEntries: [{ entryId: 'e', exerciseId: 'squat', sets: [{ setId: `x${date}`, reps: 8, externalLoadKg: load, completed: true }] }] });
const meal = (date, kcal, protein) => ({ id: `m-${date}`, localDate: date, mealType: 'lunch', archived: false, items: [{ itemId: 'i', totals: { calories: kcal, protein, fat: 50, carbohydrates: 200 } }] });
const routine = { createdAt: '2026-01-01', days: Array.from({ length: 7 }, (_, i) => ({ assignments: [0, 3].includes(i) ? [{}] : [] })) };
const context = { goal: 'recomposition', targets: { calories: 2500, protein: 150 }, routine };

test('Mes: valida el parámetro y no admite meses futuros; semana parcial hasta hoy', () => {
  assert.throws(() => monthRange({ month: '2026-13', timeZone: 'UTC' }, '2026-02-10'));
  assert.throws(() => monthRange({ month: '2026-03', timeZone: 'UTC' }, '2026-02-10'));
  const range = monthRange({ month: '2026-02', timeZone: 'UTC' }, '2026-02-10');
  assert.deepEqual([range.from, range.to, range.through, range.isPartial, range.firstMonday, range.readFrom], ['2026-02-01', '2026-02-28', '2026-02-10', true, '2026-01-26', '2026-01-19']);
  assert.equal(range.label, 'febrero 2026');
});

test('Mes: rutina, cargas, objetivo, fines de semana, peso y semanas que tocan el mes', () => {
  const range = monthRange({ month: '2026-02', timeZone: 'UTC' }, '2026-03-05');
  const mondays = ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'];
  const sessions = mondays.flatMap((monday, i) => [session(monday, 80 + i * 2.5), ...(i === 2 ? [] : [session(shiftDate(monday, 3), 80 + i * 2.5)])]);
  const meals = Array.from({ length: 28 }, (_, i) => shiftDate('2026-02-01', i)).map(day => meal(day, [5, 6].includes((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) ? 3200 : 2500, 160));
  const weights = [{ id: 'a', localDate: '2026-02-02', weightKg: 80, timeZone: 'UTC' }, { id: 'b', localDate: '2026-02-26', weightKg: 79.2, timeZone: 'UTC' }];
  const report = buildMonthlyReport({ range, sessions, meals, weights, context });
  assert.equal(report.training.planned, 8); assert.equal(report.training.completedPlanned, 7);
  assert.deepEqual(report.training.progress.map(item => [item.name, item.firstKg, item.lastKg]), [['Sentadilla con barra', 80, 87.5]]);
  assert.equal(report.nutrition.daysLogged, 28); assert.equal(report.nutrition.onTargetDays, 20); assert.equal(report.nutrition.proteinDays, 28);
  assert.ok(report.nutrition.weekendDelta > .2);
  assert.equal(report.weight.changeKg, -0.8);
  assert.deepEqual(report.weeks.map(week => week.weekStart), ['2026-01-26', ...mondays]);
  assert.equal(report.weeks[3].tone !== 'empty', true);
  assert.match(report.summary, /^7 de 8 entrenamientos planificados, carga en subida, calorías en objetivo 20 de 28 días, −0,8 kg\.$/);
});

test('Mes sin registros', () => {
  const range = monthRange({ month: '2026-02', timeZone: 'UTC' }, '2026-03-05');
  const report = buildMonthlyReport({ range, sessions: [], meals: [], weights: [], context: {} });
  assert.equal(report.hasRecords, false); assert.equal(report.training.planned, null); assert.equal(report.weight.changeKg, null);
});
