import { fields, date, timeZone, localToday } from './training-sessions.js';
import { invalid } from './training.js';
export const roundWeight = value => Math.round((value + Number.EPSILON) * 100) / 100;
export function dateAt(value, zone) {
  const instant = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}
export function normalizeWeight(item, zone) {
  if (typeof item.weightKg !== 'number' || !Number.isFinite(item.weightKg) || item.weightKg <= 0) return null;
  const localDate = item.localDate || dateAt(item.recordedAt || item.createdAt, item.timeZone || zone);
  if (!localDate) return null;
  return { ...item, localDate, timeZone: item.timeZone || zone, dateInferred: item.dateInferred === true || !item.localDate,
    version: item.version || 1, note: item.note || '', source: item.id === 'initial' ? 'onboarding' : 'manual', readOnly: item.id === 'initial' };
}
export function effectiveWeights(items, from, to) {
  const byDay = new Map();
  for (const item of items.filter(Boolean).filter(item => !item.archived && item.localDate >= from && item.localDate <= to).sort((a, b) => Number(b.id === 'initial') - Number(a.id === 'initial') || (a.updatedAt || '').localeCompare(b.updatedAt || ''))) byDay.set(item.localDate, item);
  return [...byDay.values()].sort((a, b) => a.localDate.localeCompare(b.localDate));
}
export function weightMetrics(items) {
  const points = [...items].sort((a, b) => a.localDate.localeCompare(b.localDate));
  const first = points[0] || null; const last = points.at(-1) || null;
  return { count: points.length, first, last, averageKg: points.length ? roundWeight(points.reduce((sum, item) => sum + item.weightKg, 0) / points.length) : null,
    changeKg: points.length > 1 ? roundWeight(last.weightKg - first.weightKg) : null, measurements: points };
}
export function validateWeight(body, update = false) {
  fields(body, ['localDate', 'timeZone', 'weightKg', 'note', ...(update ? ['expectedVersion'] : [])]);
  const localDate = date(body.localDate); const zone = timeZone(body.timeZone);
  if (localDate > localToday(zone)) invalid('No se pueden registrar pesos futuros.');
  if (typeof body.weightKg !== 'number' || !Number.isFinite(body.weightKg) || body.weightKg < 30 || body.weightKg > 350 || Math.abs(body.weightKg - roundWeight(body.weightKg)) > 0.0000001) invalid('Ingresá un peso entre 30 y 350 kg, con hasta dos decimales.');
  if (typeof body.note !== 'string' || body.note.length > 500) invalid('La nota admite hasta 500 caracteres.');
  if (update && (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1)) invalid('Falta la versión de la medición.');
  return { localDate, timeZone: zone, weightKg: roundWeight(body.weightKg), note: body.note.trim() };
}
export async function readWeights(user, from, to, zone) {
  const [snapshot, original] = await Promise.all([
    user.collection('weightMeasurements').where('localDate', '>=', from).where('localDate', '<=', to).limit(401).get(),
    user.collection('weightMeasurements').doc('initial').get(),
  ]);
  if (snapshot.docs.length > 400) invalid('Hay demasiadas mediciones para este período. No se muestran resultados incompletos.');
  const initial = original.exists ? normalizeWeight({ ...original.data(), id: 'initial' }, zone) : null;
  const points = snapshot.docs.filter(doc => doc.id !== 'initial').map(doc => normalizeWeight({ ...doc.data(), id: doc.id }, zone));
  return { initial, measurements: effectiveWeights([initial, ...points], from, to) };
}
