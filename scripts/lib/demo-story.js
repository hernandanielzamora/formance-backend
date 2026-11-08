import { createHash } from 'node:crypto';
import { date, timeZone, sessionSnapshot, validateSessionUpdate } from '../../src/services/training-sessions.js';
import { shiftDate } from '../../src/services/reports.js';
import { mealInput, scale, total } from '../../src/services/food.js';
import { calculateTargets } from '../../src/services/onboarding.js';

// Historia de demostración v2: recomposición del 1/10 al 11/11 con altibajos creíbles.
// Todo es determinista (mismo perfil + rutina = mismos documentos) e ilustrativo.
export const storyVersion = 2;
export const storyTemplateId = 'upper-lower-4';
const hash = value => createHash('sha256').update(value).digest('hex');
const noise = (key, amplitude) => ((parseInt(hash(key).slice(0, 8), 16) / 0xffffffff) * 2 - 1) * amplitude;
const weekday = day => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = lunes
const mondayOf = day => shiftDate(day, -weekday(day));

// Arco narrativo por semana (lunes): qué tan bien entrena, come y registra.
// floja = semana con viaje de trabajo; mejor = semana para mostrar en la presentación.
export const storyWeeks = {
  '2026-09-28': { kind: 'inicio', skip: [], abandon: [] },
  '2026-10-05': { kind: 'buena', skip: [], abandon: [] },
  '2026-10-12': { kind: 'buena', skip: [4], abandon: [], missingLoad: true },
  '2026-10-19': { kind: 'floja', skip: [3, 4], abandon: [1] },
  '2026-10-26': { kind: 'regreso', skip: [], abandon: [] },
  '2026-11-02': { kind: 'mejor', skip: [], abandon: [] },
  '2026-11-09': { kind: 'actual', skip: [], abandon: [] },
};
const progressWeek = monday => { const order = Object.keys(storyWeeks); const index = order.indexOf(monday); return index <= 3 ? Math.min(index, 2) : index - 1; };

// Carga de trabajo por ejercicio: inicio, salto y cada cuántas semanas progresa.
const loads = {
  squat: [80, 2.5, 1], 'bench-press': [60, 2.5, 2], rdl: [70, 2.5, 1], 'leg-press': [140, 10, 1], 'lat-pulldown': [50, 2.5, 2],
  'seated-row': [50, 2.5, 2], 'db-press': [22, 2, 2], 'shoulder-press': [16, 2, 3], 'db-row': [24, 2, 2], 'lateral-raise': [8, 1, 3],
  'biceps-curl': [12, 2, 3], 'triceps-pushdown': [25, 2.5, 2], 'leg-curl': [35, 2.5, 2], 'calf-raise': [60, 5, 2], lunges: [14, 2, 3], 'dead-bug': [0, 0, 1],
};
export function storyLoad(exerciseId, monday) {
  const [start, step, every] = loads[exerciseId] || [20, 2.5, 2];
  return start + step * Math.floor(progressWeek(monday) / every);
}
const progressedThisWeek = (exerciseId, monday) => {
  const order = Object.keys(storyWeeks); const previous = order[order.indexOf(monday) - 1];
  return previous ? storyLoad(exerciseId, monday) > storyLoad(exerciseId, previous) : false;
};
const sessionNotes = {
  '2026-10-01': 'Primera sesión con la rutina nueva. Busqué cargas cómodas para aprender la técnica.',
  '2026-10-09': 'Muy buena energía, todas las series completas.',
  abandoned: 'Viaje de trabajo: dormí mal y corté después de la sentadilla.',
  '2026-10-26': 'Volví después del viaje. Retomé las cargas de antes.',
  '2026-11-03': 'Récord personal en sentadilla.',
  '2026-11-06': 'Semana completa, la mejor desde que empecé.',
};

export function buildStoryTraining({ routine, from, to, zone, createdAt }) {
  if (!routine?.id || routine.days?.length !== 7 || !Number.isInteger(routine.version)) throw new Error('La rutina de la historia no es válida.');
  const sessions = [];
  for (let day = from; day <= to; day = shiftDate(day, 1)) {
    const monday = mondayOf(day); const week = storyWeeks[monday]; const index = weekday(day);
    if (!week) throw new Error(`Fecha fuera de la historia: ${day}`);
    for (const assignment of routine.days[index].assignments || []) {
      if (week.skip.includes(index)) continue;
      const id = `demo2-${day}-${hash(`${routine.id}:${assignment.assignmentId}`).slice(0, 10)}`;
      const startedAt = `${day}T22:00:00.000Z`;
      const snapshot = sessionSnapshot(routine, assignment, { sessionId: id, localDate: day, timeZone: zone }, startedAt);
      const abandoned = week.abandon.includes(index);
      const performedEntries = snapshot.performedEntries.map((entry, i) => {
        const planned = snapshot.workoutSnapshot.entries[i].planned;
        const load = storyLoad(entry.exerciseId, monday);
        const jumped = progressedThisWeek(entry.exerciseId, monday);
        return { ...entry, sets: Array.from({ length: planned.sets }, (_, setIndex) => {
          const done = !abandoned || i === 0 || (i === 1 && setIndex === 0);
          let reps = planned.repsMax - 1 - setIndex - (jumped ? 2 : 0) - (week.kind === 'floja' ? 1 : 0) + Math.round(noise(`${id}:${i}:${setIndex}`, .6));
          reps = Math.max(planned.repsMin, Math.min(planned.repsMax, reps));
          const forgotLoad = week.missingLoad && index === 0 && i === 2 && setIndex === planned.sets - 1;
          return { setId: `demo2-${hash(`${id}:${entry.entryId}:${setIndex}`).slice(0, 12)}`, order: setIndex,
            reps: done ? reps : null, externalLoadKg: done && !forgotLoad ? load : null, completed: done };
        }) };
      });
      const note = abandoned ? sessionNotes.abandoned : sessionNotes[day] || '';
      const update = validateSessionUpdate({ expectedVersion: 1, status: abandoned ? 'abandoned' : 'completed', note, performedEntries }, snapshot);
      sessions.push({ ...snapshot, ...update, version: 2, finishedAt: `${day}T23:10:00.000Z`, createdAt, updatedAt: createdAt,
        demoData: { simulated: true, purpose: 'presentation', story: storyVersion } });
    }
  }
  return sessions;
}

// Valores aproximados por 100 g; estimaciones ilustrativas de carga manual.
const food = (name, calories, protein, fat, carbohydrates, dense = false) => ({ name, dense, nutrients: { calories, protein, fat, carbohydrates } });
const foods = {
  oats: food('Avena arrollada', 389, 16.9, 6.9, 66.3), milk: food('Leche descremada', 36, 3.4, .5, 4.9), bread: food('Pan integral', 247, 13, 4.2, 41),
  egg: food('Huevo', 155, 13, 11, 1.1, true), whites: food('Claras de huevo', 52, 11, .2, .7, true), chicken: food('Pechuga de pollo cocida', 165, 31, 3.6, 0, true),
  rice: food('Arroz blanco cocido', 130, 2.7, .3, 28), lentils: food('Lentejas cocidas', 116, 9, .4, 20), potato: food('Papa hervida', 87, 1.9, .1, 20),
  yogurt: food('Yogur griego descremado', 59, 10, .4, 3.6, true), banana: food('Banana', 89, 1.1, .3, 22.8), apple: food('Manzana', 52, .3, .2, 14),
  oil: food('Aceite de oliva', 884, 0, 100, 0), pasta: food('Fideos cocidos', 158, 5.8, .9, 31), beef: food('Carne vacuna magra cocida', 200, 28, 9, 0, true),
  tuna: food('Atún al natural', 116, 26, 1, 0, true), tomato: food('Tomate', 18, .9, .2, 3.9), lettuce: food('Lechuga', 15, 1.4, .2, 2.9),
  cheese: food('Queso port salut light', 220, 24, 13, 1, true), ricotta: food('Ricota descremada', 138, 12, 8, 4, true), almonds: food('Almendras', 579, 21, 50, 22),
  orange: food('Naranja', 47, .9, .1, 11.8), peanut: food('Pasta de maní', 588, 25, 50, 20), fish: food('Merluza cocida', 110, 23, 1.5, 0, true),
  quinoa: food('Quinoa cocida', 120, 4.4, 1.9, 21), vegetables: food('Verduras salteadas', 45, 2, 1.5, 7), sweetpotato: food('Batata asada', 90, 2, .1, 21),
  wrap: food('Rapiditas integrales', 290, 9, 6, 50), turkey: food('Pechuga de pavo', 110, 22, 2, 1, true), berries: food('Frutos rojos', 50, 1, .3, 12),
  pizza: food('Pizza muzzarella', 270, 11, 11, 32), empanada: food('Empanadas de carne', 280, 10, 15, 26), asado: food('Asado (vacío)', 290, 24, 21, 0),
  chorizo: food('Chorizo', 330, 15, 29, 2), fries: food('Papas fritas', 312, 3.4, 15, 41), milanesa: food('Milanesa de carne al horno', 230, 22, 9, 15),
  burger: food('Hamburguesa con pan', 260, 13, 12, 25), icecream: food('Helado de dulce de leche', 220, 4, 10, 29), alfajor: food('Alfajor de chocolate', 450, 6, 21, 60),
  facturas: food('Medialunas', 410, 7, 21, 48), soda: food('Gaseosa común', 42, 0, 0, 10.6), salad: food('Ensalada mixta', 20, 1, .2, 4),
};
const recipe = (name, items) => ({ name, items });
const menus = {
  breakfast: [
    recipe('Avena con yogur griego y frutos rojos', [['oats', 50], ['yogurt', 200], ['berries', 100]]),
    recipe('Tostadas con huevos revueltos y naranja', [['bread', 70], ['egg', 100], ['whites', 100], ['orange', 180]]),
    recipe('Yogur griego con avena, banana y maní', [['yogurt', 250], ['oats', 35], ['banana', 100], ['peanut', 10]]),
    recipe('Tostadas con ricota, pavo y café con leche', [['bread', 70], ['ricotta', 80], ['turkey', 60], ['milk', 200]]),
    recipe('Omelette de claras con avena y fruta', [['whites', 200], ['egg', 50], ['oats', 40], ['apple', 150]]),
  ],
  lunch: [
    recipe('Pollo con arroz y ensalada', [['chicken', 170], ['rice', 200], ['tomato', 150], ['lettuce', 60], ['oil', 8]]),
    recipe('Bowl de quinoa, atún y verduras', [['tuna', 140], ['quinoa', 200], ['vegetables', 200], ['oil', 8]]),
    recipe('Carne magra con batata y ensalada', [['beef', 170], ['sweetpotato', 250], ['salad', 150], ['oil', 6]]),
    recipe('Fideos con pollo y tomate', [['pasta', 220], ['chicken', 140], ['tomato', 150], ['oil', 6]]),
    recipe('Wrap de pavo, queso y verduras', [['wrap', 80], ['turkey', 120], ['cheese', 40], ['vegetables', 150]]),
    recipe('Lentejas con arroz y huevo', [['lentils', 220], ['rice', 120], ['egg', 100], ['vegetables', 100], ['oil', 6]]),
  ],
  snack: [
    recipe('Yogur griego con frutos rojos', [['yogurt', 250], ['berries', 100]]),
    recipe('Tostada con queso y manzana', [['bread', 50], ['cheese', 40], ['apple', 150]]),
    recipe('Licuado de leche, banana y avena', [['milk', 300], ['banana', 100], ['oats', 30]]),
    recipe('Yogur, almendras y banana', [['yogurt', 200], ['almonds', 15], ['banana', 100]]),
  ],
  dinner: [
    recipe('Merluza con papas y verduras', [['fish', 200], ['potato', 220], ['vegetables', 200], ['oil', 8]]),
    recipe('Salteado de pollo con arroz', [['chicken', 170], ['rice', 160], ['vegetables', 200], ['oil', 8]]),
    recipe('Tortilla de claras y huevo con ensalada', [['whites', 200], ['egg', 100], ['potato', 150], ['salad', 150], ['oil', 6]]),
    recipe('Carne magra con puré y ensalada', [['beef', 160], ['potato', 220], ['salad', 150], ['oil', 6]]),
    recipe('Fideos con atún y tomate', [['pasta', 200], ['tuna', 120], ['tomato', 150], ['oil', 8]]),
  ],
  treatLunch: [
    recipe('Asado con amigos', [['asado', 250], ['chorizo', 90], ['bread', 80], ['salad', 150]]),
    recipe('Milanesa con papas fritas', [['milanesa', 220], ['fries', 200], ['salad', 100]]),
    recipe('Hamburguesa con papas', [['burger', 250], ['fries', 150], ['soda', 350]]),
  ],
  treatDinner: [
    recipe('Pizza con amigos', [['pizza', 450], ['soda', 400]]),
    recipe('Empanadas y helado', [['empanada', 300], ['icecream', 150]]),
    recipe('Cumpleaños: asado y postre', [['asado', 280], ['chorizo', 90], ['bread', 100], ['icecream', 120]]),
  ],
  treatSnack: [
    recipe('Medialunas con café con leche', [['facturas', 120], ['milk', 200]]),
    recipe('Alfajor y café', [['alfajor', 55], ['milk', 150]]),
  ],
};
// Cómo come cada día según la semana: multiplicadores sobre el objetivo actual.
function dayPlan(day, week) {
  const index = weekday(day); const weekend = index >= 5; const k = noise(`kcal:${day}`, 1);
  if (week.kind === 'floja') {
    if ([2, 3, 4].includes(index)) return null; // viaje: días sin registrar
    return { kcal: 1.18 + k * .06, protein: .72 + k * .05, treat: index >= 5 ? 'full' : 'snack' };
  }
  if (day === '2026-11-07') return { kcal: 1.34, protein: .82, treat: 'full', birthday: true };
  if (weekend) return { kcal: (index === 5 ? 1.27 : 1.12) + k * .04, protein: .82 + k * .04, treat: index === 5 ? 'full' : 'snack' };
  const best = week.kind === 'mejor' || week.kind === 'actual';
  return { kcal: 1 + k * (best ? .03 : .05), protein: (best ? 1.02 : .95) + k * .04, treat: null };
}
const pick = (list, key) => list[parseInt(hash(key).slice(0, 6), 16) % list.length];

// Ajusta porciones para acercar calorías y proteínas al día buscado (2 ecuaciones, 2 factores).
function fitDay(meals, kcalGoal, proteinGoal) {
  const sum = (dense, key) => meals.flatMap(meal => meal.items).filter(item => foods[item.key].dense === dense).reduce((acc, item) => acc + foods[item.key].nutrients[key] * item.grams / 100, 0);
  const [dk, dp, ok, op] = [sum(true, 'calories'), sum(true, 'protein'), sum(false, 'calories'), sum(false, 'protein')];
  const det = dk * op - ok * dp;
  let a = det ? (kcalGoal * op - ok * proteinGoal) / det : 1; let b = det ? (dk * proteinGoal - kcalGoal * dp) / det : 1;
  if (!(a > 0) || !(b > 0)) { a = b = kcalGoal / (dk + ok); }
  a = Math.min(2.4, Math.max(.5, a)); b = Math.min(2.4, Math.max(.5, b));
  return meals.map(meal => ({ ...meal, items: meal.items.map(item => {
    const grams = item.grams * (foods[item.key].dense ? a : b);
    return { ...item, grams: item.key === 'egg' ? Math.max(50, Math.round(grams / 50) * 50) : Math.max(5, Math.round(grams / 5) * 5) };
  }) }));
}

export function storyTargets(profile) {
  if (!profile?.onboardingCompleted || !Number.isFinite(profile.initialWeightKg)) throw new Error('El perfil necesita onboarding completo y peso inicial.');
  const reference = calculateTargets({ ...profile, goal: 'recomposition' });
  const { calories, protein, fat, carbohydrates } = reference;
  return { goal: 'recomposition', reference, targets: { calories, protein, fat, carbohydrates } };
}

export function buildStoryMeals({ targets, from, to, zone, createdAt }) {
  const meals = [];
  for (let day = from; day <= to; day = shiftDate(day, 1)) {
    const week = storyWeeks[mondayOf(day)]; const plan = dayPlan(day, week);
    if (!plan) continue;
    const slot = (type, pool) => ({ mealType: type, recipe: pick(menus[pool], `${day}:${type}`) });
    let dayMeals = [slot('breakfast', 'breakfast'),
      slot('lunch', plan.treat === 'full' && !plan.birthday ? 'treatLunch' : 'lunch'),
      slot('snack', plan.treat ? 'treatSnack' : 'snack'),
      slot('dinner', plan.treat === 'full' ? 'treatDinner' : 'dinner')];
    if (plan.birthday) dayMeals[3] = { mealType: 'dinner', recipe: menus.treatDinner[2] };
    // Algunos días normales sin merienda, para que no todo sea perfecto.
    if (!plan.treat && noise(`snack:${day}`, 1) > .55) dayMeals = dayMeals.filter(item => item.mealType !== 'snack');
    const draft = dayMeals.map(({ mealType, recipe: chosen }) => ({ mealType, name: chosen.name, items: chosen.items.map(([key, grams]) => ({ key, grams })) }));
    const fitted = fitDay(draft, targets.calories * plan.kcal, targets.protein * plan.protein);
    for (const meal of fitted) {
      const mealId = `demo2-${day}-${meal.mealType}`;
      const input = mealInput({ mealId, localDate: day, timeZone: zone, mealType: meal.mealType, note: meal.name,
        items: meal.items.map((item, i) => ({ itemId: `demo2-item-${i}`, source: 'manual', name: foods[item.key].name, grams: item.grams, basis: 'per100g', nutrients: foods[item.key].nutrients })) });
      const items = input.items.map(item => ({ ...item, estimated: false, totals: scale(item.nutrients, item.grams / 100) }));
      const at = { breakfast: '11:00', lunch: '16:00', snack: '20:00', dinner: '00:30' }[meal.mealType];
      const stamp = meal.mealType === 'dinner' ? `${shiftDate(day, 1)}T${at}:00.000Z` : `${day}T${at}:00.000Z`;
      meals.push({ ...input, items, totals: total(items), fingerprint: hash(JSON.stringify({ ...input, items })), version: 1, archived: false,
        createdAt: stamp, updatedAt: stamp, demoData: { simulated: true, purpose: 'presentation', story: storyVersion, nutritionValues: 'illustrative-estimates' } });
    }
  }
  return meals;
}

// Peso: leve tendencia a la baja (recomposición), rebote tras el viaje y los asados.
export function buildStoryWeights({ initialWeightKg, from, to, zone, createdAt }) {
  const weights = []; const start = initialWeightKg + .3;
  for (let day = from, offset = 0; day <= to; day = shiftDate(day, 1), offset++) {
    const week = storyWeeks[mondayOf(day)]; const index = weekday(day);
    const measured = week.kind === 'floja' ? [0, 6].includes(index) : [0, 2, 4, 6].includes(index) || (week.kind === 'actual' && index === 1);
    if (!measured) continue;
    const trend = -0.022 * offset; // ~ -0,15 kg por semana
    const bump = week.kind === 'floja' ? .45 : week.kind === 'regreso' ? .25 : 0;
    const weekendBump = index === 6 || index === 0 ? .2 : 0;
    const weightKg = Math.round((start + trend + bump + weekendBump + noise(`w:${day}`, .18)) * 10) / 10;
    // Mismo formato que validateWeight, pero admite fechas hasta el 11/11 (aparecen al llegar el día).
    const measurement = { localDate: day, timeZone: zone, weightKg, note: '' };
    weights.push({ ...measurement, id: day, source: 'manual', archived: false, dateInferred: false, version: 1, recordedAt: `${day}T11:00:00.000Z`,
      createdAt, updatedAt: createdAt, demoData: { simulated: true, purpose: 'presentation', story: storyVersion } });
  }
  return weights;
}

export function buildDemoStory({ profile, routine, from, to, zone, createdAt = new Date().toISOString() }) {
  date(from); date(to); timeZone(zone);
  if (from > to || !storyWeeks[mondayOf(from)] || !storyWeeks[mondayOf(to)]) throw new Error('La historia cubre del 2026-10-01 al 2026-11-11.');
  const plan = storyTargets(profile);
  return { ...plan, sessions: buildStoryTraining({ routine, from, to, zone, createdAt }), meals: buildStoryMeals({ targets: plan.targets, from, to, zone, createdAt }),
    weights: buildStoryWeights({ initialWeightKg: profile.initialWeightKg, from, to, zone, createdAt }) };
}
