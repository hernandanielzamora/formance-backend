import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { fixture } from '../test-support/firestore.js';
import { normalizeWeight, effectiveWeights, validateWeight, weightMetrics } from '../src/services/weight.js';
import { weeklyRange, buildWeeklyReport } from '../src/services/reports.js';
import { validateOnboarding } from '../src/services/onboarding.js';
const input = { localDate: '2026-01-05', timeZone: 'UTC', weightKg: 74, note: '' };
test('Peso con fecha local, decimales y compatibilidad con el peso inicial antiguo', () => {
  assert.equal(validateWeight({ ...input, weightKg: 62.55 }).weightKg, 62.55);
  for (const body of [{ ...input, ownerId: 'other' }, { ...input, weightKg: 0 }, { ...input, weightKg: '74' }, { ...input, weightKg: 60.555 }, { ...input, timeZone: 'Fake/Zone' }, { ...input, localDate: '2099-01-05' }, { ...input, localDate: '2026-02-30' }]) assert.throws(() => validateWeight(body));
  const initial = normalizeWeight({ id: 'initial', weightKg: 75, recordedAt: '2026-01-06T01:00:00Z', source: 'onboarding' }, 'America/Argentina/Buenos_Aires');
  assert.equal(initial.localDate, '2026-01-05'); assert.equal(initial.dateInferred, true); assert.equal(initial.readOnly, true);
  const manual = { ...input, id: input.localDate, source: 'manual', archived: false };
  const effective = effectiveWeights([manual, initial], '2026-01-01', '2026-01-10'); assert.equal(effective.length, 1); assert.equal(effective[0].weightKg, 74);
  assert.equal(weightMetrics(effective).changeKg, null);
  assert.equal(weightMetrics([]).averageKg, null);
  const profile = { name: 'User', age: 30, sex: 'male', heightCm: 175, initialWeightKg: 75, activity: 'moderate', goal: 'maintain', timeZone: 'America/Argentina/Buenos_Aires' };
  assert.ok(validateOnboarding(profile).timeZone); assert.throws(() => validateOnboarding({ ...profile, timeZone: 'Fake/Zone' }));
});
test('Registro de peso privado por día, conflictos, revisión histórica y onboarding inmutable', async () => {
  const { db, store } = fixture(); const original = { weightKg: 75, recordedAt: '2026-01-05T15:00:00Z', source: 'onboarding' };
  store.set('users/weight-user/weightMeasurements/initial', original);
  const app = createApp({ config: parseEnv({ NODE_ENV: 'test' }) });
  app.locals.firebase = { db, auth: { async verifyIdToken(uid) { return { uid, email_verified: uid !== 'unverified', admin: uid === 'admin' }; } } };
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method = 'GET', body, uid = 'weight-user') => fetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const range = 'weight?from=2026-01-05&to=2026-01-11&timeZone=UTC';
  try {
    assert.equal((await request(range, 'GET', undefined, 'unverified')).status, 403);
    assert.equal((await request('weight/measurements', 'POST', input)).status, 201);
    assert.equal((await request('weight/measurements', 'POST', input)).status, 200);
    assert.equal((await request('weight/measurements', 'POST', { ...input, weightKg: 76 })).status, 409);
    let history = await (await request(range)).json(); assert.equal(history.measurements.length, 1); assert.equal(history.measurements[0].weightKg, 74); assert.equal(history.initial.weightKg, 75);
    const next = { ...input, localDate: '2026-01-06', weightKg: 73 };
    assert.equal((await request('weight/measurements', 'POST', next)).status, 201);
    assert.equal((await request('weight/measurements/2026-01-06', 'PUT', { ...next, weightKg: 72.5, expectedVersion: 1 })).status, 200);
    assert.equal((await request('weight/measurements/2026-01-06', 'PUT', { ...next, expectedVersion: 1 })).status, 409);
    assert.equal((await request('weight/measurements/2026-01-06', 'PUT', { ...next, expectedVersion: 2 }, 'other')).status, 404);
    assert.equal((await request('weight/measurements/2026-01-06', 'DELETE', { expectedVersion: 2 }, 'admin')).status, 404);
    assert.equal((await request('weight/measurements/initial', 'DELETE', { expectedVersion: 1 })).status, 400);
    history = await (await request(range)).json(); assert.equal(history.summary.averageKg, 73.25); assert.equal(history.summary.changeKg, -1.5);
    const report = await (await request('reports/weekly?weekStart=2026-01-05&timeZone=UTC')).json(); assert.equal(report.current.weight.count, 2); assert.equal(report.current.weight.changeKg, -1.5); assert.equal(report.logs.filter(log => log.type === 'weight').length, 2);
    assert.equal((await (await request(range, 'GET', undefined, 'other')).json()).measurements.length, 0);
    assert.equal((await request('weight/measurements/2026-01-06', 'DELETE', { expectedVersion: 1 })).status, 409);
    assert.equal((await request('weight/measurements/2026-01-06', 'DELETE', { expectedVersion: 2 })).status, 200);
    assert.equal((await request('weight/measurements', 'POST', next)).status, 201);
    assert.equal(store.get('users/weight-user/weightMeasurements/2026-01-06').version, 4);
    assert.equal(store.get('users/weight-user/weightMeasurements/2026-01-06/revisions/2').weightKg, 72.5);
    assert.equal(store.get('users/weight-user/weightMeasurements/2026-01-06/revisions/3').archived, true);
    assert.equal((await request('weight/measurements/2026-01-05', 'DELETE', { expectedVersion: 1 })).status, 200);
    history = await (await request(range)).json(); assert.equal(history.measurements[0].source, 'onboarding'); assert.equal(history.measurements[0].weightKg, 75);
    assert.deepEqual(store.get('users/weight-user/weightMeasurements/initial'), original);
    assert.equal((await request('weight?from=2025-01-01&to=2026-01-11&timeZone=UTC')).status, 400);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('Peso en reportes: solo mediciones del período, sin completar días ni arrastrar el inicial', () => {
  const range = weeklyRange({ weekStart: '2026-10-12', timeZone: 'UTC' }, '2026-10-14');
  const points = [
    { id: 'initial', weightKg: 80, localDate: '2026-01-01', timeZone: 'UTC', source: 'onboarding' },
    { id: '2026-10-05', weightKg: 76, localDate: '2026-10-05', timeZone: 'UTC', source: 'manual' },
    { id: '2026-10-12', weightKg: 75, localDate: '2026-10-12', timeZone: 'UTC', source: 'manual' },
    { id: '2026-10-14', weightKg: 74, localDate: '2026-10-14', timeZone: 'UTC', source: 'manual' },
    { id: '2026-10-15', weightKg: 73, localDate: '2026-10-15', timeZone: 'UTC', source: 'manual' },
  ];
  const report = buildWeeklyReport(range, [], [], points);
  assert.equal(report.current.weight.count, 2); assert.equal(report.current.weight.changeKg, -1); assert.equal(report.current.weight.averageKg, 74.5);
  assert.equal(report.previous.weight.changeKg, null); assert.equal(report.comparison.weightAverageDeltaKg, -1.5);
  assert.equal(report.current.days[1].weight, null); assert.equal(report.logs.length, 2);
  assert.equal(buildWeeklyReport(range, [], [], [points[0]]).current.weight.averageKg, null);
});
