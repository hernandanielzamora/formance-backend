// Resumen mensual calculado con los registros, sin IA: totales del mes frente al
// objetivo actual y la rutina activa, progreso de cargas, peso y semanas del mes.
import { invalid } from './training.js';
import { timeZone, localToday } from './training-sessions.js';
import { buildWeeklyReport, weeklyRange, shiftDate } from './reports.js';
import { weeklyGlance, plannedWeekdays } from './weekly-glance.js';
import { effectiveWeights } from './weight.js';

const round = (value, digits = 0) => { const f = 10 ** digits; return Math.round((value + Number.EPSILON) * f) / f; };
const weekday = date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const mainLift = /barra|sentadilla|press de banca|peso muerto|dominada/i;
const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmt = (value, digits = 0) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits }).format(value);

export function monthRange(query, now) {
  if (typeof query.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)) invalid('Mes inválido.');
  const zone = timeZone(query.timeZone); const today = now || localToday(zone);
  const from = `${query.month}-01`;
  if (from > today) invalid('Elegí el mes actual o uno anterior.');
  const [year, month] = query.month.split('-').map(Number);
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const through = to < today ? to : today;
  const firstMonday = shiftDate(from, -weekday(from));
  return { month: query.month, label: `${monthNames[month - 1]} ${year}`, from, to, through, today, timeZone: zone, isPartial: through < to,
    elapsedDays: Math.round((new Date(through) - new Date(from)) / 86400000) + 1, firstMonday, readFrom: shiftDate(firstMonday, -7) };
}

export function buildMonthlyReport({ range, sessions, meals, weights, context = {} }) {
  const { targets = null, routine = null } = context;
  const inMonth = item => item.localDate >= range.from && item.localDate <= range.through;
  const monthSessions = sessions.filter(inMonth); const monthMeals = meals.filter(item => !item.archived && inMonth(item));
  const planned = plannedWeekdays(routine); const since = typeof routine?.createdAt === 'string' ? routine.createdAt.slice(0, 10) : null;
  // Entrenamiento: días planificados del mes (sin contar hoy si todavía no entrenaste).
  const days = []; for (let day = range.from; day <= range.through; day = shiftDate(day, 1)) days.push(day);
  const doneDays = new Set(monthSessions.filter(item => item.status === 'completed').map(item => item.localDate));
  const plannedDays = planned ? days.filter(day => planned.includes(weekday(day)) && (!since || day >= since) && (day < range.today || doneDays.has(day))) : null;
  const completedSets = monthSessions.reduce((sum, item) => sum + (item.performedEntries || []).reduce((acc, entry) => acc + (entry.sets || []).filter(set => set.completed).length, 0), 0);
  const lifts = new Map();
  for (const session of [...monthSessions].sort((a, b) => a.localDate.localeCompare(b.localDate))) for (const entry of session.performedEntries || []) {
    const plan = session.workoutSnapshot?.entries?.find(item => item.entryId === entry.entryId);
    if (!plan || plan.tracking !== 'reps_weight') continue;
    const loads = (entry.sets || []).filter(set => set.completed && Number.isFinite(set.externalLoadKg) && set.externalLoadKg > 0).map(set => set.externalLoadKg);
    if (!loads.length) continue;
    const item = lifts.get(plan.exerciseId) || { name: plan.exerciseName, firstKg: Math.max(...loads), lastKg: null, bestKg: 0, sessions: 0 };
    item.lastKg = Math.max(...loads); item.bestKg = Math.max(item.bestKg, ...loads); item.sessions++; lifts.set(plan.exerciseId, item);
  }
  const progress = [...lifts.values()].filter(item => item.sessions >= 2).map(item => ({ ...item, deltaKg: round(item.lastKg - item.firstKg, 2) }))
    .sort((a, b) => Number(mainLift.test(b.name)) - Number(mainLift.test(a.name)) || b.deltaKg / b.firstKg - a.deltaKg / a.firstKg).slice(0, 5);
  // Alimentación: por día registrado.
  const foodDays = days.map(day => {
    const items = monthMeals.filter(meal => meal.localDate === day).flatMap(meal => meal.items || []);
    const sum = key => items.reduce((acc, item) => acc + (Number.isFinite(item.totals?.[key]) ? item.totals[key] : 0), 0);
    return items.length ? { day, kcal: sum('calories'), protein: sum('protein') } : null;
  }).filter(Boolean);
  const avgKcal = average(foodDays.map(item => item.kcal)); const avgProtein = average(foodDays.map(item => item.protein));
  const onTarget = targets?.calories ? foodDays.filter(item => Math.abs(item.kcal / targets.calories - 1) <= .1).length : null;
  const proteinDays = targets?.protein ? foodDays.filter(item => item.protein >= targets.protein * .9).length : null;
  const weekendAvg = average(foodDays.filter(item => weekday(item.day) >= 5).map(item => item.kcal)); const weekdayAvg = average(foodDays.filter(item => weekday(item.day) < 5).map(item => item.kcal));
  // Peso: primera y última medición del mes.
  const monthWeights = effectiveWeights(weights, range.from, range.through);
  const firstWeight = monthWeights[0] || null; const lastWeight = monthWeights.at(-1) || null;
  // Semanas que tocan el mes, con su lectura.
  const weeks = [];
  for (let monday = range.firstMonday; monday <= range.through; monday = shiftDate(monday, 7)) {
    const period = weeklyRange({ weekStart: monday, timeZone: range.timeZone }, range.today);
    const glance = weeklyGlance(buildWeeklyReport(period, sessions, meals, weights), context);
    weeks.push({ weekStart: monday, weekEnd: shiftDate(monday, 6), isPartial: period.isPartial, tone: glance.headline.tone, title: glance.headline.title,
      training: { completed: glance.training.completed, planned: glance.training.planned, completedPlanned: glance.training.completedPlanned },
      nutrition: { avgKcal: glance.nutrition.avgKcal, onTargetDays: glance.nutrition.onTargetDays, daysLogged: glance.nutrition.daysLogged }, weight: { avgKg: glance.weight.avgKg } });
  }
  const training = { completed: monthSessions.filter(item => item.status === 'completed').length, abandoned: monthSessions.filter(item => item.status === 'abandoned').length,
    planned: plannedDays ? plannedDays.length : null, completedPlanned: plannedDays ? plannedDays.filter(day => doneDays.has(day)).length : null, completedSets, progress };
  const nutrition = { daysLogged: foodDays.length, elapsed: range.elapsedDays, avgKcal: avgKcal === null ? null : round(avgKcal), kcalTarget: targets?.calories ?? null,
    kcalPct: avgKcal !== null && targets?.calories ? round(avgKcal / targets.calories - 1, 3) : null, onTargetDays: onTarget, avgProtein: avgProtein === null ? null : round(avgProtein),
    proteinTarget: targets?.protein ?? null, proteinDays, weekendDelta: weekendAvg !== null && weekdayAvg !== null ? round(weekendAvg / weekdayAvg - 1, 3) : null };
  const weight = { count: monthWeights.length, firstKg: firstWeight?.weightKg ?? null, firstDate: firstWeight?.localDate ?? null, lastKg: lastWeight?.weightKg ?? null, lastDate: lastWeight?.localDate ?? null,
    changeKg: monthWeights.length >= 2 ? round(lastWeight.weightKg - firstWeight.weightKg, 2) : null, points: monthWeights.map(item => ({ date: item.localDate, kg: item.weightKg })) };
  // Resumen en una línea.
  const parts = [];
  if (training.planned) parts.push(`${training.completedPlanned} de ${training.planned} entrenamientos planificados`); else if (training.completed) parts.push(`${training.completed} entrenamientos`);
  if (progress.some(item => item.deltaKg > 0)) parts.push(`${progress.filter(item => item.deltaKg > 0).length === 1 ? 'carga en subida' : 'cargas en subida'}`);
  if (onTarget !== null && foodDays.length) parts.push(`calorías en objetivo ${onTarget} de ${foodDays.length} días`);
  if (weight.changeKg !== null) parts.push(`${weight.changeKg > 0 ? '+' : weight.changeKg < 0 ? '−' : '±'}${fmt(Math.abs(weight.changeKg), 1)} kg`);
  const hasRecords = monthSessions.length || foodDays.length || monthWeights.length;
  return { month: range.month, label: range.label, period: { from: range.from, to: range.to, through: range.through, isPartial: range.isPartial, elapsedDays: range.elapsedDays, today: range.today },
    summary: hasRecords ? `${parts.join(', ').replace(/^./, c => c.toUpperCase())}.` : 'Todavía no hay registros en este mes.', hasRecords: Boolean(hasRecords),
    training, nutrition, weight, weeks };
}
