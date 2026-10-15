import { timeZone } from './training-sessions.js';
export const activityFactors = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725, intense: 1.9 };
const goalFactors = { maintain: 1, muscle: 1.1, recomposition: .9, fat_loss: .85 };
export function validateOnboarding(body, allowTargets = false) {
  const allowed = ['name', 'age', 'sex', 'heightCm', 'initialWeightKg', 'activity', 'goal', 'timeZone', ...(allowTargets ? ['targets'] : [])];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) throw new Error('Datos de perfil inválidos.');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) throw new Error('Ingresá un nombre de hasta 80 caracteres.');
  const ranges = { age: [18, 100], heightCm: [100, 230], initialWeightKg: [30, 250] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < min || body[key] > max) throw new Error('Revisá edad, altura y peso.');
  }
  if (!Number.isInteger(body.age) || !['male', 'female'].includes(body.sex) || !Object.hasOwn(activityFactors, body.activity) || !Object.hasOwn(goalFactors, body.goal)) throw new Error('Revisá sexo, actividad y objetivo.');
  if (body.targets !== undefined) {
    if (!body.targets || typeof body.targets !== 'object' || Array.isArray(body.targets) || Object.keys(body.targets).length !== 4) throw new Error('Objetivos nutricionales inválidos.');
    for (const [key, min, max] of [['calories', 800, 6000], ['protein', 0, 400], ['fat', 0, 300], ['carbohydrates', 0, 1000]]) {
      const value = body.targets[key];
      if (!Number.isInteger(value) || value < min || value > max) throw new Error('Revisá los objetivos nutricionales.');
    }
  }
  return { ...body, name: body.name.trim(), ...(body.timeZone !== undefined ? { timeZone: timeZone(body.timeZone) } : {}) };
}

// Adaptación determinista de los cálculos Harris-Benedict del onboarding de Nutrivo.
export function calculateTargets(profile) {
  const { age, sex, heightCm: height, initialWeightKg: weight, activity, goal } = profile;
  const bmr = sex === 'male' ? 66.47 + 13.75 * weight + 5.003 * height - 6.755 * age : 655.1 + 9.563 * weight + 1.85 * height - 4.676 * age;
  const maintenanceCalories = Math.round(bmr * activityFactors[activity]);
  const calories = Math.round(maintenanceCalories * goalFactors[goal]);
  const protein = Math.round(weight * (goal === 'recomposition' ? 2.2 : 1.8));
  const fat = Math.round(calories * .25 / 9);
  const carbohydrates = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { maintenanceCalories, calories, protein, fat, carbohydrates, formula: 'harris-benedict-nutrivo-v1' };
}
