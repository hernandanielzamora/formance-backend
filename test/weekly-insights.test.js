import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyEvidence, weeklyComparison } from '../src/services/weekly-insights.js';
import { weeklyPayload, generateWeeklyAnalysis, weeklyAnalysisPrompt } from '../src/services/weekly-analysis.js';
import { buildWeeklyReport, weeklyRange } from '../src/services/reports.js';

const range = weeklyRange({ weekStart: '2026-01-05', timeZone: 'UTC' }, '2026-01-11');
const meal = (localDate, calories, protein = 10) => ({ localDate, archived: false, note: 'PRIVATE_NOTE', items: [{ name: 'PRIVATE_FOOD', totals: { calories, protein, fat: 2, carbohydrates: 15 } }] });
const session = (localDate, load, id = 'PRIVATE_ID', reps = 10) => ({ id: `${id}-${localDate}`, localDate, status: 'completed',
  workoutSnapshot: { entries: [{ entryId: 'entry', exerciseId: id, exerciseVersion: 1, exerciseName: 'PRIVATE_EXERCISE', tracking: 'reps_weight' }] },
  performedEntries: [{ entryId: 'entry', sets: [{ completed: true, reps, externalLoadKg: load }] }] });
const weight = (localDate, weightKg) => ({ id: localDate, localDate, weightKg });

test('Weekly evidence computes useful cross-week patterns, coverage, macros and weight without exposing identities', () => {
  const report = buildWeeklyReport(range,
    [session('2026-01-05', 20), session('2026-01-07', 22), session('2025-12-29', 18)],
    [meal('2026-01-05', 200, 20), meal('2026-01-06', 400, null), meal('2025-12-29', 100, 10)],
    [weight('2026-01-05', 80), weight('2026-01-07', 79.8), weight('2025-12-29', 80.1), weight('2025-12-31', 80.3)]);
  const value = weeklyEvidence(report);
  assert.equal(value.coverage.current.daysWithAnyRecords, 3);
  assert.equal(value.coverage.current.daysWithCompletedSessions, 2);
  assert.equal(value.coverage.previousHasRecords, true);
  assert.equal(value.training.completedDaysDelta, 1);
  assert.equal(value.training.sharedExerciseVariants, 1); assert.equal(value.training.variantsWithHigherRecordedMaxLoad, 1);
  assert.equal(value.training.externalVolumeDelta, 240); assert.equal(value.training.canCompareVolume, true);
  assert.equal(value.nutrition.calories.averageDelta, 200); assert.equal(value.nutrition.calories.equalCoverage, false);
  assert.equal(value.nutrition.calories.currentMinRecordedDay, 200); assert.equal(value.nutrition.calories.currentMaxRecordedDay, 400);
  assert.equal(value.nutrition.protein.averageDelta, 10);
  assert.equal(value.weight.canCompareAverages, true); assert.equal(value.weight.averageDeltaKg, -0.3);
  for (const secret of ['PRIVATE_NOTE', 'PRIVATE_FOOD', 'PRIVATE_ID', 'PRIVATE_EXERCISE']) assert.ok(!JSON.stringify(weeklyPayload(report)).includes(secret));
});
test('Missing previous week, unknown loads, zero loads, changed variants and sparse weights stay explicit', () => {
  const empty = weeklyEvidence(buildWeeklyReport(range, [], [meal('2026-01-05', 0)], []));
  assert.equal(empty.coverage.previousHasRecords, false);
  assert.equal(empty.nutrition.calories.canCompareRecordedAverages, false);
  assert.equal(empty.nutrition.calories.averageDelta, null);
  assert.equal(empty.nutrition.calories.currentMinRecordedDay, 0);
  assert.equal(empty.weight.canCompareAverages, false); assert.equal(empty.weight.averageDeltaKg, null);
  for (const sessions of [[session('2026-01-05', null), session('2025-12-29', 0)], [session('2026-01-05', 20, 'A'), session('2025-12-29', 18, 'B')]]) {
    const evidence = weeklyEvidence(buildWeeklyReport(range, sessions, [], [weight('2026-01-05', 80), weight('2025-12-29', 81)]));
    assert.equal(evidence.training.canCompareVolume, false); assert.equal(evidence.training.externalVolumeDelta, null);
    assert.equal(evidence.training.variantsWithComparableMaxLoad, 0); assert.equal(evidence.weight.canCompareAverages, false);
  }
  const zero = weeklyEvidence(buildWeeklyReport(range, [session('2026-01-05', 0), session('2025-12-29', 0)], []));
  assert.equal(zero.training.canCompareVolume, true); assert.equal(zero.training.externalVolumeDelta, 0);
  assert.equal(zero.training.variantsWithUnchangedRecordedMaxLoad, 1);
});
test('Partial weeks compare equal elapsed days; data outside comparable previous days is excluded', () => {
  const partial = weeklyRange({ weekStart: '2026-01-05', timeZone: 'UTC' }, '2026-01-06');
  const payload = weeklyPayload(buildWeeklyReport(partial, [], [meal('2026-01-05', 200), meal('2025-12-29', 100), meal('2026-01-01', 999)], []));
  assert.equal(payload.period.isPartial, true); assert.equal(payload.period.previousThrough, '2025-12-30');
  assert.equal(payload.evidence.coverage.equalElapsedDays, true);
  assert.equal(payload.evidence.coverage.previous.daysInPeriod, 2);
  assert.equal(payload.evidence.nutrition.calories.averageDelta, 100);
});
test('Displayed comparison uses deterministic session deltas and never trusts model arithmetic', () => {
  const report = buildWeeklyReport(range, [session('2026-01-05', 10), session('2025-12-29', 10)], [meal('2026-01-05', 200), meal('2025-12-29', 100)], []);
  const text = weeklyComparison(weeklyPayload(report));
  assert.match(text, /Sesiones completadas: 1 frente a 1 \(diferencia: 0\)/);
  assert.match(text, /Calorías registradas: promedio de 200 frente a 100 kcal \(diferencia: \+100\)/);
  assert.match(text, /al menos dos mediciones/);
  assert.doesNotMatch(text, /sesión menos/);
});
test('One provider request asks for full interpretation and practical tracking focus with strict v2 schema', async () => {
  const valid = { summary: 'Balance.', comparison: 'Comparación limitada.', insights: { training: 'Distribución.', nutrition: 'Cobertura.', weight: 'Mediciones.' },
    trends: ['Observación.'], reviewPoints: ['Faltan registros.'], nextWeekFocus: ['Registrar la carga externa para comparar variantes.'] };
  let calls = 0;
  const result = await generateWeeklyAnalysis({ geminiModel: 'test', geminiApiKey: 'private' }, { evidence: {} }, async (_url, options) => {
    calls++; const request = JSON.parse(options.body);
    assert.equal(request.generationConfig.maxOutputTokens, 3500);
    assert.deepEqual(request.generationConfig.responseSchema.required, ['summary', 'comparison', 'insights', 'trends', 'reviewPoints', 'nextWeekFocus']);
    assert.equal(request.contents[0].parts[0].text, weeklyAnalysisPrompt);
    for (const requirement of ['no hagas cuentas', 'previousHasRecords=false', 'canCompareVolume=false', 'No diagnosticar', 'nextWeekFocus']) assert.ok(weeklyAnalysisPrompt.includes(requirement), requirement);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(valid) }] } }] }));
  });
  assert.equal(calls, 1); assert.deepEqual(result, valid);
});
