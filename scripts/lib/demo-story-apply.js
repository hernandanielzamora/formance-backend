import { buildDemoStory, storyTemplateId, storyVersion } from './demo-story.js';

const kinds = ['trainingSessions', 'foodLogs', 'weightMeasurements'];
const manifestId = `story-v${storyVersion}`;
export const storyRoutineId = `demo-story-v${storyVersion}-${storyTemplateId}`;

// Plans (and with apply=true executes) the v2 demo story. Writes are idempotent:
// deterministic IDs + set, an in-progress manifest keeps the original backups.
export async function applyDemoStory({ db, uid, from = '2026-10-01', to = '2026-11-11', zone = 'America/Argentina/Buenos_Aires', apply = false, now = new Date().toISOString() }) {
  const user = db.collection('users').doc(uid);
  const manifestRef = user.collection('studyImports').doc(manifestId);
  const [profileDoc, settingsDoc, templateDoc, manifestDoc, routineDoc] = await Promise.all([user.get(), user.collection('settings').doc('training').get(),
    db.collection('routines').doc(storyTemplateId).get(), manifestRef.get(), db.collection('routines').doc(storyRoutineId).get()]);
  if (manifestDoc.exists && manifestDoc.data().status === 'done') return { alreadyApplied: true, ...manifestDoc.data() };
  const profile = profileDoc.data();
  if (!profile?.onboardingCompleted) throw new Error('La cuenta debe completar el onboarding.');
  if (!templateDoc.exists || templateDoc.data().archived || templateDoc.data().visibility !== 'public') throw new Error(`Falta la plantilla pública ${storyTemplateId}. Ejecutar seed:training primero.`);
  const previous = manifestDoc.exists ? manifestDoc.data().original : { profile: { goal: profile.goal, reference: profile.reference || null, targets: profile.targets || null }, activeRoutineId: settingsDoc.data()?.activeRoutineId || null };
  const routine = routineDoc.exists ? { ...routineDoc.data(), id: storyRoutineId } : { ...templateDoc.data(), id: storyRoutineId, ownerId: uid, visibility: 'private', source: 'personal',
    sourceTemplateId: storyTemplateId, version: 1, archived: false, createdAt: '2026-09-30T12:00:00.000Z', updatedAt: now, demoData: { simulated: true, purpose: 'presentation', story: storyVersion } };
  if (routine.ownerId !== uid || routine.archived) throw new Error('La rutina de la historia existe pero no pertenece a la cuenta o está archivada.');
  const story = buildDemoStory({ profile, routine, from, to, zone, createdAt: now });

  // Registros de demos anteriores (cualquier fecha) y registros reales dentro del período.
  const old = []; const real = { trainingSessions: [], foodLogs: [], weightMeasurements: [] };
  for (const kind of kinds) {
    const all = (await user.collection(kind).get()).docs.map(doc => ({ ...doc.data(), id: doc.id }));
    for (const item of all) {
      if (item.demoData?.simulated === true && item.demoData.story !== storyVersion) old.push({ kind, item });
      else if (!item.demoData?.simulated && item.id !== 'initial' && !item.archived && item.localDate >= from && item.localDate <= to) real[kind].push(item);
    }
  }
  const sessions = story.sessions.filter(item => !real.trainingSessions.some(other => other.localDate === item.localDate));
  const meals = story.meals.filter(item => !real.foodLogs.some(other => other.localDate === item.localDate && other.mealType === item.mealType));
  const weights = story.weights.filter(item => !real.weightMeasurements.some(other => other.localDate === item.localDate));
  const revisions = [];
  for (const { kind, item } of old) if (kind === 'weightMeasurements') {
    for (const doc of (await user.collection(kind).doc(item.id).collection('revisions').get()).docs) revisions.push({ path: [kind, item.id, doc.id], data: doc.data() });
  }
  const summary = { story: storyVersion, simulated: true, from, to, timeZone: zone, routineId: storyRoutineId, goal: story.goal, targets: story.targets,
    added: { sessions: sessions.length, meals: meals.length, weights: weights.length },
    statuses: { completed: sessions.filter(item => item.status === 'completed').length, abandoned: sessions.filter(item => item.status === 'abandoned').length },
    previousDemoArchived: Object.fromEntries(kinds.map(kind => [kind, old.filter(entry => entry.kind === kind).length])),
    realRecordsKept: Object.fromEntries(kinds.map(kind => [kind, real[kind].map(item => item.localDate).sort()])),
    original: previous };
  if (!apply) return { alreadyApplied: false, ...summary };

  const ops = [];
  ops.push(['set', manifestRef, { ...summary, status: 'in_progress', startedAt: manifestDoc.data()?.startedAt || now }]);
  for (const { kind, item } of old) {
    const { id, ...data } = item;
    ops.push(['set', user.collection('demoArchive').doc(`${kind}-${id}`), { collection: kind, id, data, archivedAt: now, reason: `Reemplazado por la historia v${storyVersion}` }]);
  }
  for (const revision of revisions) ops.push(['delete', user.collection(revision.path[0]).doc(revision.path[1]).collection('revisions').doc(revision.path[2])]);
  for (const { kind, item } of old) ops.push(['delete', user.collection(kind).doc(item.id)]);
  if (!routineDoc.exists) {
    const { id, ...data } = routine;
    ops.push(['set', db.collection('routines').doc(storyRoutineId), data], ['set', db.collection('routines').doc(storyRoutineId).collection('revisions').doc('1'), data]);
  }
  ops.push(['set', user.collection('settings').doc('training'), { ...(settingsDoc.data() || {}), activeRoutineId: storyRoutineId, updatedAt: now }]);
  ops.push(['set', user, { ...profile, goal: story.goal, reference: story.reference, targets: story.targets, updatedAt: now }]);
  for (const value of sessions) ops.push(['set', user.collection('trainingSessions').doc(value.id), value]);
  for (const value of meals) ops.push(['set', user.collection('foodLogs').doc(value.id), value]);
  for (const value of weights) {
    const ref = user.collection('weightMeasurements').doc(value.id);
    ops.push(['set', ref, value], ['set', ref.collection('revisions').doc('1'), value]);
  }
  for (let start = 0; start < ops.length; start += 400) {
    const batch = db.batch();
    for (const [type, ref, data] of ops.slice(start, start + 400)) type === 'set' ? batch.set(ref, data) : batch.delete(ref);
    await batch.commit();
  }
  const done = { ...summary, status: 'done', startedAt: manifestDoc.data()?.startedAt || now, completedAt: new Date().toISOString(), writes: ops.length + 1 };
  await manifestRef.set(done);
  return { alreadyApplied: false, ...done };
}
