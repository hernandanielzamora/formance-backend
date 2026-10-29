// Evidence derived exclusively from the deterministic report. No model calculations.
const nutrients = ['calories', 'protein', 'fat', 'carbohydrates'];
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const difference = (current, previous) => current == null || previous == null ? null : round(current - previous);

export function weeklyEvidence(report) {
  function coverage(period) {
    return {
      daysInPeriod: period.days.length,
      daysWithAnyRecords: period.days.filter(day => day.training.totalSessions || day.food.meals || day.weight).length,
      daysWithTrainingRecords: period.days.filter(day => day.training.totalSessions).length,
      daysWithCompletedSessions: period.days.filter(day => day.training.sessions.completed).length,
      daysWithFoodRecords: period.food.daysWithRecords,
      daysWithWeight: period.weight.count,
      inferredWeightDates: period.weight.measurements.filter(item => item.dateInferred).length,
    };
  }
  const current = coverage(report.current); const previous = coverage(report.previous);
  const previousKeys = new Set(report.previous.training.exercises.map(item => item.key));
  const currentKeys = new Set(report.current.training.exercises.map(item => item.key));
  const matched = report.comparison.exercises.filter(item => item.previous);
  const loads = matched.filter(item => item.maxLoadDelta !== null);
  const sameExerciseSelection = currentKeys.size > 0 && currentKeys.size === previousKeys.size && [...currentKeys].every(key => previousKeys.has(key));
  const canCompareVolume = sameExerciseSelection && report.comparison.externalVolumeDelta !== null;
  return {
    coverage: { current, previous, previousHasRecords: previous.daysWithAnyRecords > 0,
      equalElapsedDays: current.daysInPeriod === previous.daysInPeriod },
    training: { completedDaysDelta: current.daysWithCompletedSessions - previous.daysWithCompletedSessions,
      sharedExerciseVariants: matched.length, variantsWithComparableMaxLoad: loads.length,
      variantsWithHigherRecordedMaxLoad: loads.filter(item => item.maxLoadDelta > 0).length,
      variantsWithLowerRecordedMaxLoad: loads.filter(item => item.maxLoadDelta < 0).length,
      variantsWithUnchangedRecordedMaxLoad: loads.filter(item => item.maxLoadDelta === 0).length,
      currentOnlyVariants: [...currentKeys].filter(key => !previousKeys.has(key)).length,
      previousOnlyVariants: [...previousKeys].filter(key => !currentKeys.has(key)).length,
      sameExerciseSelection, canCompareVolume, externalVolumeDelta: canCompareVolume ? report.comparison.externalVolumeDelta : null },
    nutrition: Object.fromEntries(nutrients.map(key => {
      const now = report.current.food.nutrients[key]; const before = report.previous.food.nutrients[key];
      const known = report.current.days.map(day => day.food.nutrients[key].value).filter(value => value !== null);
      return [key, { averageDelta: difference(now.average, before.average),
        currentDaysWithData: now.daysWithData, previousDaysWithData: before.daysWithData,
        equalCoverage: now.daysWithData === before.daysWithData,
        canCompareRecordedAverages: now.daysWithData > 0 && before.daysWithData > 0,
        currentMinRecordedDay: known.length ? Math.min(...known) : null,
        currentMaxRecordedDay: known.length ? Math.max(...known) : null }];
    })),
    weight: { canCompareAverages: report.current.weight.count >= 2 && report.previous.weight.count >= 2,
      averageDeltaKg: report.current.weight.count >= 2 && report.previous.weight.count >= 2 ? report.comparison.weightAverageDeltaKg : null,
      currentFirstKg: report.current.weight.first?.weightKg ?? null, currentLastKg: report.current.weight.last?.weightKg ?? null,
      currentFirstDate: report.current.weight.first?.localDate ?? null, currentLastDate: report.current.weight.last?.localDate ?? null },
  };
}

// Model prose is not a source of numeric truth. Always format the comparison
// shown in the UI from server evidence, including when reading an existing cache.
export function weeklyComparison(payload) {
  const number = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value);
  const delta = value => `${value > 0 ? '+' : ''}${number(value)}`;
  const { current, previous, evidence, comparison, period } = payload;
  const parts = [`Se comparan ${period.elapsedDays} días equivalentes${period.isPartial ? ' de una semana en curso' : ' de dos semanas cerradas'}.`];
  if (!evidence.coverage.previousHasRecords) return `${parts[0]} El período anterior no tiene registros disponibles para comparar; esto no significa que no haya habido actividad o consumo.`;
  if (evidence.coverage.current.daysWithTrainingRecords && evidence.coverage.previous.daysWithTrainingRecords) {
    parts.push(`Sesiones completadas: ${number(current.training.sessions.completed)} frente a ${number(previous.training.sessions.completed)} (diferencia: ${delta(comparison.completedSessionsDelta)}). Series realizadas: ${number(current.training.completedSets)} frente a ${number(previous.training.completedSets)} (diferencia: ${delta(comparison.completedSetsDelta)}).`);
  } else parts.push('No hay registros de entrenamiento en ambos períodos para comparar la actividad registrada.');
  for (const [key, label, unit] of [['calories', 'Calorías registradas', 'kcal'], ['protein', 'Proteínas registradas', 'g']]) {
    const metric = evidence.nutrition[key];
    if (metric.canCompareRecordedAverages) parts.push(`${label}: promedio de ${number(current.food.nutrients[key].average)} frente a ${number(previous.food.nutrients[key].average)} ${unit} (diferencia: ${delta(metric.averageDelta)}), en ${metric.currentDaysWithData} y ${metric.previousDaysWithData} días con datos.`);
    else parts.push(`${label}: sin promedios disponibles en ambos períodos.`);
  }
  if (evidence.weight.canCompareAverages) parts.push(`Peso promedio: ${number(current.weight.averageKg)} frente a ${number(previous.weight.averageKg)} kg (diferencia: ${delta(evidence.weight.averageDeltaKg)}), con ${current.weight.count} y ${previous.weight.count} mediciones. No determina cambios de grasa o músculo.`);
  else parts.push('Peso: se necesitan al menos dos mediciones en cada período para comparar promedios.');
  return parts.join(' ');
}
