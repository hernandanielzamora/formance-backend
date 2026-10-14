import { Router } from 'express';
import { createHash } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { id, date, timeZone, fields, localToday } from '../services/training-sessions.js';
import { mealInput, scale, total, validateImage, text } from '../services/food.js';
import { providerError } from '../services/food-providers.js';
export const foodRoutes = Router();
foodRoutes.use(requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.identity.email_verified !== true) return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu correo para continuar.' } });
  req.foodUser = req.app.locals.firebase.db.collection('users').doc(req.identity.uid); next();
});
foodRoutes.get('/capabilities', (req, res) => {
  const config = req.app.locals.config;
  res.json({ usda: Boolean(config.usdaApiKey), gemini: Boolean(config.geminiApiKey), userDailyLimit: config.foodAnalysisUserDailyLimit });
});
// Lightweight per-user request limiter; paid upstream analysis also has persistent project-wide quotas below.
const requestWindows = new Map();
foodRoutes.use((req, res, next) => {
  const minute = Math.floor(Date.now() / 60000); const key = req.identity.uid;
  if (requestWindows.size > 1000) for (const [uid, item] of requestWindows) if (item.minute !== minute) requestWindows.delete(uid);
  const current = requestWindows.get(key); const count = current?.minute === minute ? current.count + 1 : 1;
  requestWindows.set(key, { minute, count });
  if (count > 40) return res.status(429).json({ error: { code: 'REQUEST_LIMIT', message: 'Esperá un minuto antes de continuar.' } }); next();
});
foodRoutes.get('/search', async (req, res) => { const query = text(req.query.q, 80); if (query.length < 2) throw providerError(400, 'INVALID_QUERY', 'Ingresá al menos dos caracteres.'); res.json({ foods: await req.app.locals.foodProviders.search(query) }); });
foodRoutes.get('/diary', async (req, res) => {
  const localDate = date(req.query.date); const zone = timeZone(req.query.timeZone);
  const [snapshot, profile] = await Promise.all([req.foodUser.collection('foodLogs').where('localDate', '==', localDate).where('archived', '==', false).limit(201).get(), req.foodUser.get()]);
  if (snapshot.docs.length > 200) throw providerError(400, 'TOO_MANY_MEALS', 'Hay demasiados registros para mostrar este día.');
  const meals = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(meal => !meal.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ meals, totals: total(meals.flatMap(meal => meal.items)), targets: profile.exists ? profile.data().targets || null : null, today: localToday(zone) });
});
async function snapshots(req, items) {
  return Promise.all(items.map(async item => {
    if (item.source === 'usda') { const food = await req.app.locals.foodProviders.food(item.foodId); return { ...item, name: food.name, brand: food.brand, basis: 'per100g', nutrients: food.nutrients, totals: scale(food.nutrients, item.grams / 100), estimated: false }; }
    if (item.source === 'gemini') { const analysis = await req.foodUser.collection('foodAnalyses').doc(item.analysisId).get(); if (!analysis.exists || analysis.data().status !== 'ready') throw providerError(400, 'INVALID_ANALYSIS', 'La estimación no pertenece a tu cuenta o ya no está disponible.'); }
    return { ...item, totals: scale(item.nutrients, item.basis === 'per100g' ? item.grams / 100 : 1), estimated: item.source === 'gemini' };
  }));
}
for (const method of ['post', 'put']) foodRoutes[method](method === 'post' ? '/meals' : '/meals/:id', async (req, res) => {
  const input = mealInput(req.body, method === 'put');
  if (method === 'put' && id(req.params.id) !== input.id) throw providerError(400, 'INVALID_MEAL', 'Registro inválido.');
  if (input.localDate > localToday(input.timeZone)) throw providerError(400, 'FUTURE_MEAL', 'No se pueden registrar comidas futuras.');
  const items = await snapshots(req, input.items);
  const ref = req.foodUser.collection('foodLogs').doc(input.id); const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const result = await req.app.locals.firebase.db.runTransaction(async tx => {
    const existing = await tx.get(ref); const before = existing.exists ? existing.data() : null;
    if (method === 'post' && before) { if (!before.archived && before.fingerprint === fingerprint) return { meal: before, existing: true }; throw providerError(409, 'VERSION_CONFLICT', 'Este identificador ya tiene otro registro.'); }
    if (method === 'put' && (!before || before.archived)) throw providerError(404, 'NOT_FOUND', 'Comida no encontrada.');
    if (method === 'put' && before.version !== req.body.expectedVersion) throw providerError(409, 'VERSION_CONFLICT', 'El registro cambió. Actualizá el diario antes de editar.');
    const now = new Date().toISOString(); const meal = { ...input, items, totals: total(items), fingerprint, version: (before?.version || 0) + 1, archived: false, createdAt: before?.createdAt || now, updatedAt: now };
    tx.set(ref, meal); return { meal };
  });
  res.status(method === 'post' && !result.existing ? 201 : 200).json({ meal: result.meal });
});
foodRoutes.delete('/meals/:id', async (req, res) => {
  fields(req.body, ['expectedVersion']); const ref = req.foodUser.collection('foodLogs').doc(id(req.params.id));
  if (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion < 1) throw providerError(400, 'INVALID_VERSION', 'Falta la versión del registro.');
  await req.app.locals.firebase.db.runTransaction(async tx => { const doc = await tx.get(ref); if (!doc.exists || doc.data().archived) throw providerError(404, 'NOT_FOUND', 'Comida no encontrada.'); const meal = doc.data(); if (meal.version !== req.body.expectedVersion) throw providerError(409, 'VERSION_CONFLICT', 'El registro cambió. Actualizá el diario.'); tx.set(ref, { ...meal, archived: true, version: meal.version + 1, updatedAt: new Date().toISOString() }); });
  res.json({ archived: true });
});
foodRoutes.post('/analyze', async (req, res) => {
  const input = validateImage(req.body); const config = req.app.locals.config;
  if (!config.geminiApiKey) throw providerError(503, 'GEMINI_NOT_CONFIGURED', 'El análisis por foto todavía no está habilitado. Usá la carga manual.');
  const db = req.app.locals.firebase.db; const day = new Date().toISOString().slice(0, 10); const minute = Math.floor(Date.now() / 60000);
  const ref = req.foodUser.collection('foodAnalyses').doc(input.requestId);
  const userQuota = req.foodUser.collection('foodAnalysisUsage').doc(day); const globalQuota = db.collection('foodAnalysisUsage').doc(day);
  const hash = createHash('sha256').update(input.image).update(input.mimeType).digest('hex');
  const reservation = await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) { const value = existing.data(); if (value.imageHash === hash && value.status === 'ready') return value; throw providerError(409, 'ANALYSIS_CONFLICT', 'Este análisis ya fue solicitado. Intentá nuevamente desde la foto.'); }
    const user = await tx.get(userQuota); const global = await tx.get(globalQuota);
    const used = user.exists ? user.data().count : 0; const data = global.exists ? global.data() : { count: 0, minuteCount: 0, minute };
    const minuteCount = data.minute === minute ? data.minuteCount : 0;
    if (used >= config.foodAnalysisUserDailyLimit || data.count >= config.foodAnalysisGlobalDailyLimit || minuteCount >= config.foodAnalysisGlobalMinuteLimit) throw providerError(429, 'PHOTO_LIMIT', 'Se alcanzó el cupo de fotos. Podés usar búsqueda o registro manual.');
    tx.set(userQuota, { count: used + 1 }); tx.set(globalQuota, { count: data.count + 1, minute, minuteCount: minuteCount + 1 });
    tx.set(ref, { status: 'processing', imageHash: hash, model: config.geminiModel, createdAt: new Date().toISOString() }); return null;
  });
  if (reservation) return res.json({ analysisId: input.requestId, ...reservation.result });
  try {
    const result = await req.app.locals.foodProviders.analyze(input);
    await ref.set({ status: 'ready', imageHash: hash, model: config.geminiModel, result, createdAt: new Date().toISOString() });
    res.json({ analysisId: input.requestId, ...result });
  } catch (error) { await ref.set({ status: 'failed', imageHash: hash, model: config.geminiModel, createdAt: new Date().toISOString() }); throw error; }
});
