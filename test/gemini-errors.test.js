import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiHttpFailure } from '../src/services/gemini-errors.js';
import { createFoodProviders } from '../src/services/food-providers.js';
import { parseEnv } from '../src/config/env.js';
import { fixture } from '../test-support/firestore.js';
import { createApp } from '../src/app.js';

test('Gemini distingue permisos, clave, modelo, cuota y servicio sin filtrar mensajes del proveedor', () => {
  for (const [http, code, expected] of [[400, 'GEMINI_REQUEST_REJECTED', 503], [403, 'GEMINI_ACCESS_DENIED', 503], [404, 'GEMINI_MODEL_UNAVAILABLE', 503], [429, 'PROVIDER_LIMIT', 429], [503, 'GEMINI_UNAVAILABLE', 503], [500, 'GEMINI_UPSTREAM_ERROR', 502], [504, 'GEMINI_TIMEOUT', 503]]) {
    const error = geminiHttpFailure(http, { error: { message: 'private-key-and-photo-data' } });
    assert.equal(error.code, code); assert.equal(error.status, expected); assert.equal(error.upstreamStatus, http);
    assert.ok(!JSON.stringify(error).includes('private-key')); assert.ok(!error.message.includes('private-key'));
  }
  assert.equal(geminiHttpFailure(400, { error: { details: [{ reason: 'API_KEY_INVALID' }] } }).code, 'GEMINI_KEY_INVALID');
  assert.equal(geminiHttpFailure(403, { error: { message: 'Your API key was reported as leaked.' } }).code, 'GEMINI_KEY_BLOCKED');
});

test('Modelo moderno por defecto, parámetros compatibles y un solo intento por análisis', async () => {
  const config = parseEnv({ GEMINI_API_KEY: 'private-key' }); assert.equal(config.geminiModel, 'gemini-3.5-flash-lite');
  for (const model of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']) assert.equal(parseEnv({ GEMINI_MODEL: model }).geminiModel, model);
  let calls = 0;
  const provider = createFoodProviders(config, async (url, options) => {
    calls++; assert.ok(url.endsWith('/gemini-3.5-flash-lite:generateContent')); assert.ok(!url.includes('private-key'));
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.temperature, undefined); assert.equal(body.tools, undefined);
    return new Response('Not found', { status: 404 });
  });
  await assert.rejects(provider.analyze({ image: 'test', mimeType: 'image/jpeg' }), error => error.code === 'GEMINI_MODEL_UNAVAILABLE');
  assert.equal(calls, 1);
  await assert.rejects(createFoodProviders(config, async () => { const cause = new Error('Contains a private URL'); cause.cause = { code: 'EAI_AGAIN' }; throw cause; }).analyze({}), error => error.code === 'GEMINI_NETWORK_ERROR' && error.transportCode === 'EAI_AGAIN' && !error.message.includes('private'));
  await assert.rejects(createFoodProviders(config, async () => { throw new DOMException('private timeout details', 'TimeoutError'); }).analyze({}), error => error.code === 'GEMINI_TIMEOUT');
});

test('La API conserva el diagnóstico del modelo en fallos sin guardar imagen ni relajar cupos', async () => {
  const { db, store } = fixture(); const config = parseEnv({ GEMINI_API_KEY: 'test-key', FOOD_AI_USER_DAILY_LIMIT: '1' });
  const app = createApp({ config }); app.locals.firebase = { db, auth: { async verifyIdToken() { return { uid: 'diagnostic-user', email_verified: true }; } } };
  let calls = 0; app.locals.foodProviders = { async analyze() { calls++; throw geminiHttpFailure(404); } };
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const photo = { requestId: 'test-photo', mimeType: 'image/jpeg', image: Buffer.from([255,216,255,224,0,0,0,0,0,0,0,0,0]).toString('base64'), consent: true };
  const request = body => fetch(`http://127.0.0.1:${server.address().port}/api/food/analyze`, { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const response = await request(photo); assert.equal(response.status, 503);
    const body = await response.json(); assert.equal(body.error.code, 'GEMINI_MODEL_UNAVAILABLE');
    const stored = store.get('users/diagnostic-user/foodAnalyses/test-photo');
    assert.equal(stored.failureCode, 'GEMINI_MODEL_UNAVAILABLE'); assert.equal(stored.upstreamStatus, 404);
    assert.ok(!Object.values(stored).includes(photo.image));
    assert.equal((await request({ ...photo, requestId: 'test-photo-2' })).status, 429); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
