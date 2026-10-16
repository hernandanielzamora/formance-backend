import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrainingCatalog } from '../scripts/lib/training-catalog.js';
import { buildStudyTraining, buildStudyData, studyNote } from '../scripts/lib/study-data.js';
import { buildWeeklyReport, weeklyRange } from '../src/services/reports.js';

const catalog = planTrainingCatalog({ exercises: new Map(), workouts: new Map(), routines: new Map() }, 'admin');
const routine = catalog.creates.find(item => item.kind === 'routines' && item.id === 'full-body-3').value;
const options = { routine, from: '2026-09-16', to: '2026-10-15', zone: 'America/Argentina/Buenos_Aires', today: '2026-10-16', createdAt: '2026-10-16T12:00:00Z' };

test('Mes simulado respeta días de la rutina, snapshots y validaciones sin fechas futuras', () => {
  const result = buildStudyTraining(options);
  assert.equal(result.sessions.length, 13);
  assert.equal(new Set(result.sessions.map(item => item.id)).size, 13);
  assert.equal(result.sessions.filter(item => item.status === 'abandoned').length, 1);
  for (const session of result.sessions) {
    assert.ok(session.localDate >= options.from && session.localDate <= options.to);
    const index = (new Date(`${session.localDate}T12:00:00Z`).getUTCDay() + 6) % 7;
    assert.ok(routine.days[index].assignments.some(item => item.assignmentId === session.assignmentId));
    assert.equal(session.routineId, routine.id); assert.equal(session.routineVersion, routine.version);
    assert.ok(session.note.startsWith(studyNote)); assert.equal(session.demoData.simulated, true);
    assert.ok(session.startedAt < session.finishedAt);
  }
  assert.throws(() => buildStudyTraining({ ...options, to: options.today }), /pasados/);
  assert.throws(() => buildStudyTraining({ ...options, from: '2026-08-01' }), /31/);
});

test('Conserva registros previos y no duplica sesiones al repetir el generador', () => {
  const first = buildStudyTraining(options);
  assert.deepEqual(buildStudyTraining(options), first);
  const again = buildStudyTraining({ ...options, existing: first.sessions });
  assert.equal(again.sessions.length, 0); assert.equal(again.skipped.length, first.sessions.length);
  const real = { ...first.sessions[0], id: 'real-log', demoData: undefined };
  const result = buildStudyTraining({ ...options, existing: [real] });
  assert.equal(result.sessions.length, first.sessions.length - 1);
  assert.ok(!result.sessions.some(item => item.localDate === real.localDate && item.assignmentId === real.assignmentId));
});

test('Los reportes muestran series, carga cero, sesión interrumpida y comparación entre semanas', () => {
  const { sessions } = buildStudyTraining(options);
  const range = weeklyRange({ weekStart: '2026-10-05', timeZone: options.zone }, options.today);
  const report = buildWeeklyReport(range, sessions, []);
  assert.equal(report.current.training.sessions.completed, 3);
  assert.equal(report.previous.training.sessions.abandoned, 1);
  assert.ok(report.current.training.completedSets > 0);
  assert.ok(report.current.training.externalVolumeKg > 0);
  assert.ok(report.logs.every(item => item.note.includes('SIMULADA')));
  assert.ok(sessions.flatMap(item => item.performedEntries).flatMap(item => item.sets).some(item => item.externalLoadKg === 0 && item.completed));
});

test('Comidas y peso de muestra conservan los datos existentes y alimentan reportes sin proveedores', () => {
  const result = buildStudyData({ ...options, profile: { initialWeightKg: 80 } });
  assert.equal(result.meals.length, 120); assert.equal(result.weights.length, 16);
  assert.ok(result.meals.every(meal => meal.note.includes('SIMULADA') && meal.items.every(item => item.source === 'manual')));
  assert.ok(result.weights.every(item => item.demoData.simulated && item.weightKg >= 79.7 && item.weightKg <= 80.4));
  const again = buildStudyData({ ...options, profile: { initialWeightKg: 80 }, existing: { sessions: result.sessions, meals: result.meals, weights: result.weights } });
  assert.equal(again.sessions.length + again.meals.length + again.weights.length, 0);
  const range = weeklyRange({ weekStart: '2026-10-05', timeZone: options.zone }, options.today);
  const report = buildWeeklyReport(range, result.sessions, result.meals, result.weights);
  assert.equal(report.current.food.daysWithRecords, 7);
  assert.equal(report.current.food.meals, 28);
  assert.ok(report.current.weight.count >= 3);
  assert.ok(report.comparison.weightAverageDeltaKg !== null);
  assert.ok(report.logs.some(item => item.type === 'food') && report.logs.some(item => item.type === 'weight'));
});
