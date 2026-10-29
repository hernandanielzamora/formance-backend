import { createHash, randomUUID } from 'node:crypto';
import { providerError } from './food-providers.js';
import { geminiHttpFailure } from './gemini-errors.js';

const schemaVersion = 1;
const keys = ['calories', 'protein', 'fat', 'carbohydrates'];
export function weeklyPayload(report) {
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
  return { schemaVersion, period: { from: report.period.from, through: report.period.through,
    elapsedDays: report.period.elapsedDays, isPartial: report.period.isPartial },
    current: period(report.current), previous: period(report.previous),
    comparison: { completedSessionsDelta: report.comparison.completedSessionsDelta,
      completedSetsDelta: report.comparison.completedSetsDelta, recordedDaysDelta: report.comparison.recordedDaysDelta,
      weightAverageDeltaKg: report.comparison.weightAverageDeltaKg, externalVolumeDelta: report.comparison.externalVolumeDelta },
    limitations: report.limitations };
}
export function weeklyFingerprint(payload, model) {
  return createHash('sha256').update(JSON.stringify({ payload, model, schemaVersion })).digest('hex');
}
export function validateWeeklyAnalysis(value) {
  const object = value && typeof value === 'object' && !Array.isArray(value);
  const validText = text => typeof text === 'string' && text.trim().length > 0 && text.length <= 1800;
  if (!object || Object.keys(value).length !== 3 || !Object.hasOwn(value, 'summary') || !validText(value.summary)
    || !['trends', 'reviewPoints'].every(key => Array.isArray(value[key]) && value[key].length >= 1 && value[key].length <= 6 && value[key].every(validText))) {
    throw providerError(502, 'INVALID_WEEKLY_ANALYSIS', 'La IA devolvió un análisis con formato inválido. Intentá más tarde.');
  }
  return { summary: value.summary.trim(), trends: value.trends.map(s => s.trim()), reviewPoints: value.reviewPoints.map(s => s.trim()) };
}
const prompt = `Interpretá descriptivamente estos datos agregados de Formance en español. Las métricas ya están calculadas: no calcules, recalcules ni inventes métricas, porcentajes, registros o relaciones causales.
Usá expresiones como “Según los registros disponibles…”, “Durante esta semana se observa…”, “En comparación con los datos disponibles…” y “No existen datos suficientes para determinar…”.
No diagnostiques, prescribas, generes tratamientos, dietas ni rutinas. No recomiendes medicamentos ni suplementos. No afirmes causalidad ni adherencia histórica. Un día sin registros NO significa que no hubo comida o entrenamiento. Aclarar datos faltantes, cobertura parcial, alimentos estimados y límites de comparabilidad; null es desconocido y no cero. La variación de peso no demuestra variación de grasa. No comparar volumen si externalVolumeDelta es null. No atribuir mejora de fuerza. No des instrucciones profesionales.
Respondé SOLO JSON con exactamente summary (string), trends (array de 1 a 6 strings) y reviewPoints (array de 1 a 6 strings). Cada texto máximo 1800 caracteres. reviewPoints describe limitaciones de los registros, no recomendaciones clínicas.`;

export async function generateWeeklyAnalysis(config, payload, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { text: JSON.stringify(payload) }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2500,
          responseSchema: { type: 'OBJECT', properties: { summary: { type: 'STRING' }, trends: { type: 'ARRAY', items: { type: 'STRING' } }, reviewPoints: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['summary', 'trends', 'reviewPoints'] } } }),
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

export async function analyzeWeeklyReport({ db, uid, config, report, fetcher = fetch }) {
  const payload = weeklyPayload(report);
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
  if (cached) return { analysis: validateWeeklyAnalysis(cached.analysis), fingerprint, cached: true, generatedAt: cached.generatedAt };
  try {
    const analysis = await generateWeeklyAnalysis(config, payload, fetcher);
    const generatedAt = new Date().toISOString();
    await db.runTransaction(async tx => { const doc = await tx.get(ref); if (doc.data()?.attempt === attempt) tx.set(ref, { ...doc.data(), status: 'ready', analysis, generatedAt }); });
    return { analysis, fingerprint, cached: false, generatedAt };
  } catch (error) {
    await db.runTransaction(async tx => { const doc = await tx.get(ref); if (doc.data()?.attempt === attempt) tx.set(ref, { ...doc.data(), status: 'failed', failureCode: error.code || 'WEEKLY_ANALYSIS_FAILED' }); });
    throw error;
  }
}
