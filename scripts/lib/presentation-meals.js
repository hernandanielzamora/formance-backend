import { createHash } from 'node:crypto';
import { mealInput, scale, total } from '../../src/services/food.js';

// Approximate illustrative values per 100 g, not a USDA response or a meal plan.
const food = (name, calories, protein, fat, carbohydrates) => ({ name, nutrients: { calories, protein, fat, carbohydrates } });
const foods = {
  oats: food('Avena arrollada seca', 389, 16.9, 6.9, 66.3), milk: food('Leche parcialmente descremada', 50, 3.4, 1.8, 4.9),
  bread: food('Pan integral', 247, 13, 4.2, 41), egg: food('Huevo cocido', 155, 13, 11, 1.1),
  chicken: food('Pechuga de pollo cocida, sin piel', 165, 31, 3.6, 0), rice: food('Arroz blanco cocido', 130, 2.7, .3, 28),
  lentils: food('Lentejas cocidas', 116, 9, .4, 20), potato: food('Papa hervida', 87, 1.9, .1, 20),
  yogurt: food('Yogur natural alto en proteínas', 73, 9, 2, 4), banana: food('Banana, parte comestible', 89, 1.1, .3, 22.8),
  apple: food('Manzana con piel', 52, .3, .2, 14), oil: food('Aceite de oliva', 884, 0, 100, 0),
  pasta: food('Fideos cocidos', 158, 5.8, .9, 31), beef: food('Carne vacuna magra cocida', 200, 28, 9, 0),
  tuna: food('Atún al natural escurrido', 116, 26, 1, 0), carrot: food('Zanahoria', 41, .9, .2, 9.6),
  tomato: food('Tomate', 18, .9, .2, 3.9), lettuce: food('Lechuga', 15, 1.4, .2, 2.9),
  cheese: food('Queso semimagro', 254, 24, 16, 3), almonds: food('Almendras', 579, 21, 50, 22),
  chickpeas: food('Garbanzos cocidos', 164, 8.9, 2.6, 27.4), orange: food('Naranja, parte comestible', 47, .9, .1, 11.8),
  peanut: food('Pasta de maní sin azúcar', 588, 25, 50, 20), fish: food('Filet de pescado blanco cocido', 110, 23, 1.5, 0),
  quinoa: food('Quinoa cocida', 120, 4.4, 1.9, 21), vegetables: food('Verduras cocidas mixtas', 35, 2, .3, 7),
};
const recipe = (name, items) => ({ name, items });
const menus = {
  breakfast: [
    recipe('Tostadas integrales con huevo y naranja', [['bread', 70], ['egg', 100], ['orange', 180], ['milk', 200]]),
    recipe('Avena con yogur, banana y pasta de maní', [['oats', 60], ['yogurt', 200], ['banana', 120], ['peanut', 15]]),
    recipe('Yogur con avena, almendras y manzana', [['yogurt', 250], ['oats', 40], ['almonds', 20], ['apple', 150]]),
    recipe('Tostadas con queso, huevo y banana', [['bread', 80], ['cheese', 40], ['egg', 50], ['banana', 100]]),
    recipe('Avena con leche, manzana y pasta de maní', [['oats', 50], ['milk', 250], ['apple', 150], ['peanut', 20]]),
    recipe('Huevos revueltos con tostadas y fruta', [['egg', 100], ['bread', 90], ['banana', 120], ['milk', 200]]),
    recipe('Tostadas con pasta de maní y café con leche', [['bread', 80], ['peanut', 25], ['orange', 180], ['milk', 200]]),
  ],
  lunch: [
    recipe('Pollo con arroz y ensalada', [['chicken', 180], ['rice', 220], ['tomato', 150], ['lettuce', 60], ['oil', 10]]),
    recipe('Fideos con carne y tomate', [['pasta', 240], ['beef', 140], ['tomato', 150], ['oil', 8]]),
    recipe('Ensalada tibia de lentejas, arroz y huevo', [['lentils', 240], ['rice', 120], ['egg', 50], ['carrot', 100], ['oil', 10]]),
    recipe('Ensalada de papa y atún', [['tuna', 150], ['potato', 300], ['tomato', 180], ['oil', 12]]),
    recipe('Pollo con quinoa y verduras', [['chicken', 160], ['quinoa', 200], ['vegetables', 200], ['oil', 10]]),
    recipe('Carne con papas y zanahoria', [['beef', 170], ['potato', 250], ['carrot', 100], ['oil', 8]]),
    recipe('Garbanzos con arroz, huevo y tomate', [['chickpeas', 250], ['rice', 100], ['egg', 100], ['tomato', 100], ['oil', 8]]),
  ],
  snack: [
    recipe('Yogur, banana y almendras', [['yogurt', 200], ['banana', 110], ['almonds', 20]]),
    recipe('Sándwich de queso y manzana', [['bread', 60], ['cheese', 35], ['apple', 150]]),
    recipe('Leche con avena y pasta de maní', [['milk', 250], ['oats', 35], ['peanut', 15]]),
    recipe('Yogur con avena y naranja', [['yogurt', 200], ['oats', 40], ['orange', 180]]),
    recipe('Tostadas con huevo y café con leche', [['bread', 70], ['egg', 50], ['milk', 180]]),
    recipe('Yogur, manzana y almendras', [['yogurt', 250], ['apple', 150], ['almonds', 15]]),
    recipe('Tostadas con pasta de maní y banana', [['bread', 60], ['peanut', 25], ['banana', 100]]),
  ],
  dinner: [
    recipe('Lentejas con huevo y papa', [['lentils', 220], ['egg', 100], ['potato', 180], ['oil', 5]]),
    recipe('Pescado con papa y zanahoria', [['fish', 180], ['potato', 280], ['carrot', 120], ['oil', 12]]),
    recipe('Salteado de pollo con arroz y verduras', [['chicken', 160], ['rice', 160], ['vegetables', 200], ['oil', 10]]),
    recipe('Omelette de queso con tostadas y tomate', [['egg', 150], ['cheese', 30], ['bread', 70], ['tomato', 150], ['oil', 5]]),
    recipe('Carne con fideos y tomate', [['beef', 150], ['pasta', 180], ['tomato', 160], ['oil', 8]]),
    recipe('Ensalada de garbanzos y atún con pan', [['chickpeas', 200], ['tuna', 100], ['lettuce', 80], ['tomato', 150], ['bread', 50], ['oil', 10]]),
    recipe('Pollo con papa y verduras', [['chicken', 150], ['potato', 240], ['vegetables', 200], ['oil', 10]]),
  ],
};
export function presentationMeal(before, offset, seedId, updatedAt) {
  const menu = menus[before.mealType];
  if (!menu) throw new Error('Momento del día desconocido.');
  const week = Math.floor(offset / 7);
  const typeIndex = Object.keys(menus).indexOf(before.mealType);
  const selected = menu[(offset + week * 2 + typeIndex) % menu.length];
  const input = mealInput({ mealId: before.id, localDate: before.localDate, timeZone: before.timeZone, mealType: before.mealType, note: selected.name,
    items: selected.items.map(([key, portion], index) => {
      // Independent, modest portion variation; eggs remain whole 50 g units.
      const step = portion <= 25 ? 2 : 10;
      const grams = key === 'egg' ? portion : Math.max(step, portion + (((offset * 3 + index + typeIndex) % 3) - 1) * step);
      return { itemId: `meal-item-${index}`, source: 'manual', ...foods[key], grams, basis: 'per100g' };
    }) });
  const items = input.items.map(item => ({ ...item, estimated: false, totals: scale(item.nutrients, item.grams / 100) }));
  return { ...before, ...input, items, totals: total(items), fingerprint: createHash('sha256').update(JSON.stringify({ ...input, items })).digest('hex'),
    version: before.version + 1, updatedAt, demoData: { ...before.demoData, seedId, simulated: true, presentationRevision: 2, nutritionValues: 'illustrative-estimates' } };
}

export function planPresentationRefinement({ manifest, meals, updatedAt = new Date().toISOString() }) {
  if (!manifest?.simulated || !manifest.seedId) throw new Error('Falta un manifiesto de datos simulados válido.');
  if (manifest.foodPresentationRefinement?.version === 2) return { alreadyApplied: true, changes: [], skipped: [] };
  const changes = []; const skipped = [];
  const kind = 'foodLogs';
  for (const before of meals) {
    if (before.demoData?.seedId !== manifest.seedId) continue;
    if (before.archived || before.version !== 1 || before.updatedAt !== manifest.createdAt) { skipped.push(`${kind}/${before.id}`); continue; }
    const offset = Math.round((new Date(before.localDate) - new Date(manifest.from)) / 86400000);
    if (offset < 0 || before.localDate > manifest.to) throw new Error('Registro fuera del período.');
    const value = presentationMeal(before, offset, manifest.seedId, updatedAt);
    changes.push({ kind, id: before.id, before, value });
  }
  return { alreadyApplied: false, changes, skipped };
}
