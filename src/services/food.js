import { invalid } from './training.js';
import { fields, date, timeZone, id } from './training-sessions.js';
export const nutrients = ['calories', 'protein', 'fat', 'carbohydrates'];
export const mealTypes = ['breakfast', 'lunch', 'snack', 'dinner', 'extra'];
export function text(value, max = 120) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid('Revisá el nombre o la descripción del alimento.'); return value.trim(); }
export function number(value, max, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) invalid('Revisá cantidades y valores nutricionales.');
  return value;
}
export function nutrition(body) {
  fields(body, nutrients);
  return Object.fromEntries(nutrients.map(key => [key, number(body[key], key === 'calories' ? 10000 : 1000, true)]));
}
export const round = value => Math.round(value * 100) / 100;
export function scale(values, factor) { return Object.fromEntries(nutrients.map(key => [key, values[key] === null ? null : round(values[key] * factor)])); }
export function total(items) {
  return Object.fromEntries(nutrients.map(key => [key, { value: round(items.reduce((sum, item) => sum + (item.totals[key] ?? 0), 0)), complete: items.every(item => item.totals[key] !== null) }]));
}
export function mealInput(body, update = false) {
  fields(body, ['mealId', 'localDate', 'timeZone', 'mealType', 'note', 'items', ...(update ? ['expectedVersion'] : [])]);
  id(body.mealId); date(body.localDate); timeZone(body.timeZone);
  if (!mealTypes.includes(body.mealType) || typeof body.note !== 'string' || body.note.length > 1500) invalid('Comida o nota inválida.');
  if (update && (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1)) invalid('Falta la versión del registro.');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) invalid('Agregá entre 1 y 20 alimentos.');
  const seen = new Set();
  const items = body.items.map(item => {
    fields(item, ['itemId', 'source', 'foodId', 'name', 'grams', 'basis', 'nutrients', 'analysisId']);
    id(item.itemId); if (seen.has(item.itemId)) invalid('Alimentos duplicados en el registro.'); seen.add(item.itemId);
    const grams = number(item.grams, 10000); if (!grams) invalid('Ingresá una cantidad mayor a cero.');
    if (!['manual', 'usda', 'gemini'].includes(item.source)) invalid('Origen de alimento inválido.');
    if (item.source === 'usda') { if (!Number.isInteger(item.foodId) || item.foodId < 1) invalid('Referencia USDA inválida.'); return { itemId: item.itemId, source: 'usda', foodId: item.foodId, grams }; }
    if (!['per100g', 'portion'].includes(item.basis)) invalid('Indicá si los valores son por 100 g o por porción.');
    if (item.source === 'gemini') id(item.analysisId);
    const values = nutrition(item.nutrients);
    return { itemId: item.itemId, source: item.source, name: text(item.name), grams, basis: item.basis, nutrients: values, ...(item.source === 'gemini' ? { analysisId: item.analysisId } : {}) };
  });
  return { id: body.mealId, localDate: body.localDate, timeZone: timeZone(body.timeZone), mealType: body.mealType, note: body.note.trim(), items };
}
export function validateImage(body) {
  fields(body, ['requestId', 'mimeType', 'image', 'consent']); id(body.requestId);
  if (body.consent !== true) invalid('Confirmá el envío de la foto a Google antes de analizar.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(body.mimeType) || typeof body.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image) || body.image.length > 1400000) invalid('Usá una imagen JPG, PNG o WebP de hasta 1 MB.');
  const data = Buffer.from(body.image, 'base64');
  if (data.length < 12 || data.length > 1000000 || data.toString('base64') !== body.image) invalid('Imagen inválida.');
  const valid = body.mimeType === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255 : body.mimeType === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) invalid('El formato no coincide con la imagen.');
  return { requestId: body.requestId, mimeType: body.mimeType, image: body.image };
}
export function validateAnalysis(data) {
  fields(data, ['items', 'note']);
  if (!Array.isArray(data.items) || data.items.length > 12) invalid('La foto no produjo una lista de alimentos válida.');
  return { note: text(data.note, 500), items: data.items.map(item => {
    fields(item, ['name', 'grams', 'nutrients']); const grams = number(item.grams, 10000); if (!grams) invalid('Porción estimada inválida.');
    return { name: text(item.name), grams, nutrients: nutrition(item.nutrients), basis: 'per100g', source: 'gemini' };
  }) };
}
