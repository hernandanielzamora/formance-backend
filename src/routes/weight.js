import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fields, date, timeZone, localToday } from '../services/training-sessions.js';
import { validateWeight, readWeights, weightMetrics } from '../services/weight.js';
import { providerError } from '../services/food-providers.js';
export const weightRoutes = Router();
weightRoutes.use(requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.identity.email_verified !== true) return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu correo para continuar.' } });
  req.weightUser = req.app.locals.firebase.db.collection('users').doc(req.identity.uid); next();
});
weightRoutes.get('/', async (req, res) => {
  const from = date(req.query.from); const to = date(req.query.to); const zone = timeZone(req.query.timeZone);
  const length = (new Date(to) - new Date(from)) / 86400000;
  if (length < 0 || length > 365) throw providerError(400, 'INVALID_RANGE', 'Elegí un período de hasta 366 días.');
  const result = await readWeights(req.weightUser, from, to, zone);
  res.json({ ...result, summary: weightMetrics(result.measurements), today: localToday(zone), from, to });
});
for (const method of ['post', 'put']) weightRoutes[method](method === 'post' ? '/measurements' : '/measurements/:date', async (req, res) => {
  const input = validateWeight(req.body, method === 'put');
  if (method === 'put' && date(req.params.date) !== input.localDate) throw providerError(400, 'INVALID_DATE', 'Para cambiar la fecha, creá una medición nueva.');
  const ref = req.weightUser.collection('weightMeasurements').doc(input.localDate);
  const result = await req.app.locals.firebase.db.runTransaction(async tx => {
    const snapshot = await tx.get(ref); const before = snapshot.exists ? snapshot.data() : null;
    if (method === 'post' && before && !before.archived) {
      if (['localDate', 'timeZone', 'weightKg', 'note'].every(key => before[key] === input[key])) return { measurement: { ...before, id: input.localDate }, existing: true };
      throw providerError(409, 'VERSION_CONFLICT', 'Ya hay un peso registrado para este día. Usá Editar en el historial.');
    }
    if (method === 'put' && (!before || before.archived)) throw providerError(404, 'NOT_FOUND', 'Medición no encontrada.');
    if (method === 'put' && before.version !== req.body.expectedVersion) throw providerError(409, 'VERSION_CONFLICT', 'La medición cambió. Actualizá el historial antes de editar.');
    const now = new Date().toISOString();
    const measurement = { ...input, id: input.localDate, source: 'manual', archived: false, dateInferred: false, version: (before?.version || 0) + 1, createdAt: before?.createdAt || now, updatedAt: now, recordedAt: now };
    tx.set(ref, measurement); tx.set(ref.collection('revisions').doc(String(measurement.version)), measurement);
    return { measurement };
  });
  res.status(method === 'post' && !result.existing ? 201 : 200).json(result);
});
weightRoutes.delete('/measurements/:date', async (req, res) => {
  fields(req.body, ['expectedVersion']);
  if (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion < 1) throw providerError(400, 'INVALID_VERSION', 'Falta la versión de la medición.');
  const ref = req.weightUser.collection('weightMeasurements').doc(date(req.params.date));
  await req.app.locals.firebase.db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data().archived) throw providerError(404, 'NOT_FOUND', 'Medición no encontrada.');
    const before = snapshot.data();
    if (before.version !== req.body.expectedVersion) throw providerError(409, 'VERSION_CONFLICT', 'La medición cambió. Actualizá el historial.');
    const value = { ...before, archived: true, version: before.version + 1, updatedAt: new Date().toISOString() };
    tx.set(ref, value); tx.set(ref.collection('revisions').doc(String(value.version)), value);
  });
  res.json({ archived: true });
});
