import { exercises, workouts, routineTemplates } from '../fixtures/training.js';
import { validateExercise, validateWorkout, validateRoutine } from '../../src/services/training.js';

export const catalogSeeds = { exercises, workouts, routines: routineTemplates };
export const catalogGoals = ['maintain', 'muscle', 'recomposition', 'fat_loss'];

// Plan before writing. Existing public documents (including their versions and
// snapshots) win over fixture data. Private/archived ID collisions stop the plan.
export function planTrainingCatalog(current, ownerId, now = new Date().toISOString()) {
  const available = {}; const creates = []; const preserved = [];
  const base = { ownerId, visibility: 'public', source: 'catalog', archived: false, version: 1, createdAt: now, updatedAt: now };
  for (const [kind, seeds] of Object.entries(catalogSeeds)) {
    if (new Set(seeds.map(item => item.id)).size !== seeds.length) throw new Error(`IDs duplicados en ${kind}.`);
    available[kind] = seeds.map(seed => {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(seed.id)) throw new Error(`ID inválido en ${kind}.`);
      const existing = current[kind]?.get(seed.id);
      if (existing) {
        if (existing.visibility !== 'public' || existing.archived || existing.source !== 'catalog' || !Number.isInteger(existing.version) || existing.version < 1) throw new Error(`Conflicto en ${kind}/${seed.id}: no se modificó el catálogo. Revisar contenido privado, archivado o inválido.`);
        if (kind === 'exercises') validateExercise({ name: existing.name, muscle: existing.muscle, equipment: existing.equipment, instructions: existing.instructions });
        preserved.push(`${kind}/${seed.id}`);
        return { ...existing, id: seed.id };
      }
      let value;
      if (kind === 'exercises') value = validateExercise({ name: seed.name, muscle: seed.muscle, equipment: seed.equipment, instructions: seed.instructions });
      else if (kind === 'workouts') value = validateWorkout({ name: seed.name, focus: seed.focus, exercises: seed.exercises }, available.exercises);
      else value = validateRoutine({ name: seed.name, days: seed.days, goals: seed.goals, sourceTemplateId: null, description: seed.description, rationale: seed.rationale, level: seed.level }, available.workouts, available.exercises);
      const document = { ...value, ...base, id: seed.id };
      creates.push({ kind, id: seed.id, value: document });
      return document;
    });
  }
  // Validate the effective catalog, not just the declarations, before any writes.
  for (const workout of available.workouts) {
    validateWorkout({ name: workout.name, focus: workout.focus, exercises: workout.exercises.map(({ exerciseId, sets, repsMin, repsMax, restSeconds }) => ({ exerciseId, sets, repsMin, repsMax, restSeconds })) }, available.exercises);
  }
  const coverage = Object.fromEntries(catalogGoals.map(goal => [goal, available.routines.filter(item => item.goals?.includes(goal)).length]));
  if (Object.values(coverage).some(count => count < 3)) throw new Error('Faltan al menos tres rutinas disponibles por objetivo.');
  return { creates, preserved, coverage, totals: Object.fromEntries(Object.entries(available).map(([kind, items]) => [kind, items.length])) };
}

export async function seedTrainingCatalog(db, ownerId, apply = false) {
  const references = Object.entries(catalogSeeds).flatMap(([kind, items]) => items.map(item => ({ kind, id: item.id, ref: db.collection(kind).doc(item.id) })));
  // Single transaction: either the complete addition and its revisions commit,
  // or nothing changes. Reading refs also detects concurrent admin edits.
  return db.runTransaction(async transaction => {
    const snapshots = await Promise.all(references.map(item => transaction.get(item.ref)));
    const current = { exercises: new Map(), workouts: new Map(), routines: new Map() };
    snapshots.forEach((snapshot, index) => { if (snapshot.exists) current[references[index].kind].set(references[index].id, snapshot.data()); });
    const plan = planTrainingCatalog(current, ownerId);
    if (apply) for (const item of plan.creates) {
      const ref = db.collection(item.kind).doc(item.id);
      transaction.create(ref, item.value);
      transaction.create(ref.collection('revisions').doc('1'), item.value);
    }
    return plan;
  });
}
