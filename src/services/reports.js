import { date, timeZone, localToday } from './training-sessions.js';
import { invalid } from './training.js';
import { weightMetrics, effectiveWeights } from './weight.js';
export const nutrientKeys = ['calories', 'protein', 'fat', 'carbohydrates'];
const rounded = value => Math.round((value + Number.EPSILON) * 100) / 100;
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function shiftDate(value, offset) {
  const result = new Date(`${value}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + offset); return result.toISOString().slice(0, 10);
}
export function weeklyRange(query, now) {
  const from = date(query.weekStart); const zone = timeZone(query.timeZone); const today = now || localToday(zone);
  if (new Date(`${from}T12:00:00Z`).getUTCDay() !== 1) invalid('La semana debe comenzar un lunes.');
  if (from > today) invalid('Elegí la semana actual o una anterior.');
  const to = shiftDate(from, 6); const through = to < today ? to : today;
  const elapsedDays = Math.round((new Date(through) - new Date(from)) / 86400000) + 1;
  return { from, to, through, today, timeZone: zone, elapsedDays, isPartial: through < to, previousFrom: shiftDate(from, -7), previousThrough: shiftDate(through, -7) };
}
export function trainingMetrics(sessions) {
  const statuses = { completed: 0, abandoned: 0, in_progress: 0 };
  const exercises = new Map(); let completedSets = 0; let reps = 0; let recordedLoadSets = 0; let volume = 0;
  for (const session of sessions) {
    if (Object.hasOwn(statuses, session.status)) statuses[session.status]++;
    const planned = session.workoutSnapshot?.entries || [];
    for (const entry of session.performedEntries || []) {
      const snapshot = planned.find(item => item.entryId === entry.entryId);
      const exerciseId = snapshot?.exerciseId || entry.exerciseId;
      const tracking = snapshot?.tracking || 'unknown'; const version = snapshot?.exerciseVersion ?? null;
      const key = JSON.stringify([exerciseId, version, tracking]);
      for (const set of entry.sets || []) {
        if (set.completed !== true) continue;
        completedSets++;
        const rep = Number.isInteger(set.reps) && set.reps > 0 ? set.reps : null;
        const load = numeric(set.externalLoadKg) ? set.externalLoadKg : null;
        const measured = rep !== null && load !== null && tracking === 'reps_weight';
        reps += rep || 0; if (measured) { recordedLoadSets++; volume += rep * load; }
        if (!exercises.has(key)) exercises.set(key, { key, exerciseId, exerciseVersion: version, tracking, name: snapshot?.exerciseName || 'Ejercicio sin referencia', completedSets: 0, reps: 0, recordedLoadSets: 0, externalVolumeKg: null, maxLoadKg: null, sessions: new Set() });
        const exercise = exercises.get(key); exercise.completedSets++; exercise.reps += rep || 0; exercise.sessions.add(session.id);
        if (measured) { exercise.recordedLoadSets++; exercise.externalVolumeKg = (exercise.externalVolumeKg || 0) + rep * load; exercise.maxLoadKg = Math.max(exercise.maxLoadKg ?? 0, load); }
      }
    }
  }
  return { sessions: statuses, totalSessions: sessions.length, completedSets, reps, recordedLoadSets, setsWithoutRecordedLoad: completedSets - recordedLoadSets,
    externalVolumeKg: recordedLoadSets ? rounded(volume) : null,
    exercises: [...exercises.values()].map(item => ({ ...item, sessions: item.sessions.size, externalVolumeKg: item.externalVolumeKg === null ? null : rounded(item.externalVolumeKg) })).sort((a, b) => b.completedSets - a.completedSets || a.name.localeCompare(b.name)) };
}
function foodDay(meals) {
  const items = meals.flatMap(meal => meal.items || []);
  const nutrients = Object.fromEntries(nutrientKeys.map(key => {
    const known = items.filter(item => numeric(item.totals?.[key]));
    return [key, { value: known.length ? rounded(known.reduce((sum, item) => sum + item.totals[key], 0)) : null, knownItems: known.length, missingItems: items.length - known.length, complete: items.length > 0 && known.length === items.length }];
  }));
  const estimatedItems = items.filter(item => item.estimated === true || item.source === 'gemini').length;
  return { meals: meals.length, items: items.length, estimatedItems, nutrients };
}
function period(from, through, sessions, meals, weights) {
  const days = [];
  for (let value = from; value <= through; value = shiftDate(value, 1)) {
    const training = sessions.filter(item => item.localDate === value); const food = meals.filter(item => item.localDate === value);
    days.push({ date: value, training: trainingMetrics(training), food: foodDay(food), weight: weights.find(item => item.localDate === value) || null });
  }
  const activeMeals = meals.filter(item => item.localDate >= from && item.localDate <= through);
  const food = foodDay(activeMeals);
  return { from, through, days, weight: weightMetrics(weights.filter(item => item.localDate >= from && item.localDate <= through)), training: trainingMetrics(sessions.filter(item => item.localDate >= from && item.localDate <= through)),
    food: { ...food, daysWithRecords: days.filter(day => day.food.meals > 0).length,
      nutrients: Object.fromEntries(nutrientKeys.map(key => {
        const withData = days.filter(day => day.food.nutrients[key].value !== null);
        const completeDays = days.filter(day => day.food.nutrients[key].complete).length;
        return [key, { ...food.nutrients[key], daysWithData: withData.length, completeDays, average: withData.length ? rounded(withData.reduce((sum, day) => sum + day.food.nutrients[key].value, 0) / withData.length) : null }];
      })) } };
}
export function buildWeeklyReport(range, allSessions, allMeals, allWeights = []) {
  const sessions = allSessions.filter(item => item.localDate >= range.previousFrom && item.localDate <= range.through);
  const meals = allMeals.filter(item => !item.archived && item.localDate >= range.previousFrom && item.localDate <= range.through);
  const weights = effectiveWeights(allWeights, range.previousFrom, range.through);
  const current = period(range.from, range.through, sessions, meals, weights);
  const previous = period(range.previousFrom, range.previousThrough, sessions, meals, weights);
  const logs = [
    ...weights.filter(item => item.localDate >= range.from).map(item => ({ type: 'weight', id: item.id, localDate: item.localDate, timeZone: item.timeZone, name: 'Peso corporal', weightKg: item.weightKg, source: item.source, dateInferred: item.dateInferred === true, note: item.note || '' })),
    ...sessions.filter(item => item.localDate >= range.from).map(session => ({ type: 'training', id: session.id, localDate: session.localDate, timeZone: session.timeZone, name: session.workoutSnapshot?.name || 'Entrenamiento', status: session.status, note: session.note || '',
      routineName: session.routineName || null, metrics: trainingMetrics([session]),
      entries: (session.workoutSnapshot?.entries || []).map(entry => ({ name: entry.exerciseName, planned: entry.planned, sets: session.performedEntries?.find(item => item.entryId === entry.entryId)?.sets || [] })) })),
    ...meals.filter(item => item.localDate >= range.from).map(meal => ({ type: 'food', id: meal.id, localDate: meal.localDate, timeZone: meal.timeZone, name: meal.mealType, note: meal.note || '', items: meal.items, metrics: foodDay([meal]) })),
  ].sort((a, b) => b.localDate.localeCompare(a.localDate) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  const volumeComparable = current.training.completedSets > 0 && previous.training.completedSets > 0 && current.training.setsWithoutRecordedLoad === 0 && previous.training.setsWithoutRecordedLoad === 0;
  return { schemaVersion: 1, period: range, current, previous, logs,
    comparison: { completedSessionsDelta: current.training.sessions.completed - previous.training.sessions.completed, completedSetsDelta: current.training.completedSets - previous.training.completedSets,
      recordedDaysDelta: current.food.daysWithRecords - previous.food.daysWithRecords,
      weightAverageDeltaKg: current.weight.averageKg !== null && previous.weight.averageKg !== null ? rounded(current.weight.averageKg - previous.weight.averageKg) : null,
      externalVolumeDelta: volumeComparable ? rounded(current.training.externalVolumeKg - previous.training.externalVolumeKg) : null,
      exercises: current.training.exercises.map(item => {
        const before = previous.training.exercises.find(candidate => candidate.key === item.key);
        return { key: item.key, previous: before || null, maxLoadDelta: item.maxLoadKg !== null && before?.maxLoadKg != null && item.recordedLoadSets === item.completedSets && before.recordedLoadSets === before.completedSets && item.exerciseVersion !== null ? rounded(item.maxLoadKg - before.maxLoadKg) : null };
      }) },
    limitations: { historicalPlanAvailable: false, historicalTargetsAvailable: false, hasEstimatedFood: current.food.estimatedItems > 0 } };
}
