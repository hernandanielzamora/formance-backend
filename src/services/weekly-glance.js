// Lectura de un vistazo: compara lo registrado con el objetivo actual, la rutina
// activa y la semana anterior. Determinista, sin IA; los textos son breves y directos.
const round = (value, digits = 0) => { const f = 10 ** digits; return Math.round((value + Number.EPSILON) * f) / f; };
const fmt = (value, digits = 0) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits }).format(value);
const signed = (value, digits = 1) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmt(Math.abs(value), digits)}`;
const weekday = date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const dayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const goals = ['maintain', 'muscle', 'recomposition', 'fat_loss'];
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function plannedWeekdays(routine) {
  if (!routine || routine.archived || !Array.isArray(routine.days)) return null;
  return routine.days.map((day, index) => (day?.assignments?.length ? index : null)).filter(index => index !== null);
}

const mainLift = /barra|sentadilla|press de banca|peso muerto|dominada/i;
function training(report, planned, since) {
  const { current, period, comparison } = report; const today = period.today;
  const days = Array.from({ length: 7 }, (_, index) => {
    const value = current.days[index]; const date = value?.date ?? null;
    const isPlanned = (planned?.includes(index) ?? false) && (!since || !date || date >= since);
    if (!value) return { date: null, state: isPlanned ? 'future' : 'rest', planned: isPlanned };
    const done = value.training.sessions.completed > 0; const partial = !done && value.training.totalSessions > 0;
    const pending = date === today && !done && !partial;
    const state = done ? (isPlanned || !planned ? 'done' : 'extra') : partial ? 'partial' : isPlanned ? (pending ? 'today' : 'missed') : 'rest';
    return { date, state, planned: isPlanned };
  });
  const plannedSoFar = planned ? days.filter(day => day.planned && day.state !== 'future' && day.state !== 'today').length : null;
  const completedPlanned = days.filter(day => day.planned && day.state === 'done').length;
  const completed = current.training.sessions.completed;
  const records = comparison.exercises.filter(item => item.maxLoadDelta > 0).map(item => {
    const exercise = current.training.exercises.find(candidate => candidate.key === item.key);
    return { name: exercise.name, maxLoadKg: exercise.maxLoadKg, deltaKg: item.maxLoadDelta };
  }).sort((a, b) => Number(mainLift.test(b.name)) - Number(mainLift.test(a.name)) || b.deltaKg / b.maxLoadKg - a.deltaKg / a.maxLoadKg);
  const ratio = plannedSoFar ? completedPlanned / plannedSoFar : null;
  const status = !current.training.totalSessions ? (plannedSoFar ? 'attention' : 'empty')
    : ratio === null ? 'ok' : ratio >= .99 ? 'good' : ratio < .6 ? 'attention' : 'ok';
  return { status, planned: plannedSoFar, plannedWeek: planned?.length ?? null, completed, completedPlanned, abandoned: current.training.sessions.abandoned,
    missed: days.filter(day => day.state === 'missed').map(day => day.date), completedSets: current.training.completedSets,
    setsDelta: comparison.completedSetsDelta, previousCompleted: report.previous.training.sessions.completed, records, days };
}

function nutrition(report, targets, goal) {
  const { current, previous, period } = report;
  const kcalTarget = targets?.calories ?? null; const proteinTarget = targets?.protein ?? null;
  const days = Array.from({ length: 7 }, (_, index) => {
    const value = current.days[index];
    if (!value) return { date: null, state: 'future', kcal: null, protein: null };
    const kcal = value.food.meals ? value.food.nutrients.calories.value : null; const protein = value.food.meals ? value.food.nutrients.protein.value : null;
    if (kcal === null) return { date: value.date, state: 'missing', kcal: null, protein: null };
    const ratio = kcalTarget ? kcal / kcalTarget : null;
    return { date: value.date, kcal: round(kcal), protein: protein === null ? null : round(protein), ratio: ratio === null ? null : round(ratio, 2),
      state: ratio === null ? 'logged' : ratio > 1.1 ? 'over' : ratio < .9 ? 'under' : 'on' };
  });
  const logged = days.filter(day => day.kcal !== null);
  const avgKcal = average(logged.map(day => day.kcal)); const avgProtein = average(logged.filter(day => day.protein !== null).map(day => day.protein));
  const onTarget = logged.filter(day => day.state === 'on').length;
  const proteinDays = proteinTarget ? logged.filter(day => day.protein !== null && day.protein >= proteinTarget * .9).length : null;
  const weekend = logged.filter(day => weekday(day.date) >= 5); const weekdays = logged.filter(day => weekday(day.date) < 5);
  const weekendDelta = weekend.length && weekdays.length >= 2 ? average(weekend.map(day => day.kcal)) / average(weekdays.map(day => day.kcal)) - 1 : null;
  const peak = logged.length ? logged.reduce((max, day) => (day.kcal > max.kcal ? day : max)) : null;
  const kcalPct = avgKcal !== null && kcalTarget ? avgKcal / kcalTarget - 1 : null;
  const elapsed = period.elapsedDays; const coverage = logged.length / elapsed;
  const wrongDirection = kcalPct === null ? false : goal === 'muscle' ? kcalPct < -.1 : goal === 'maintain' ? Math.abs(kcalPct) > .12 : kcalPct > .08;
  const status = !logged.length ? 'empty' : coverage < .5 || (kcalTarget && wrongDirection && kcalPct > .15) ? 'attention'
    : !kcalTarget ? 'ok' : onTarget / logged.length >= .7 && (proteinDays === null || proteinDays / logged.length >= .7) && !wrongDirection ? 'good' : wrongDirection || onTarget / logged.length < .5 ? 'attention' : 'ok';
  const previousAvg = previous.food.nutrients.calories.average;
  return { status, daysLogged: logged.length, elapsed, avgKcal: avgKcal === null ? null : round(avgKcal), kcalTarget, kcalPct: kcalPct === null ? null : round(kcalPct, 3),
    onTargetDays: onTarget, avgProtein: avgProtein === null ? null : round(avgProtein), proteinTarget, proteinDays,
    weekendDelta: weekendDelta === null ? null : round(weekendDelta, 3), peak: peak && kcalTarget && peak.ratio > 1.15 ? { date: peak.date, kcal: peak.kcal, ratio: peak.ratio } : null,
    previousAvgKcal: previousAvg === null ? null : round(previousAvg), days };
}

function weight(report, goal) {
  const { current, previous, comparison } = report;
  const canCompare = current.weight.count >= 2 && previous.weight.count >= 2;
  const delta = canCompare ? comparison.weightAverageDeltaKg : null;
  const aligned = delta === null || !goal ? null : goal === 'fat_loss' ? delta < 0 : goal === 'muscle' ? delta > 0 : goal === 'recomposition' ? delta <= .2 : Math.abs(delta) <= .5;
  const status = !current.weight.count ? 'empty' : current.weight.count < 2 || delta === null ? 'ok' : aligned ? 'good' : Math.abs(delta) >= .3 ? 'attention' : 'ok';
  return { status, count: current.weight.count, avgKg: current.weight.averageKg, previousAvgKg: canCompare ? previous.weight.averageKg : null, deltaKg: delta, aligned,
    points: current.weight.measurements.map(item => ({ date: item.localDate, kg: item.weightKg })) };
}

export function weeklyGlance(report, { goal: rawGoal = null, targets = null, routine = null } = {}) {
  const goal = goals.includes(rawGoal) ? rawGoal : null;
  const planned = plannedWeekdays(routine);
  const since = typeof routine?.createdAt === 'string' ? routine.createdAt.slice(0, 10) : null;
  const t = training(report, planned, since); const n = nutrition(report, targets, goal); const w = weight(report, goal);
  const partial = report.period.isPartial;
  const wins = []; const improvements = [];
  // Entrenamiento
  const consistent = t.planned ? t.completedPlanned === t.planned : t.completed >= 3;
  const consistency = t.planned ? `Entrenaste ${t.completedPlanned} de ${t.planned} días planificados${partial ? ' hasta hoy' : ''}` : `Completaste ${t.completed} entrenamientos`;
  const best = t.records[0];
  const progress = !best ? '' : t.records.length === 1 ? `subiste carga en ${best.name} (${fmt(best.maxLoadKg, 1)} kg, ${signed(best.deltaKg)} kg)` : `subiste carga en ${t.records.length} ejercicios, como ${best.name} (${fmt(best.maxLoadKg, 1)} kg, ${signed(best.deltaKg)} kg)`;
  if (consistent && best) wins.push({ area: 'training', text: `${consistency} y ${progress}.` });
  else if (consistent) wins.push({ area: 'training', text: `${consistency}.` });
  else if (best) wins.push({ area: 'training', text: `${progress.charAt(0).toUpperCase()}${progress.slice(1)}.` });
  if (t.missed.length) improvements.push({ area: 'training', text: `${t.missed.length === 1 ? 'Quedó' : 'Quedaron'} ${t.missed.length} ${t.missed.length === 1 ? 'entrenamiento' : 'entrenamientos'} sin hacer (${t.missed.map(date => dayNames[weekday(date)]).join(', ')}).`,
    action: 'Si esos días se te complican, mové los workouts a otro día de la semana.', href: '/app/entrenamiento/calendario', short: t.missed.length === 1 ? 'el entrenamiento que quedó sin hacer' : `los ${t.missed.length} entrenamientos que quedaron sin hacer` });
  if (t.abandoned) improvements.push({ area: 'training', text: `${t.abandoned} ${t.abandoned === 1 ? 'sesión quedó interrumpida' : 'sesiones quedaron interrumpidas'}.`, action: 'Revisá qué pasó y retomá con las mismas cargas.', href: '/app/entrenamiento/calendario', short: 'la sesión interrumpida' });
  // Alimentación
  if (n.daysLogged && n.daysLogged < n.elapsed - 1) improvements.push({ area: 'nutrition', text: `Registraste comidas ${n.daysLogged} de ${n.elapsed} días; así el promedio es menos confiable.`, action: 'Anotá aunque sea lo principal de cada día.', href: '/app/alimentacion', short: 'el registro de comidas' });
  if (n.kcalTarget && n.daysLogged >= 3 && n.onTargetDays / n.daysLogged >= .6) wins.push({ area: 'nutrition', text: `Calorías dentro de tu objetivo ${n.onTargetDays} de ${n.daysLogged} días.` });
  if (n.proteinTarget && n.daysLogged >= 3 && n.proteinDays / n.daysLogged >= .7) wins.push({ area: 'nutrition', text: `Llegaste a tu proteína ${n.proteinDays} de ${n.daysLogged} días (${fmt(n.avgProtein)} g en promedio).` });
  if (n.weekendDelta !== null && n.weekendDelta >= .15) improvements.push({ area: 'nutrition', text: `El fin de semana comiste ${fmt(n.weekendDelta * 100)} % más que entre semana${n.peak && weekday(n.peak.date) >= 5 ? ` (el ${dayNames[weekday(n.peak.date)]}: ${fmt(n.peak.kcal)} kcal)` : ''}.`,
    action: 'Planificá una comida del fin de semana con anticipación.', href: '/app/alimentacion', short: 'las calorías del fin de semana' });
  else if (n.peak) improvements.push({ area: 'nutrition', text: `El ${dayNames[weekday(n.peak.date)]} registraste ${fmt(n.peak.kcal)} kcal, ${fmt((n.peak.ratio - 1) * 100)} % sobre tu objetivo.`, action: 'Revisá qué comidas sumaron más ese día.', href: '/app/alimentacion', short: `las calorías del ${dayNames[weekday(n.peak.date)]}` });
  if (n.proteinTarget && n.daysLogged >= 3 && n.proteinDays / n.daysLogged < .5) improvements.push({ area: 'nutrition', text: `La proteína quedó corta: ${fmt(n.avgProtein)} g de ${fmt(n.proteinTarget)} g en promedio.`, action: 'Sumá una fuente de proteína en desayuno o merienda.', href: '/app/alimentacion', short: 'la proteína' });
  // Peso
  if (w.deltaKg !== null && w.aligned) wins.push({ area: 'weight', text: w.deltaKg === 0 ? 'Tu peso promedio se mantuvo estable.' : `Tu peso promedio ${w.deltaKg < 0 ? 'bajó' : 'subió'} ${fmt(Math.abs(w.deltaKg), 1)} kg, en línea con tu objetivo.` });
  if (w.deltaKg !== null && w.aligned === false && Math.abs(w.deltaKg) >= .3) improvements.push({ area: 'weight', text: `Tu peso promedio ${w.deltaKg < 0 ? 'bajó' : 'subió'} ${fmt(Math.abs(w.deltaKg), 1)} kg respecto de la semana anterior.`, action: 'Mirá si coincide con más calorías o con días sin registrar.', href: '/app/peso', short: w.deltaKg < 0 ? 'la baja de peso' : 'la subida de peso' });
  if (w.count < 2 && !partial) improvements.push({ area: 'weight', text: w.count ? 'Solo hay una medición de peso esta semana.' : 'No registraste tu peso esta semana.', action: 'Pesate 3 veces por semana, en ayunas, para ver la tendencia.', href: '/app/peso', short: 'las mediciones de peso' });
  // Calidad de datos, solo si no hay nada más importante para mejorar.
  if (!improvements.length && report.current.training.setsWithoutRecordedLoad) improvements.push({ area: 'training', text: `${report.current.training.setsWithoutRecordedLoad} series no tienen la carga anotada.`, action: 'Completalas para comparar tu progreso.', href: '/app/entrenamiento/calendario', short: 'las cargas sin anotar' });

  // Una entrada por área antes de repetir: la lectura cubre entrenamiento, comida y peso.
  const spread = list => { const order = []; const pending = [...list]; while (pending.length) for (const area of ['training', 'nutrition', 'weight']) { const index = pending.findIndex(item => item.area === area); if (index >= 0) order.push(...pending.splice(index, 1)); } return order; };
  const statuses = [t.status, n.status, w.status];
  const hasRecords = statuses.some(status => status !== 'empty');
  const good = statuses.filter(status => status === 'good').length; const attention = statuses.filter(status => status === 'attention').length;
  const tone = !hasRecords ? 'empty' : attention >= 2 ? 'attention' : good >= 2 && !attention ? 'good' : 'mixed';
  const title = !hasRecords ? 'Todavía no hay registros esta semana'
    : partial ? (tone === 'attention' ? 'Semana para retomar el ritmo' : tone === 'good' ? 'Vas muy bien esta semana' : 'Vas bien, con algo para ajustar')
    : tone === 'good' ? (improvements.length ? 'Muy buena semana' : 'Semana redonda') : tone === 'attention' ? 'Semana para retomar el ritmo' : 'Buena semana, con algo para ajustar';
  // Titular en una línea: lo positivo en pocas palabras y, si hay, qué ajustar.
  const positives = [];
  if (consistent) positives.push(t.planned ? 'cumpliste tu rutina' : `entrenaste ${t.completed} veces`);
  if (best) positives.push(t.records.length === 1 ? `subiste carga en ${best.name}` : 'subiste cargas');
  if (n.status === 'good') positives.push('comiste en objetivo la mayoría de los días');
  if (w.deltaKg && w.aligned) positives.push(`${w.deltaKg < 0 ? 'bajaste' : 'subiste'} ${fmt(Math.abs(w.deltaKg), 1)} kg`);
  const list = items => items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : items[0];
  const firstImprovement = spread(improvements)[0];
  const text = !hasRecords ? 'Registrá un entrenamiento, una comida o tu peso para ver tu lectura semanal.'
    : [positives.length ? `${list(positives.slice(0, 3)).replace(/^./, c => c.toUpperCase())}.` : null, firstImprovement ? (positives.length ? `Para ajustar: ${firstImprovement.short}.` : `Lo principal: ${list(spread(improvements).slice(0, 2).map(item => item.short))}.`) : null].filter(Boolean).join(' ');
  const focus = !hasRecords ? null : firstImprovement ? { area: firstImprovement.area, text: firstImprovement.action, href: firstImprovement.href }
    : hasRecords ? { area: 'training', text: 'Repetí esta semana: mismo plan y, si podés, un poco más de carga.', href: '/app/entrenamiento/calendario' } : null;
  const topWins = hasRecords ? spread(wins).slice(0, 3) : []; const topImprovements = hasRecords ? spread(improvements).slice(0, 3) : [];
  return { version: 1, goal, targets: targets ? { calories: targets.calories ?? null, protein: targets.protein ?? null } : null, routinePlanned: Boolean(planned),
    headline: { tone, title, text }, training: t, nutrition: n, weight: w, wins: topWins, improvements: topImprovements, focus };
}
