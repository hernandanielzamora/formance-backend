import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { fixture } from '../test-support/firestore.js';
import { mealInput, scale, total, validateImage } from '../src/services/food.js';
import { createFoodProviders, normalizeUSDA } from '../src/services/food-providers.js';
const nutrition = { calories: 200, protein: 10, fat: 0, carbohydrates: null };
const input = { mealId: 'meal-1', localDate: '2026-01-01', timeZone: 'UTC', mealType: 'lunch', note: '', items: [{ itemId: 'item-1', source: 'manual', name: 'Arroz', grams: 150, basis: 'per100g', nutrients: nutrition }] };
const photo = { requestId: 'photo-1', mimeType: 'image/jpeg', image: Buffer.from([255,216,255,224,0,0,0,0,0,0,0,0,0]).toString('base64'), consent: true };
test('Porciones, datos desconocidos, referencias y fotos se validan sin inventar nutrientes', () => {
  assert.equal(scale(nutrition, 1.5).calories, 300); assert.equal(scale(nutrition, 1.5).fat, 0); assert.equal(scale(nutrition, 1.5).carbohydrates, null);
  assert.deepEqual(total([{ totals: scale(nutrition, 1.5) }]).carbohydrates, { value: 0, complete: false });
  assert.throws(() => mealInput({ ...input, ownerId: 'other' }));
  assert.throws(() => mealInput({ ...input, items: [{ ...input.items[0], grams: 0 }] }));
  assert.throws(() => mealInput({ ...input, items: [{ ...input.items[0], nutrients: { ...nutrition, calories: -10 } }] }));
  assert.throws(() => validateImage({ ...photo, consent: false }));
  assert.throws(() => validateImage({ ...photo, mimeType: 'image/png' }));
});
test('USDA usa claves privadas, caché y nutrientes por 100 g; Gemini valida respuestas y cuotas remotas', async () => {
  let count = 0; const config = parseEnv({ USDA_API_KEY: 'private-usda', GEMINI_API_KEY: 'private-gemini' });
  const rawFood = { fdcId: 123, description: 'Rice, cooked', foodNutrients: [{ nutrientId: 1008, value: 130 }, { nutrientId: 1003, value: 2.7 }, { nutrientId: 1004, value: 0 }] };
  const providers = createFoodProviders(config, async (url, options) => {
    count++; assert.ok(!url.includes('private-'));
    if (url.includes('nal.usda.gov')) { assert.equal(options.headers['X-Api-Key'], 'private-usda'); return new Response(JSON.stringify(url.includes('search') ? { foods: [rawFood] } : { ...rawFood, foodNutrients: [{ nutrient: { id: 1008 }, amount: 130 }] })); }
    assert.equal(options.headers['x-goog-api-key'], 'private-gemini');
    const body = JSON.parse(options.body); assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg'); assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ items: [{ name: 'Arroz cocido', grams: 150, nutrients: nutrition }], note: 'Porción aproximada.' }) }] } }] }));
  });
  assert.equal((await providers.search('Rice'))[0].nutrients.fat, 0); await providers.search('rice'); assert.equal(count, 1);
  assert.equal((await providers.food(123)).nutrients.calories, 130); await providers.food(123); assert.equal(count, 2);
  assert.equal((await providers.analyze(photo)).items[0].basis, 'per100g'); assert.equal(count, 3);
  assert.equal(normalizeUSDA(rawFood).nutrients.carbohydrates, null);
  await assert.rejects(createFoodProviders(config, async () => new Response('{}', { status: 429 })).analyze(photo), error => error.status === 429);
  await assert.rejects(createFoodProviders(config, async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }))).analyze(photo), error => error.code === 'INVALID_ANALYSIS');
});
test('Logs privados, snapshots USDA, edición versionada, reintentos y análisis con cupos persistentes', async () => {
  const { db, store } = fixture(); const config = parseEnv({ USDA_API_KEY: 'x', GEMINI_API_KEY: 'y', FOOD_AI_USER_DAILY_LIMIT: '1', FOOD_AI_GLOBAL_DAILY_LIMIT: '2' });
  const app = createApp({ config }); app.locals.firebase = { db, auth: { async verifyIdToken(uid) { return { uid, email_verified: true, admin: uid === 'admin' }; } } };
  let calls = 0; app.locals.foodProviders = { async food(foodId) { return { name: 'Arroz USDA', foodId, brand: null, nutrients: nutrition }; }, async search() { return []; }, async analyze() { calls++; return { items: [{ source: 'gemini', basis: 'per100g', name: 'Arroz', grams: 200, nutrients: nutrition }], note: 'Estimación.' }; } };
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/food`;
  const request = (path, method = 'GET', body, uid = 'food-user') => fetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await (await request('capabilities')).json()).gemini, true);
    assert.equal((await request('meals', 'POST', input)).status, 201); assert.equal((await request('meals', 'POST', input)).status, 200);
    assert.equal((await request('meals', 'POST', { ...input, note: 'Different' })).status, 409);
    const daily = await (await request('diary?date=2026-01-01&timeZone=UTC')).json(); assert.equal(daily.totals.calories.value, 300); assert.equal(daily.totals.carbohydrates.complete, false);
    assert.equal((await (await request('diary?date=2026-01-01&timeZone=UTC', 'GET', undefined, 'other')).json()).meals.length, 0);
    assert.equal((await request('meals/meal-1', 'PUT', { ...input, expectedVersion: 1 }, 'other')).status, 404);
    assert.equal((await request('meals/meal-1', 'PUT', { ...input, expectedVersion: 1 }, 'admin')).status, 404);
    assert.equal((await request('meals/meal-1', 'PUT', { ...input, note: 'Actualizada', expectedVersion: 1 })).status, 200);
    assert.equal((await request('meals/meal-1', 'PUT', { ...input, expectedVersion: 1 })).status, 409);
    const usda = { ...input, mealId: 'meal-2', items: [{ itemId: 'item-2', source: 'usda', foodId: 123, grams: 50, nutrients: { calories: 9999 } }] };
    const result = await request('meals', 'POST', usda); assert.equal(result.status, 201); assert.equal((await result.json()).meal.items[0].totals.calories, 100);
    assert.equal((await request('analyze', 'POST', { ...photo, consent: false })).status, 400); assert.equal(calls, 0);
    assert.equal((await request('analyze', 'POST', photo)).status, 200); assert.equal((await request('analyze', 'POST', photo)).status, 200); assert.equal(calls, 1);
    assert.equal((await request('analyze', 'POST', { ...photo, requestId: 'photo-2' })).status, 429);
    assert.equal((await request('analyze', 'POST', photo, 'food-user-two')).status, 200);
    assert.equal((await request('analyze', 'POST', photo, 'food-user-three')).status, 429);
    assert.equal(calls, 2);
    const fromAI = { ...input, mealId: 'meal-ai', items: [{ ...input.items[0], source: 'gemini', analysisId: 'photo-1' }] };
    assert.equal((await request('meals', 'POST', fromAI, 'other')).status, 400); assert.equal((await request('meals', 'POST', fromAI)).status, 201);
    assert.equal(store.get('users/food-user/foodLogs/meal-ai').items[0].estimated, true);
    assert.ok(!Object.values(store.get('users/food-user/foodAnalyses/photo-1')).includes(photo.image));
    assert.equal((await request('meals/meal-1', 'DELETE', { expectedVersion: 2 })).status, 200);
    assert.ok(!(await (await request('diary?date=2026-01-01&timeZone=UTC')).json()).meals.some(meal => meal.id === 'meal-1'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
