import { createHash } from 'node:crypto';
import { date, timeZone, localToday, sessionSnapshot, validateSessionUpdate } from '../../src/services/training-sessions.js';
import { shiftDate } from '../../src/services/reports.js';
import { mealInput, scale, total } from '../../src/services/food.js';
import { validateWeight, normalizeWeight } from '../../src/services/weight.js';

export const studyNote = '[DEMO SIMULADA] Datos ficticios para la presentación; no representan actividad real.';
const fingerprint = value => createHash('sha256').update(value).digest('hex').slice(0, 12);

export function buildStudyTraining({ routine, from, to, zone, today = localToday(zone), existing = [], createdAt = new Date().toISOString() }) {
  date(from); date(to); timeZone(zone);
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  if (days < 1 || days > 31 || to >= today) throw new Error('Elegí hasta 31 días pasados, terminando como máximo ayer.');
  if (!routine?.id || routine.archived || !Number.isInteger(routine.version) || routine.days?.length !== 7) throw new Error('La rutina activa no es válida.');
  const seedId = `study-v1-${from}-${to}-${fingerprint(`${routine.id}:${routine.version}`)}`;
  const demoData = { simulated: true, purpose: 'presentation', seedId };
  const sessions = []; const skipped = [];
  for (let day = from, offset = 0; day <= to; day = shiftDate(day, 1), offset++) {
    const index = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    for (const assignment of routine.days[index].assignments || []) {
      const id = `study-v1-${day}-${fingerprint(`${routine.id}:${assignment.assignmentId}`)}`;
      if (existing.some(item => item.id === id || (item.localDate === day && item.routineId === routine.id && (item.assignmentId === assignment.assignmentId || item.workoutId === assignment.workoutId)))) { skipped.push(id); continue; }
      const startedAt = `${day}T21:00:00.000Z`;
      const snapshot = sessionSnapshot(routine, assignment, { sessionId: id, localDate: day, timeZone: zone }, startedAt);
      // Intentionally varied illustrative values, never inferred strength or a recommendation.
      const week = Math.floor(offset / 7);
      const interrupted = offset >= 10 && offset <= 16 && sessions.every(item => item.status !== 'abandoned');
      const performedEntries = snapshot.performedEntries.map((entry, i) => {
        const planned = snapshot.workoutSnapshot.entries[i].planned;
        const equipment = assignment.exercises[i].equipment || assignment.exercises[i].exerciseSnapshot?.equipment;
        const bodyweight = equipment === 'Peso corporal';
        const unknown = equipment === 'Banda elástica' || entry.exerciseId === 'assisted-pull-up';
        const base = equipment === 'Barra' ? 20 : equipment === 'Máquina' ? 25 : equipment === 'Polea' ? 15 : 8;
        return { ...entry, sets: Array.from({ length: planned.sets }, (_, setIndex) => {
          const completed = !interrupted || (i === 0 && setIndex === 0);
          return { setId: `study-${fingerprint(`${id}:${entry.entryId}:${setIndex}`)}`, order: setIndex,
            reps: completed ? Math.min(planned.repsMax, planned.repsMin + (week + setIndex) % 3) : null,
            externalLoadKg: completed ? unknown ? null : bodyweight ? 0 : base + week * 2 : null, completed };
        }) };
      });
      const update = validateSessionUpdate({ expectedVersion: 1, status: interrupted ? 'abandoned' : 'completed', note: `${studyNote} ${interrupted ? 'Ejemplo de sesión interrumpida.' : `Semana de muestra ${week + 1}.`}`, performedEntries }, snapshot);
      sessions.push({ ...snapshot, ...update, finishedAt: `${day}T21:50:00.000Z`, createdAt, updatedAt: createdAt, demoData });
    }
  }
  return { seedId, from, to, timeZone: zone, routineId: routine.id, routineVersion: routine.version, simulated: true, sessions, skipped };
}

// Original illustrative food values. No USDA references or fake Gemini analyses.
const food = (name, calories, protein, fat, carbohydrates) => ({ name, nutrients: { calories, protein, fat, carbohydrates } });
const foods = {
  oats: food('Avena', 389, 16.9, 6.9, 66.3), milk: food('Leche', 50, 3.4, 1.8, 4.9), banana: food('Banana', 89, 1.1, .3, 22.8),
  chicken: food('Pechuga de pollo cocida', 165, 31, 3.6, 0), rice: food('Arroz cocido', 130, 2.7, .3, 28), vegetables: food('Verduras mixtas', 35, 2, .3, 7),
  oil: food('Aceite de oliva', 884, 0, 100, 0), lentils: food('Lentejas cocidas', 116, 9, .4, 20), eggs: food('Huevos cocidos', 155, 13, 11, 1.1),
  potato: food('Papa cocida', 87, 1.9, .1, 20), yogurt: food('Yogur natural alto en proteínas', 73, 9, 2, 4), almonds: food('Almendras', 579, 21, 50, 22),
  apple: food('Manzana', 52, .3, .2, 14), fish: food('Pescado cocido', 130, 26, 2, 0), beef: food('Carne magra cocida', 200, 28, 9, 0),
  quinoa: food('Quinoa cocida', 120, 4.4, 1.9, 21), pasta: food('Pasta cocida', 158, 5.8, .9, 31), beans: food('Porotos cocidos', 127, 8.7, .5, 23),
};

export function buildStudyData({ routine, profile, from, to, zone, today, existing = {}, createdAt = new Date().toISOString() }) {
  const training = buildStudyTraining({ routine, from, to, zone, today, existing: existing.sessions || [], createdAt });
  const demoData = { simulated: true, purpose: 'presentation', seedId: training.seedId };
  const meals = []; const weights = []; let skippedMeals = 0; let skippedWeights = 0;
  const originalWeights = (existing.weights || []).map(item => normalizeWeight(item, zone)).filter(Boolean);
  for (let day = from, offset = 0; day <= to; day = shiftDate(day, 1), offset++) {
    const factor = [1, 1.05, .95, 1.1, 1, .9, 1.05][offset % 7];
    const menu = {
      breakfast: [['oats', 60], ['milk', 250], ['banana', 120]],
      lunch: [[['chicken', 'fish', 'beef'][offset % 3], 160], [['rice', 'pasta', 'quinoa'][offset % 3], 220], ['vegetables', 150], ['oil', 10]],
      snack: [['yogurt', 200], ['almonds', 20], ['apple', 150]],
      dinner: [[offset % 2 ? 'beans' : 'lentils', 250], ['eggs', 100], ['potato', 200]],
    };
    for (const [mealType, ingredients] of Object.entries(menu)) {
      const mealId = `study-v1-${day}-${mealType}`;
      if ((existing.meals || []).some(item => item.id === mealId || (!item.archived && item.localDate === day && item.mealType === mealType))) { skippedMeals++; continue; }
      const input = mealInput({ mealId, localDate: day, timeZone: zone, mealType, note: `${studyNote} Valores nutricionales ilustrativos cargados manualmente.`, items: ingredients.map(([key, grams], i) => ({ itemId: `study-item-${i}`, source: 'manual', ...foods[key], grams: Math.round(grams * factor), basis: 'per100g',
        nutrients: { ...foods[key].nutrients, ...(offset === 11 && mealType === 'snack' && i === 0 ? { carbohydrates: null } : {}) } })) });
      const items = input.items.map(item => ({ ...item, estimated: false, totals: scale(item.nutrients, item.grams / 100) }));
      meals.push({ ...input, items, totals: total(items), fingerprint: createHash('sha256').update(JSON.stringify({ ...input, items })).digest('hex'), version: 1, archived: false, createdAt, updatedAt: createdAt, demoData });
    }
    if (offset % 2 === 0 || day === to) {
      if (originalWeights.some(item => item.id === day || item.localDate === day)) { skippedWeights++; continue; }
      if (!Number.isFinite(profile?.initialWeightKg)) throw new Error('Falta un peso inicial válido.');
      const weightKg = Math.round((profile.initialWeightKg + [.2, 0, -.2, .1, .3, -.1, 0][Math.floor(offset / 2) % 7]) * 100) / 100;
      const measurement = validateWeight({ localDate: day, timeZone: zone, weightKg, note: `${studyNote} Oscilaciones ficticias de un caso de mantenimiento.` });
      weights.push({ ...measurement, id: day, source: 'manual', archived: false, dateInferred: false, version: 1, recordedAt: `${day}T11:00:00.000Z`, createdAt, updatedAt: createdAt, demoData });
    }
  }
  return { ...training, meals, weights, skippedMeals, skippedWeights };
}
