// Contexto de 4 semanas para el análisis escrito: tendencia semanal, progreso por
// ejercicio y notas del usuario. Todo se deriva de los registros, sin IA.
import { buildWeeklyReport, weeklyRange, shiftDate } from './reports.js';
import { weeklyGlance } from './weekly-glance.js';

const round = (value, digits = 1) => { const f = 10 ** digits; return Math.round((value + Number.EPSILON) * f) / f; };
const mainLift = /barra|sentadilla|press de banca|peso muerto|dominada/i;
export const trendWeeksBack = 3;
// Primer día a leer: la semana más antigua de la tendencia también necesita su semana anterior.
export const trendReadFrom = range => shiftDate(range.from, -7 * (trendWeeksBack + 1));

export function weeklyTrend({ range, sessions, meals, weights, context }) {
  const weeks = Array.from({ length: trendWeeksBack + 1 }, (_, index) => {
    const weekStart = shiftDate(range.from, -7 * (trendWeeksBack - index));
    const period = index === trendWeeksBack ? range : weeklyRange({ weekStart, timeZone: range.timeZone }, range.today);
    const glance = weeklyGlance(buildWeeklyReport(period, sessions, meals, weights), context);
    const { training: t, nutrition: n, weight: w } = glance;
    return { weekStart, isPartial: period.isPartial, hasRecords: glance.headline.tone !== 'empty', tone: glance.headline.tone,
      training: { completed: t.completed, planned: t.planned, completedPlanned: t.completedPlanned, abandoned: t.abandoned, completedSets: t.completedSets, loadIncreases: t.records.length },
      nutrition: { daysLogged: n.daysLogged, avgKcal: n.avgKcal, kcalPctVsTarget: n.kcalPct, onTargetDays: n.onTargetDays, avgProtein: n.avgProtein, proteinDays: n.proteinDays, weekendDelta: n.weekendDelta },
      weight: { avgKg: w.avgKg, count: w.count } };
  });
  const withWeight = weeks.filter(week => week.weight.avgKg !== null && week.weight.count >= 2);
  const closed = weeks.filter(week => !week.isPartial && week.hasRecords);
  return { weeks,
    summary: {
      weeksWithRecords: weeks.filter(week => week.hasRecords).length,
      weeksAllPlannedDone: closed.filter(week => week.training.planned && week.training.completedPlanned === week.training.planned).length,
      closedWeeks: closed.length,
      weeksWithHeavierWeekend: weeks.filter(week => week.nutrition.weekendDelta !== null && week.nutrition.weekendDelta >= .15).length,
      weightChangeKg: withWeight.length >= 2 ? round(withWeight.at(-1).weight.avgKg - withWeight[0].weight.avgKg) : null,
      weightFromWeek: withWeight.length >= 2 ? withWeight[0].weekStart : null,
    } };
}

// Evolución semanal de la carga máxima de los ejercicios principales.
export function exerciseProgress({ range, sessions, max = 5 }) {
  const first = shiftDate(range.from, -7 * trendWeeksBack);
  const weekOf = date => shiftDate(first, Math.floor((new Date(`${date}T12:00:00Z`) - new Date(`${first}T12:00:00Z`)) / 604800000) * 7);
  const byExercise = new Map();
  for (const session of sessions.filter(item => item.localDate >= first && item.localDate <= range.through)) {
    for (const entry of session.performedEntries || []) {
      const plan = session.workoutSnapshot?.entries?.find(item => item.entryId === entry.entryId);
      if (!plan || plan.tracking !== 'reps_weight') continue;
      for (const set of entry.sets || []) {
        if (set.completed !== true || !Number.isFinite(set.externalLoadKg) || !(set.externalLoadKg > 0) || !Number.isInteger(set.reps)) continue;
        const item = byExercise.get(plan.exerciseId) || { name: plan.exerciseName, sets: 0, weeks: new Map() };
        item.sets++;
        const week = weekOf(session.localDate); const best = item.weeks.get(week);
        if (!best || set.externalLoadKg > best.maxLoadKg || (set.externalLoadKg === best.maxLoadKg && set.reps > best.reps)) item.weeks.set(week, { weekStart: week, maxLoadKg: set.externalLoadKg, reps: set.reps });
        byExercise.set(plan.exerciseId, item);
      }
    }
  }
  return [...byExercise.values()].filter(item => item.weeks.size >= 2)
    .sort((a, b) => Number(mainLift.test(b.name)) - Number(mainLift.test(a.name)) || b.weeks.size - a.weeks.size || b.sets - a.sets)
    .slice(0, max).map(item => {
      const weeks = [...item.weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      return { name: item.name, weeks, firstKg: weeks[0].maxLoadKg, lastKg: weeks.at(-1).maxLoadKg, deltaKg: round(weeks.at(-1).maxLoadKg - weeks[0].maxLoadKg, 2) };
    });
}

// Notas escritas por el usuario (autorizadas para el análisis): de sesiones en las 4 semanas
// y de comidas en la semana analizada. Se recortan y nunca incluyen identidad ni IDs.
const mealNames = { breakfast: 'desayuno', lunch: 'almuerzo', snack: 'merienda', dinner: 'cena', extra: 'extra' };
export function userNotes({ range, sessions, meals }) {
  const clean = text => typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  const first = shiftDate(range.from, -7 * trendWeeksBack);
  const training = sessions.filter(item => item.localDate >= first && item.localDate <= range.through && clean(item.note))
    .map(item => ({ date: item.localDate, type: 'training', about: item.workoutSnapshot?.name || 'entrenamiento', status: item.status, text: clean(item.note) }));
  const food = meals.filter(item => !item.archived && item.localDate >= range.from && item.localDate <= range.through && clean(item.note))
    .map(item => ({ date: item.localDate, type: 'food', about: mealNames[item.mealType] || 'comida', text: clean(item.note) }));
  return [...training.slice(-15), ...food.slice(0, 30)].sort((a, b) => a.date.localeCompare(b.date));
}
