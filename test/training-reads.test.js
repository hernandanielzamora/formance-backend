import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../test-support/firestore.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

test('Training reads only required collections and preserves private/admin/active-routine access', async () => {
  const { db, store } = fixture();
  const reads = [];
  const original = db.collection;
  function track(collection, path, filters = []) {
    return {
      ...collection,
      where: (field, op, value) => track(collection.where(field, op, value), path, [...filters, [field, op, value]]),
      async get() { reads.push({ path, filters }); return collection.get(); },
    };
  }
  db.collection = path => track(original(path), path);
  const app = createApp({ config: parseEnv({ NODE_ENV: 'test' }) });
  app.locals.firebase = { db, auth: { async verifyIdToken(uid) { return { uid, email_verified: true, admin: uid === 'admin' }; } } };
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const request = (path, method = 'GET', body, uid = 'user') => fetch(`http://127.0.0.1:${server.address().port}/api/training/${path}`, {
    method, headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const collections = () => [...new Set(reads.map(read => read.path))].sort();
  try {
    const exerciseBody = { name: 'Personal', muscle: 'Core', equipment: 'Floor', instructions: 'Control movement.' };
    const exerciseResponse = await request('exercises', 'POST', exerciseBody);
    assert.equal(exerciseResponse.status, 201); const { exercise } = await exerciseResponse.json();
    assert.deepEqual(collections(), []);
    reads.length = 0;
    assert.equal((await request(`exercises/${exercise.id}`, 'PUT', { ...exerciseBody, expectedVersion: 1 })).status, 200);
    assert.deepEqual(collections(), []);
    const response = await request('workouts', 'POST', { name: 'Core', focus: 'Core', exercises: [{ exerciseId: exercise.id, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 60 }] });
    assert.equal(response.status, 201); const { workout } = await response.json();
    assert.deepEqual(collections(), ['exercises']); reads.length = 0;
    const routineResponse = await request('routines', 'POST', { name: 'Week', days: Array.from({ length: 7 }, (_, dayIndex) => ({ dayIndex, workoutIds: dayIndex === 0 ? [workout.id] : [] })) });
    assert.equal(routineResponse.status, 201); const { routine } = await routineResponse.json();
    assert.deepEqual(collections(), ['exercises', 'workouts']);
    store.set('routines/foreign', { ...routine, id: 'foreign', ownerId: 'other' });
    store.set('routines/archived', { ...routine, id: 'archived', archived: true });
    reads.length = 0;
    const mine = await (await request('routines')).json();
    assert.deepEqual(mine.routines.map(item => item.id), [routine.id]);
    assert.deepEqual(collections(), ['routines']);
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].filters, [['visibility', '==', 'private'], ['ownerId', '==', 'user']]);
    const all = await (await request('routines', 'GET', undefined, 'admin')).json();
    assert.deepEqual(all.routines.map(item => item.id).sort(), [routine.id, 'foreign'].sort());
    const publicId = [...store].find(([key, data]) => key.startsWith('routines/') && data.visibility === 'public')[1].id;
    store.set('users/user/settings/training', { activeRoutineId: publicId });
    assert.equal((await (await request('routines')).json()).activeRoutineId, publicId);
    store.set('users/user/settings/training', { activeRoutineId: 'foreign' });
    assert.equal((await (await request('routines')).json()).activeRoutineId, null);
    store.set('users/user/settings/training', { activeRoutineId: 'archived' });
    assert.equal((await (await request('routines')).json()).activeRoutineId, null);
    reads.length = 0;
    const catalog = await (await request('catalog')).json();
    assert.ok(catalog.routineTemplates.some(item => item.id === publicId));
    assert.ok(catalog.exercises.some(item => item.id === exercise.id));
    assert.deepEqual(collections(), ['exercises', 'routines', 'workouts']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
