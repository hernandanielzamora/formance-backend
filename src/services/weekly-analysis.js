import { createHash, randomUUID } from 'node:crypto';
import { providerError } from './food-providers.js';
import { geminiHttpFailure } from './gemini-errors.js';
import { weeklyEvidence, weeklyComparison } from './weekly-insights.js';

const schemaVersion = 4;
const keys = ['calories', 'protein', 'fat', 'carbohydrates'];
export function weeklyPayload(report, context = {}, extras = null) {
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
  const glance = report.glance ? { headline: report.glance.headline, wins: report.glance.wins.map(item => item.text), improvements: report.glance.improvements.map(item => item.text),
    training: (({ days, ...rest }) => rest)(report.glance.training), nutrition: (({ days, ...rest }) => rest)(report.glance.nutrition),
    weight: (({ points, ...rest }) => rest)(report.glance.weight), routinePlanned: report.glance.routinePlanned } : null;
  const targets = context.targets && typeof context.targets === 'object' ? Object.fromEntries(keys.map(key => [key, Number.isFinite(context.targets[key]) ? context.targets[key] : null])) : null;
  return { schemaVersion, context: { currentGoal: goal, currentTargets: targets, goalAppliesHistorically: false }, glance,
    ...(extras ? { trend: extras.trend, exerciseProgress: extras.exerciseProgress, notes: extras.notes } : {}),
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
  const validText = (text, max = 400) => typeof text === 'string' && text.trim().length > 0 && text.length <= max;
  const validList = (key, min, max) => Array.isArray(value[key]) && value[key].length >= min && value[key].length <= max && value[key].every(text => validText(text, 240));
  if (!object || Object.keys(value).length !== 6 || !validText(value.headline, 200) || !validText(value.focus, 240) || !validText(value.trend, 400)
    || !validList('wins', 1, 3) || !validList('improvements', 1, 3)
    || !value.detail || typeof value.detail !== 'object' || Array.isArray(value.detail)
    || Object.keys(value.detail).length !== 3 || !['training', 'nutrition', 'weight'].every(key => validText(value.detail[key], 500))) {
    throw providerError(502, 'INVALID_WEEKLY_ANALYSIS', 'No pudimos obtener un análisis con formato válido. Intentá más tarde.');
  }
  const spanish = text => text.trim().replace(/\bfat\b/gi, 'grasas').replace(/\bcarbohydrates\b/gi, 'carbohidratos').replace(/\bprotein\b/gi, 'proteínas');
  return { headline: spanish(value.headline), wins: value.wins.map(spanish), improvements: value.improvements.map(spanish), focus: spanish(value.focus), trend: spanish(value.trend),
    detail: Object.fromEntries(['training', 'nutrition', 'weight'].map(key => [key, spanish(value.detail[key])])) };
}
export const weeklyAnalysisPrompt = `Sos el coach de lectura de Formance. Hablale al usuario de vos, en español rioplatense, directo y concreto, como alguien que lo acompaña: qué está pasando, qué hizo bien, dónde puede mejorar y cómo viene en el último mes. Nada de introducciones, rodeos ni avisos genéricos.
Fuente de verdad: glance (lectura de esta semana ya calculada contra su objetivo actual, su rutina y la semana anterior), trend (las últimas 4 semanas, de la más antigua a la actual), exerciseProgress (carga máxima por semana de sus ejercicios principales) y notes (notas que el usuario escribió en sesiones y comidas). No hagas cuentas nuevas ni inventes datos; usá solo valores presentes, redondeados como aparecen. context.currentGoal: maintain=mantener peso, muscle=ganar masa muscular, recomposition=mejorar composición corporal, fat_loss=bajar grasa. Los objetivos (context.currentTargets) son los actuales.
Cómo usar el contexto:
- Compará esta semana con el mes: si un patrón se repite (fines de semana con más calorías, semanas completas seguidas, cargas que suben semana a semana), decilo con la cantidad de semanas. Si esta semana es una excepción, también.
- exerciseProgress: nombrá 1 o 2 ejercicios con su evolución (por ejemplo "sentadilla de 82,5 a 92,5 kg en 4 semanas"). No digas que ganó fuerza o músculo: hablá de la carga registrada.
- notes: usalas para explicar el contexto con las palabras del usuario ("cortaste la sesión por el viaje", "el sábado fue el cumpleaños"). No las cites textuales completas, no juzgues lo que cuenta y no repitas datos sensibles de salud que no hagan falta.
Contenido:
- headline: una frase (máx. 140 caracteres) con lo más importante de la semana, positivo o negativo.
- wins: 1–3 logros concretos con números (días entrenados, cargas, días en objetivo, proteína, peso alineado al objetivo, constancia del mes).
- improvements: 1–3 mejoras concretas con números, priorizando lo que se repite en el mes. Si la semana fue muy buena, proponé el siguiente desafío.
- focus: una sola acción práctica y realista para la próxima semana, vinculada a la mejora principal (máx. 160 caracteres).
- trend: 1–2 frases (máx. 300 caracteres) sobre cómo viene el último mes: constancia, carga de los ejercicios principales, calorías y peso.
- detail.training, detail.nutrition, detail.weight: 1–2 frases cada uno (máx. 260 caracteres) con el porqué de esta semana, usando datos y notas.
Límites: no diagnostiques ni prescribas dietas, medicamentos ni suplementos; no indiques cifras nuevas de calorías o cargas fuera de sus objetivos actuales. No atribuyas cambios de peso a grasa o músculo; para relacionar señales usá "coincide con", no causas. Un día sin registros no prueba que no haya comido o entrenado: decilo como falta de registro. Si la semana está en curso (period.isPartial), hablá de "hasta hoy".
Respondé SOLO JSON con exactamente: headline (string), wins (array 1–3 strings), improvements (array 1–3 strings), focus (string), trend (string), detail (objeto con training, nutrition, weight). Total breve: 110–180 palabras. No menciones IA, modelos ni Gemini.`;

export async function generateWeeklyAnalysis(config, payload, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: weeklyAnalysisPrompt }, { text: JSON.stringify(payload) }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2000,
          responseSchema: { type: 'OBJECT', properties: { headline: { type: 'STRING' }, wins: { type: 'ARRAY', items: { type: 'STRING' } },
            improvements: { type: 'ARRAY', items: { type: 'STRING' } }, focus: { type: 'STRING' }, trend: { type: 'STRING' },
            detail: { type: 'OBJECT', properties: { training: { type: 'STRING' }, nutrition: { type: 'STRING' }, weight: { type: 'STRING' } }, required: ['training', 'nutrition', 'weight'] } },
            required: ['headline', 'wins', 'improvements', 'focus', 'trend', 'detail'] } } }),
    });
  } catch (error) {
    const timeout = ['TimeoutError', 'AbortError'].includes(error?.name);
    throw providerError(503, timeout ? 'WEEKLY_AI_TIMEOUT' : 'WEEKLY_AI_UNAVAILABLE', timeout ? 'El análisis tardó demasiado. El reporte semanal sigue disponible.' : 'No pudimos obtener el análisis. El reporte semanal sigue disponible.');
  }
  if (!response.ok) throw geminiHttpFailure(response.status, await response.json().catch(() => ({})));
  try {
    const raw = await response.json(); const candidate = raw.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete response');
    const text = candidate.content.parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    return validateWeeklyAnalysis(JSON.parse(text));
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error?.name)) throw providerError(503, 'WEEKLY_AI_TIMEOUT', 'El análisis tardó demasiado. El reporte semanal sigue disponible.');
    throw providerError(502, 'INVALID_WEEKLY_ANALYSIS', 'No pudimos obtener un análisis válido. El reporte semanal sigue disponible.');
  }
}

export async function analyzeWeeklyReport({ db, uid, config, report, context, extras = null, fetcher = fetch }) {
  const payload = weeklyPayload(report, context, extras);
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
    if (!config.geminiApiKey) throw providerError(503, 'GEMINI_NOT_CONFIGURED', 'El análisis semanal todavía no está habilitado. El reporte sigue disponible.');
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
  if (cached) return { analysis: { ...validateWeeklyAnalysis((({ comparison, ...rest }) => rest)(cached.analysis)), comparison: weeklyComparison(payload) }, fingerprint, cached: true, generatedAt: cached.generatedAt };
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
