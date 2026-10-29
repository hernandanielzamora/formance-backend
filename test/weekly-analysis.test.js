import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { fixture } from '../test-support/firestore.js';
import { weeklyPayload, weeklyFingerprint, validateWeeklyAnalysis } from '../src/services/weekly-analysis.js';
import { buildWeeklyReport, weeklyRange } from '../src/services/reports.js';

const analysis = { summary: 'Según los registros disponibles, hay datos parciales.', comparison: 'La semana anterior no tiene registros comparables.',
  insights: { training: 'Faltan sesiones registradas.', nutrition: 'Hay un día con alimentos registrados.', weight: 'Faltan mediciones.' },
  trends: ['Hay registros de alimentación.'], reviewPoints: ['No existen datos suficientes para determinar adherencia.'], nextWeekFocus: ['Revisá las porciones estimadas antes de guardar.'] };
const response = (value = analysis) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] } }] }), { status: 200 });
const food = calories => ({ localDate: '2026-01-05', timeZone: 'UTC', note: 'PERSONAL_SECRET', archived: false,
  items: [{ itemId: 'PRIVATE_ITEM', name: 'PRIVATE_NAME', source: 'manual', totals: { calories, protein: 10, fat: 5, carbohydrates: 20 } }] });
async function harness(options = {}) {
  const { db, store } = fixture();
  store.set('users/alice/foodLogs/private-id', food(200));
  store.set('users/bob/foodLogs/other-id', food(9000));
  store.set('users/alice', { goal: 'recomposition', name: 'PRIVATE_PROFILE', email: 'PRIVATE_EMAIL', targets: { calories: 999 } });
  const config = parseEnv({ NODE_ENV: 'test', GEMINI_API_KEY: 'test-secret', WEEKLY_AI_GLOBAL_MINUTE_LIMIT: '30', ...options.env });
  const app = createApp({ config }); let calls = 0; const requests = [];
  app.locals.firebase = { db, auth: { async verifyIdToken(uid) { return { uid, email_verified: uid !== 'unverified' }; } } };
  app.locals.weeklyAnalysisFetch = async (...args) => { calls++; requests.push(args); return options.fetcher ? options.fetcher(...args) : response(); };
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/reports`;
  return { store, requests, config, calls: () => calls,
    post: (uid = 'alice', body = { weekStart: '2026-01-05', timeZone: 'UTC' }) => fetch(`${base}/weekly-analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid}` } : {}) }, body: JSON.stringify(body) }),
    weekly: () => fetch(`${base}/weekly?weekStart=2026-01-05&timeZone=UTC`, { headers: { Authorization: 'Bearer alice' } }),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
test('Weekly analysis requires verified identity, validates week and rejects arbitrary UID', async () => {
  const h = await harness();
  try {
    assert.equal((await h.post(null)).status, 401);
    assert.equal((await h.post('unverified')).status, 403);
    assert.equal((await h.post('alice', { weekStart: '2026-01-05', timeZone: 'UTC', uid: 'bob' })).status, 400);
    for (const body of [{ weekStart: '2026-01-06', timeZone: 'UTC' }, { weekStart: '2099-01-05', timeZone: 'UTC' }, { weekStart: '2026-01-05', timeZone: 'invalid' }]) assert.equal((await h.post('alice', body)).status, 400);
    assert.equal((await h.post('empty')).status, 400); assert.equal(h.calls(), 0);
    const result = await h.post(); assert.equal(result.status, 200);
    const returned = (await result.json()).analysis;
    assert.deepEqual({ ...returned, comparison: analysis.comparison }, analysis);
    assert.match(returned.comparison, /período anterior no tiene registros/);
    const sent = JSON.stringify(JSON.parse(h.requests[0][1].body));
    for (const secret of ['PERSONAL_SECRET', 'PRIVATE_ITEM', 'PRIVATE_NAME', 'PRIVATE_PROFILE', 'PRIVATE_EMAIL', 'private-id', 'alice', 'bob', '9000']) assert.ok(!sent.includes(secret), secret);
    const payload = JSON.parse(JSON.parse(h.requests[0][1].body).contents[0].parts[1].text);
    assert.equal(payload.context.currentGoal, 'recomposition'); assert.equal(payload.context.goalAppliesHistorically, false);
    assert.equal(payload.schemaVersion, 2); assert.equal(payload.evidence.coverage.previousHasRecords, false);
    assert.equal(h.requests[0][1].signal instanceof AbortSignal, true);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await (await h.weekly()).json()).current.food.nutrients.calories.value, 200);
  } finally { await h.close(); }
});
test('Identical report uses persistent cache without spending quota; modified records produce new hash', async () => {
  const h = await harness();
  try {
    const first = await (await h.post()).json(); assert.equal(first.cached, false);
    const second = await (await h.post()).json(); assert.equal(second.cached, true); assert.equal(h.calls(), 1); assert.equal(first.fingerprint, second.fingerprint);
    h.store.set('users/alice/foodLogs/private-id', food(300));
    const changed = await (await h.post()).json(); assert.notEqual(first.fingerprint, changed.fingerprint); assert.equal(h.calls(), 2);
    h.store.set('users/alice/foodLogs/private-id', food(400));
    const limited = await h.post(); assert.equal(limited.status, 429); assert.equal((await limited.json()).error.code, 'WEEKLY_ANALYSIS_LIMIT');
    h.store.set('users/alice/foodLogs/private-id', food(200)); assert.equal((await (await h.post()).json()).cached, true); assert.equal(h.calls(), 2);
    assert.equal(h.store.get('users/alice/weeklyAnalysisUsage/2026-01-05').count, 2);
    assert.ok(![...h.store.keys()].some(key => key.includes('foodAnalysisUsage')));
    assert.equal((await (await h.post('bob')).json()).cached, false); assert.equal(h.calls(), 3);
  } finally { await h.close(); }
});
test('Global daily and minute quotas block upstream generation independently of photo quotas', async () => {
  for (const env of [{ WEEKLY_AI_GLOBAL_DAILY_LIMIT: '1' }, { WEEKLY_AI_GLOBAL_MINUTE_LIMIT: '1' }]) {
    const h = await harness({ env });
    try { assert.equal((await h.post()).status, 200); assert.equal((await h.post('bob')).status, 429); assert.equal(h.calls(), 1); }
    finally { await h.close(); }
  }
});
test('Goal context participates in the cache without resetting the existing weekly quota', async () => {
  const h = await harness();
  try {
    const first = await (await h.post()).json();
    h.store.set('users/alice', { goal: 'muscle' });
    const changed = await (await h.post()).json();
    assert.notEqual(first.fingerprint, changed.fingerprint); assert.equal(h.calls(), 2);
    h.store.set('users/alice', { goal: 'maintain' });
    assert.equal((await h.post()).status, 429);
    assert.equal(h.store.get('users/alice/weeklyAnalysisUsage/2026-01-05').count, 2);
  } finally { await h.close(); }
});
test('Unconfigured Gemini does not spend quota; normal weekly report is independent', async () => {
  const h = await harness({ env: { GEMINI_API_KEY: '' } });
  try { const result = await h.post(); assert.equal(result.status, 503); assert.equal((await result.json()).error.code, 'GEMINI_NOT_CONFIGURED'); assert.equal(h.calls(), 0); assert.equal((await h.weekly()).status, 200); }
  finally { await h.close(); }
});
test('Provider invalid JSON, empty response, wrong format, HTTP errors, network failure and timeout preserve normal report', async () => {
  const cases = [
    [() => response('{invalid'), 502, 'INVALID_WEEKLY_ANALYSIS'],
    [() => response(''), 502, 'INVALID_WEEKLY_ANALYSIS'],
    [() => response({ summary: 'bad', trends: 'wrong', reviewPoints: [] }), 502, 'INVALID_WEEKLY_ANALYSIS'],
    [() => new Response('{}'), 502, 'INVALID_WEEKLY_ANALYSIS'],
    [() => new Response('{}', { status: 403 }), 503, 'GEMINI_ACCESS_DENIED'],
    [() => new Response('{}', { status: 429 }), 429, 'PROVIDER_LIMIT'],
    [() => { throw new Error('private network details'); }, 503, 'WEEKLY_AI_UNAVAILABLE'],
    [() => { throw new DOMException('deadline', 'TimeoutError'); }, 503, 'WEEKLY_AI_TIMEOUT'],
    [() => ({ ok: true, json: async () => { throw new DOMException('body deadline', 'TimeoutError'); } }), 503, 'WEEKLY_AI_TIMEOUT'],
  ];
  for (const [fetcher, status, code] of cases) {
    const h = await harness({ fetcher });
    try {
      const result = await h.post(); assert.equal(result.status, status); assert.equal((await result.json()).error.code, code);
      assert.equal(h.calls(), 1); assert.equal((await h.weekly()).status, 200);
      assert.equal(h.store.get('users/alice/weeklyAnalysisUsage/2026-01-05').count, 1);
      assert.equal([...h.store.entries()].find(([key]) => key.startsWith('users/alice/weeklyAnalyses/'))[1].status, 'failed');
    } finally { await h.close(); }
  }
});
test('Processing lease prevents duplicate generation', async () => {
  let release; let started;
  const begin = new Promise(resolve => { started = resolve; });
  const h = await harness({ fetcher: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  try {
    const pending = h.post(); await begin;
    assert.equal((await h.post()).status, 409); assert.equal(h.calls(), 1);
    release(response()); assert.equal((await pending).status, 200);
  } finally { await h.close(); }
});
test('Expired processing reservation can recover; cached analysis survives missing provider configuration', async () => {
  const h = await harness();
  try {
    const first = await (await h.post()).json();
    const [path, document] = [...h.store.entries()].find(([key]) => key.startsWith('users/alice/weeklyAnalyses/'));
    h.store.set(path, { ...document, status: 'processing', leaseUntil: 0 });
    assert.equal((await (await h.post()).json()).cached, false); assert.equal(h.calls(), 2);
    assert.equal(first.fingerprint, h.store.get(path).fingerprint);
    h.config.geminiApiKey = '';
    assert.equal((await (await h.post()).json()).cached, true); assert.equal(h.calls(), 2);
  } finally { await h.close(); }
});
test('Hash ignores identity and notes but changes with food, training, weight or comparable periods', () => {
  const range = weeklyRange({ weekStart: '2026-01-05', timeZone: 'UTC' });
  const make = (sessions = [], meals = [], weights = []) => weeklyPayload(buildWeeklyReport(range, sessions, meals, weights));
  const original = make([], [food(200)]); const hash = data => weeklyFingerprint(data, 'test-model');
  assert.equal(hash(original), hash(make([], [{ ...food(200), note: 'changed', id: 'other' }])));
  assert.notEqual(hash(original), hash(make([], [food(300)])));
  assert.notEqual(hash(original), hash(make([{ id: 'id', localDate: '2026-01-05', status: 'completed', performedEntries: [] }], [food(200)])));
  assert.notEqual(hash(original), hash(make([], [food(200)], [{ id: '2026-01-05', localDate: '2026-01-05', weightKg: 70 }])));
  assert.notEqual(hash(original), weeklyFingerprint(original, 'different-model'));
  assert.notEqual(hash(original), weeklyFingerprint({ ...original, schemaVersion: 1 }, 'test-model'));
  assert.notEqual(hash(original), hash(weeklyPayload(buildWeeklyReport(range, [], [food(200)]), { goal: 'muscle' })));
  assert.equal(weeklyPayload(buildWeeklyReport(range, [], [food(200)]), { goal: 'PERSONAL_SECRET' }).context.currentGoal, null);
  for (const invalid of [null, [], {}, { ...analysis, extra: true }, { ...analysis, trends: [] }, { ...analysis, summary: ' ' }, { ...analysis, reviewPoints: [5] }]) assert.throws(() => validateWeeklyAnalysis(invalid));
  for (const invalid of [{ ...analysis, comparison: '' }, { ...analysis, insights: { ...analysis.insights, extra: 'x' } }, { ...analysis, insights: { training: 'only' } },
    { ...analysis, nextWeekFocus: [] }, { ...analysis, nextWeekFocus: Array(4).fill('too many') }, { ...analysis, summary: 'x'.repeat(1201) }]) assert.throws(() => validateWeeklyAnalysis(invalid));
});
