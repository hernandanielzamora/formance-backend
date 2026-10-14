import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOnboarding, calculateTargets } from '../src/services/onboarding.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

const profile = { name: 'Usuario', age: 27, sex: 'male', heightCm: 175, initialWeightKg: 75, activity: 'moderate', goal: 'maintain' };
test('Onboarding valida entradas y no permite elegir identidad ni privilegios', () => {
  assert.deepEqual(validateOnboarding(profile), profile);
  for (const invalid of [{ ...profile, uid: 'otro' }, { ...profile, admin: true }, { ...profile, age: 17 }, { ...profile, initialWeightKg: '75' }, { ...profile, activity: 'unknown' }, { ...profile, targets: { calories: 0 } }]) {
    assert.throws(() => validateOnboarding(invalid, true));
  }
});
test('Referencia reproducible y coherente con objetivo y energía de macros', () => {
  const reference = calculateTargets(profile);
  assert.deepEqual(reference, calculateTargets(profile));
  assert.equal(reference.calories, reference.maintenanceCalories);
  assert.ok(calculateTargets({ ...profile, goal: 'muscle' }).calories > reference.calories);
  assert.ok(calculateTargets({ ...profile, goal: 'fat_loss' }).calories < reference.calories);
  assert.ok(Math.abs(reference.calories - (reference.protein * 4 + reference.fat * 9 + reference.carbohydrates * 4)) <= 10);
});

test('Onboarding guarda perfil y peso juntos bajo el UID autenticado y evita duplicados', async () => {
  const documents = new Map();
  function reference(path) {
    return { path, collection: (name) => ({ doc: (id) => reference(`${path}/${name}/${id}`) }), async get() { return { exists: documents.has(path), data: () => documents.get(path) }; } };
  }
  const app = createApp({ config: parseEnv({ NODE_ENV: 'test' }) });
  app.locals.firebase = {
    auth: { async verifyIdToken(token) { return { uid: 'owner', email_verified: token !== 'unverified' }; } },
    db: {
      collection: (name) => ({ doc: (id) => reference(`${name}/${id}`) }),
      async runTransaction(callback) {
        const writes = [];
        const result = await callback({ get: (ref) => ref.get(), set: (ref, data) => writes.push([ref.path, data]) });
        for (const [path, data] of writes) documents.set(path, data);
        return result;
      },
    },
  };
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/profile`;
  const headers = { Authorization: 'Bearer valid', 'Content-Type': 'application/json' };
  try {
    const unverified = await fetch(base, { headers: { Authorization: 'Bearer unverified' } });
    assert.equal(unverified.status, 403);
    const invalid = await fetch(`${base}/onboarding`, { method: 'PUT', headers, body: JSON.stringify({ ...profile, uid: 'victim' }) });
    assert.equal(invalid.status, 400);
    assert.equal(documents.size, 0);
    const preview = await fetch(`${base}/onboarding/preview`, { method: 'POST', headers, body: JSON.stringify(profile) });
    assert.equal(preview.status, 200);
    assert.equal(documents.size, 0);
    const save = await fetch(`${base}/onboarding`, { method: 'PUT', headers, body: JSON.stringify(profile) });
    assert.equal(save.status, 200);
    assert.equal(documents.size, 2);
    assert.equal(documents.get('users/owner/weightMeasurements/initial').weightKg, 75);
    const duplicate = await fetch(`${base}/onboarding`, { method: 'PUT', headers, body: JSON.stringify({ ...profile, initialWeightKg: 80 }) });
    assert.equal(duplicate.status, 409);
    assert.equal(documents.get('users/owner').initialWeightKg, 75);
    assert.equal((await (await fetch(base, { headers })).json()).profile.name, profile.name);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
