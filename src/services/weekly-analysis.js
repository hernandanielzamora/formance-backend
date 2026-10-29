import { createHash, randomUUID } from 'node:crypto';
import { providerError } from './food-providers.js';
import { geminiHttpFailure } from './gemini-errors.js';
import { weeklyEvidence, weeklyComparison } from './weekly-insights.js';

const schemaVersion = 2;
const keys = ['calories', 'protein', 'fat', 'carbohydrates'];
export function weeklyPayload(report, context = {}) {
  const evidence = weeklyEvidence(report);
  const goal = ['maintain', 'muscle', 'recomposition', 'fat_loss'].includes(context.goal) ? context.goal : null;
  function period(value) {
    return {
      training: { sessions: value.training.sessions, completedSets: value.training.completedSets,
        reps: value.training.reps, externalVolumeKg: value.training.externalVolumeKg,
        recordedLoadSets: value.training.recordedLoadSets, setsWithoutRecordedLoad: value.training.setsWithoutRecordedLoad },
      food: { meals: value.food.meals, daysWithRecords: value.food.daysWithRecords, estimatedItems: value.food.estimatedItems,
        nutrients: Object.fromEntries(keys.map(key => { const n = value.food.nutrients[key]; return [key,
          { total: n.value, average: n.average, daysWithData: n.daysWithData, completeDays: n.completeDays, missingItems: n.missingItems }]; })) },
      weight: { count: value.weight.count, averageKg: value.weight.averageKg, changeKg: value.weight.changeKg },
      days: value.days.map(day => ({ date: day.date,
        training: { sessions: day.training.sessions, completedSets: day.training.completedSets, reps: day.training.reps,
          externalVolumeKg: day.training.externalVolumeKg, setsWithoutRecordedLoad: day.training.setsWithoutRecordedLoad },
        food: { meals: day.food.meals, nutrients: day.food.nutrients },
        weightKg: day.weight?.weightKg ?? null })),
    };
  }
  return { schemaVersion, context: { currentGoal: goal, goalAppliesHistorically: false },
    period: { from: report.period.from, through: report.period.through,
    previousFrom: report.period.previousFrom, previousThrough: report.period.previousThrough,
    elapsedDays: report.period.elapsedDays, isPartial: report.period.isPartial },
    current: period(report.current), previous: period(report.previous),
    comparison: { completedSessionsDelta: report.comparison.completedSessionsDelta,
      completedSetsDelta: report.comparison.completedSetsDelta, recordedDaysDelta: report.comparison.recordedDaysDelta,
      weightAverageDeltaKg: evidence.weight.averageDeltaKg, externalVolumeDelta: evidence.training.externalVolumeDelta },
    evidence, limitations: report.limitations };
}
export function weeklyFingerprint(payload, model) {
  return createHash('sha256').update(JSON.stringify({ payload, model, schemaVersion })).digest('hex');
}
export function validateWeeklyAnalysis(value) {
  const object = value && typeof value === 'object' && !Array.isArray(value);
  const validText = text => typeof text === 'string' && text.trim().length > 0 && text.length <= 1200;
  const validList = (key, max) => Array.isArray(value[key]) && value[key].length >= 1 && value[key].length <= max && value[key].every(validText);
  if (!object || Object.keys(value).length !== 6 || !validText(value.summary) || !validText(value.comparison)
    || !['trends', 'reviewPoints'].every(key => validList(key, 4)) || !validList('nextWeekFocus', 3)
    || !value.insights || typeof value.insights !== 'object' || Array.isArray(value.insights)
    || Object.keys(value.insights).length !== 3 || !['training', 'nutrition', 'weight'].every(key => validText(value.insights[key]))) {
    throw providerError(502, 'INVALID_WEEKLY_ANALYSIS', 'La IA devolvió un análisis con formato inválido. Intentá más tarde.');
  }
  const spanish = text => text.trim().replace(/\bfat\b/gi, 'grasas').replace(/\bcarbohydrates\b/gi, 'carbohidratos').replace(/\bprotein\b/gi, 'proteínas');
  return { summary: spanish(value.summary), comparison: spanish(value.comparison),
    insights: Object.fromEntries(['training', 'nutrition', 'weight'].map(key => [key, spanish(value.insights[key])])),
    trends: value.trends.map(spanish), reviewPoints: value.reviewPoints.map(spanish), nextWeekFocus: value.nextWeekFocus.map(spanish) };
}
export const weeklyAnalysisPrompt = `Sos el asistente de lectura de registros de Formance. Escribí en español rioplatense claro, cercano y específico, sin alarmismo. Ayudá a entender la semana y qué revisar en el próximo registro; no te limites a repetir una lista de totales.
Las métricas, diferencias y cobertura ya están calculadas por el backend: no hagas cuentas, porcentajes, cálculos nuevos ni inventes datos. Usá exclusivamente valores presentes. Integra entrenamiento, alimentación y peso como observaciones simultáneas, nunca como relaciones causales. Usa context.currentGoal solo para dar foco a la lectura actual, sin asumir que era la meta en semanas anteriores; null significa que no se conoce el objetivo. Objetivos: maintain=mantenimiento de peso, muscle=ganar masa muscular, recomposition=mejorar composición corporal, fat_loss=reducir grasa corporal.
Contenido obligatorio:
- summary: balance de la semana en 2–3 frases, qué patrón merece atención y relación informativa con el objetivo actual si existe. No afirmar progreso físico demostrado por dos semanas de registros.
- comparison: 2–4 frases comparando el mismo tramo de la semana anterior, con diferencias provistas en sesiones/series, alimentación y peso cuando haya datos comparables. Explicá la cobertura y si la semana está en curso. Si coverage.previousHasRecords=false no inventes una comparación ni interpretes los ceros como inactividad. No garantices que la semana anterior siempre tenga registros.
- insights.training: 2–3 frases sobre distribución de días con sesiones, series realizadas y variantes compartidas con cargas máximas registradas comparables. No confundir una carga máxima registrada distinta con ganancia de fuerza ni comparar volumen si evidence.training.canCompareVolume=false o si cambiaron variantes. Contadores de series de sesiones abiertas/interrumpidas también incluyen trabajo registrado; no equivalen a sesiones completadas.
- insights.nutrition: 2–3 frases sobre promedio REGISTRADO de calorías y macros, cobertura y variación entre días registrados usando evidence.nutrition. Diferencias en días o datos incompletos pueden explicar diferencias de promedio. Valores mínimos/máximos son de lo registrado, no de todo lo consumido. completeDays significa que los alimentos registrados tienen ese nutriente, no que se haya anotado todo lo consumido en el día. No deducir déficit/superávit energético ni cumplimiento nutricional. Priorizar patrones útiles, no repetir cada nutriente.
- insights.weight: 2–3 frases sobre mediciones, promedio y variación registrados. Comparar promedios solo si evidence.weight.canCompareAverages=true. Si no, aclarar la insuficiencia. No convertir variación de peso en cambio de grasa/músculo, composición corporal o resultado clínico; dos semanas no prueban tendencia sostenida.
- trends: 1–4 observaciones breves y concretas que conecten hechos ya calculados. Evitá duplicar el resumen o las tres lecturas por área; no fuerces relaciones si faltan datos.
- reviewPoints: 1–4 limitaciones ESPECÍFICAS de esta semana y su comparación (cobertura, carga desconocida, fechas inferidas, estimaciones de foto, metas históricas ausentes). No llenar el resultado de avisos genéricos repetidos.
- nextWeekFocus: 1–3 sugerencias de seguimiento prácticas y priorizadas, cada una vinculada a una observación real. Solo acciones de registro/revisión: completar repeticiones y cargas para comparar variantes, revisar porciones estimadas, mantener condiciones de medición comparables o revisar la distribución semanal ya elegida. Explicar para qué sirve cada acción. Si los registros están completos, sugerir conservar el criterio de registro y revisar si el patrón se repite. No inventar carencias ni sugerir más entrenamiento/comida por un día vacío.
No diagnosticar, prescribir, generar tratamientos, dietas ni rutinas; no recomendar medicamentos/suplementos ni cambios numéricos en ingesta o cargas. No afirmar adherencia histórica, causalidad ni que un día sin registros significa que no se comió o entrenó. Distinguir null (desconocido) y 0. No hacer recomendaciones clínicas. Describir lo disponible sin juzgar al usuario. Cuando falten datos, decirlo en el área correspondiente y proponer cómo mejorar el registro.
Respondé SOLO JSON con exactamente seis propiedades: summary (string), comparison (string), insights (objeto con exactamente training, nutrition, weight como strings), trends (array de 1–4 strings), reviewPoints (array de 1–4 strings), nextWeekFocus (array de 1–3 strings). Cada texto máximo 1200 caracteres. Resultado total conciso, idealmente 400–650 palabras; no rellenar con números repetidos.`;

export async function generateWeeklyAnalysis(config, payload, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: weeklyAnalysisPrompt }, { text: JSON.stringify(payload) }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 3500,
          responseSchema: { type: 'OBJECT', properties: { summary: { type: 'STRING' }, comparison: { type: 'STRING' },
            insights: { type: 'OBJECT', properties: { training: { type: 'STRING' }, nutrition: { type: 'STRING' }, weight: { type: 'STRING' } }, required: ['training', 'nutrition', 'weight'] },
            trends: { type: 'ARRAY', items: { type: 'STRING' } }, reviewPoints: { type: 'ARRAY', items: { type: 'STRING' } }, nextWeekFocus: { type: 'ARRAY', items: { type: 'STRING' } } },
            required: ['summary', 'comparison', 'insights', 'trends', 'reviewPoints', 'nextWeekFocus'] } } }),
    });
  } catch (error) {
    const timeout = ['TimeoutError', 'AbortError'].includes(error?.name);
    throw providerError(503, timeout ? 'WEEKLY_AI_TIMEOUT' : 'WEEKLY_AI_UNAVAILABLE', timeout ? 'El análisis tardó demasiado. El reporte semanal sigue disponible.' : 'No pudimos conectar con la IA. El reporte semanal sigue disponible.');
  }
  if (!response.ok) throw geminiHttpFailure(response.status, await response.json().catch(() => ({})));
  try {
    const raw = await response.json(); const candidate = raw.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete response');
    const text = candidate.content.parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    return validateWeeklyAnalysis(JSON.parse(text));
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error?.name)) throw providerError(503, 'WEEKLY_AI_TIMEOUT', 'El análisis tardó demasiado. El reporte semanal sigue disponible.');
    throw providerError(502, 'INVALID_WEEKLY_ANALYSIS', 'La IA no devolvió un análisis válido. El reporte semanal sigue disponible.');
  }
}

export async function analyzeWeeklyReport({ db, uid, config, report, context, fetcher = fetch }) {
  const payload = weeklyPayload(report, context);
  if (!report.current.training.totalSessions && !report.current.food.meals && !report.current.weight.count) {
    throw providerError(400, 'INSUFFICIENT_WEEKLY_DATA', 'Esta semana no tiene registros suficientes para analizar. Registrá entrenamiento, alimentación o peso.');
  }
  const fingerprint = weeklyFingerprint(payload, config.geminiModel);
  const user = db.collection('users').doc(uid);
  const scope = createHash('sha256').update(`${report.period.from}:${report.period.timeZone}`).digest('hex');
  const ref = user.collection('weeklyAnalyses').doc(`${scope}-${fingerprint}`);
  const userQuota = user.collection('weeklyAnalysisUsage').doc(report.period.from);
  const now = Date.now(); const day = new Date(now).toISOString().slice(0, 10); const minute = Math.floor(now / 60000);
  const globalQuota = db.collection('weeklyAnalysisUsage').doc(day);
  const attempt = randomUUID();
  const cached = await db.runTransaction(async tx => {
    const existing = await tx.get(ref); const data = existing.exists ? existing.data() : null;
    if (data?.status === 'ready') return data;
    if (data?.status === 'processing' && data.leaseUntil > now) throw providerError(409, 'WEEKLY_ANALYSIS_PROCESSING', 'Ya se está analizando esta semana. Esperá y volvé a consultar.');
    if (!config.geminiApiKey) throw providerError(503, 'GEMINI_NOT_CONFIGURED', 'El análisis semanal con IA todavía no está habilitado. El reporte sigue disponible.');
    const [userDoc, globalDoc] = await Promise.all([tx.get(userQuota), tx.get(globalQuota)]);
    const used = userDoc.exists ? userDoc.data().count : 0;
    const global = globalDoc.exists ? globalDoc.data() : { count: 0, minute, minuteCount: 0 };
    const minuteCount = global.minute === minute ? global.minuteCount : 0;
    if (used >= config.weeklyAnalysisUserWeeklyLimit || global.count >= config.weeklyAnalysisGlobalDailyLimit || minuteCount >= config.weeklyAnalysisGlobalMinuteLimit) {
      throw providerError(429, 'WEEKLY_ANALYSIS_LIMIT', 'Se alcanzó el límite disponible de análisis semanal. Podés seguir consultando el reporte y los análisis ya guardados; intentá más tarde.');
    }
    tx.set(userQuota, { count: used + 1, weekStart: report.period.from });
    tx.set(globalQuota, { count: global.count + 1, minute, minuteCount: minuteCount + 1 });
    tx.set(ref, { status: 'processing', fingerprint, attempt, leaseUntil: now + 90000, weekStart: report.period.from,
      timeZone: report.period.timeZone, model: config.geminiModel, schemaVersion, createdAt: new Date(now).toISOString() });
    return null;
  });
  if (cached) return { analysis: { ...validateWeeklyAnalysis(cached.analysis), comparison: weeklyComparison(payload) }, fingerprint, cached: true, generatedAt: cached.generatedAt };
  try {
    const analysis = { ...await generateWeeklyAnalysis(config, payload, fetcher), comparison: weeklyComparison(payload) };
    const generatedAt = new Date().toISOString();
    await db.runTransaction(async tx => { const doc = await tx.get(ref); if (doc.data()?.attempt === attempt) tx.set(ref, { ...doc.data(), status: 'ready', analysis, generatedAt }); });
    return { analysis, fingerprint, cached: false, generatedAt };
  } catch (error) {
    await db.runTransaction(async tx => { const doc = await tx.get(ref); if (doc.data()?.attempt === attempt) tx.set(ref, { ...doc.data(), status: 'failed', failureCode: error.code || 'WEEKLY_ANALYSIS_FAILED' }); });
    throw error;
  }
}
