// Catálogo inicial versionado. Los IDs se conservan aunque cambie el texto.
const exercise = (id, name, muscle, equipment, instructions) => ({ id, name, muscle, equipment, instructions, tracking: 'reps_weight', version: 1 });
export const exercises = [
  exercise('squat', 'Sentadilla con barra', 'Piernas', 'Barra', 'Mantené el tronco estable y realizá un recorrido que puedas controlar.'),
  exercise('goblet-squat', 'Sentadilla goblet', 'Piernas', 'Mancuerna', 'Sostené la mancuerna cerca del pecho y mantené el apoyo de los pies.'),
  exercise('leg-press', 'Prensa de piernas', 'Piernas', 'Máquina', 'Controlá el descenso y evitá bloquear las rodillas.'),
  exercise('rdl', 'Peso muerto rumano', 'Piernas', 'Barra', 'Llevá la cadera hacia atrás con la carga cerca del cuerpo.'),
  exercise('lunges', 'Zancadas', 'Piernas', 'Mancuernas', 'Elegí una distancia de paso que te permita mantener el equilibrio.'),
  exercise('leg-curl', 'Curl femoral', 'Piernas', 'Máquina', 'Ajustá la máquina y controlá la flexión sin mover la cadera.'),
  exercise('calf-raise', 'Elevación de gemelos', 'Piernas', 'Máquina', 'Elevá los talones y descendé de forma controlada.'),
  exercise('bench-press', 'Press de banca', 'Pecho', 'Barra', 'Mantené los apoyos estables y controlá la carga durante todo el recorrido.'),
  exercise('db-press', 'Press con mancuernas', 'Pecho', 'Mancuernas', 'Usá un recorrido cómodo y mantené controladas ambas mancuernas.'),
  exercise('push-up', 'Flexiones', 'Pecho', 'Peso corporal', 'Mantené el cuerpo alineado. Podés adaptar el apoyo a tu nivel.'),
  exercise('lat-pulldown', 'Jalón al pecho', 'Espalda', 'Polea', 'Acercá el agarre al pecho sin balancear el tronco.'),
  exercise('seated-row', 'Remo sentado', 'Espalda', 'Polea', 'Llevá los codos hacia atrás sin compensar con el tronco.'),
  exercise('db-row', 'Remo con mancuerna', 'Espalda', 'Mancuerna', 'Apoyate de manera estable y acercá la mancuerna hacia la cadera.'),
  exercise('shoulder-press', 'Press de hombros', 'Hombros', 'Mancuernas', 'Empujá hacia arriba con el tronco estable y un recorrido cómodo.'),
  exercise('lateral-raise', 'Elevaciones laterales', 'Hombros', 'Mancuernas', 'Elevá los brazos de manera controlada, sin impulso.'),
  exercise('biceps-curl', 'Curl de bíceps', 'Brazos', 'Mancuernas', 'Flexioná los codos sin balancear el cuerpo.'),
  exercise('triceps-pushdown', 'Extensión de tríceps', 'Brazos', 'Polea', 'Mantené los codos cerca del cuerpo y controlá el retorno.'),
  exercise('dead-bug', 'Dead bug', 'Core', 'Peso corporal', 'Alterná brazo y pierna manteniendo estable la zona lumbar.'),
];
const block = (exerciseId, sets = 3, repsMin = 8, repsMax = 12, restSeconds = 90) => ({ exerciseId, sets, repsMin, repsMax, restSeconds });
export const workouts = [
  { id: 'full-body-a', name: 'Full body A', focus: 'Cuerpo completo', exercises: [block('goblet-squat'), block('db-press'), block('seated-row'), block('dead-bug', 2)] },
  { id: 'full-body-b', name: 'Full body B', focus: 'Cuerpo completo', exercises: [block('rdl'), block('lat-pulldown'), block('shoulder-press'), block('lunges', 2)] },
  { id: 'upper-a', name: 'Tren superior A', focus: 'Tren superior', exercises: [block('bench-press'), block('seated-row'), block('lateral-raise', 3, 10, 15, 60), block('biceps-curl', 2), block('triceps-pushdown', 2)] },
  { id: 'upper-b', name: 'Tren superior B', focus: 'Tren superior', exercises: [block('lat-pulldown'), block('db-press'), block('shoulder-press'), block('db-row'), block('biceps-curl', 2)] },
  { id: 'lower-a', name: 'Tren inferior A', focus: 'Tren inferior', exercises: [block('squat'), block('rdl'), block('leg-curl'), block('calf-raise', 3, 10, 15)] },
  { id: 'lower-b', name: 'Tren inferior B', focus: 'Tren inferior', exercises: [block('leg-press'), block('lunges'), block('leg-curl'), block('dead-bug', 2)] },
].map((item) => ({ ...item, version: 1, source: 'catalog' }));
const week = (assignments) => Array.from({ length: 7 }, (_, dayIndex) => ({ dayIndex, workoutIds: assignments[dayIndex] || [] }));
export const routineTemplates = [
  { id: 'foundation-2', name: 'Base · 2 días', level: 'Inicial', description: 'Dos sesiones de cuerpo completo para una agenda con pocos días disponibles.', goals: ['maintain'], rationale: 'Prioriza una distribución simple y pocos días de entrenamiento. Es una base flexible para sostener la constancia.', days: week({ 1: ['full-body-a'], 4: ['full-body-b'] }) },
  { id: 'full-body-3', name: 'Cuerpo completo · 3 días', level: 'Inicial / intermedio', description: 'Alterna dos workouts de cuerpo completo en tres días de la semana.', goals: ['recomposition', 'fat_loss'], rationale: 'Organiza sesiones de fuerza de cuerpo completo en tres días. La etiqueta indica el enfoque de la plantilla; la definición o recomposición también dependen de alimentación y progreso.', days: week({ 0: ['full-body-a'], 2: ['full-body-b'], 4: ['full-body-a'] }) },
  { id: 'upper-lower-4', name: 'Superior / inferior · 4 días', level: 'Intermedio', description: 'Distribuye el trabajo de tren superior e inferior en cuatro sesiones.', goals: ['muscle', 'recomposition'], rationale: 'Separa grupos de ejercicios por sesión y requiere cuatro días disponibles. Puede resultar cómoda si preferís concentrar cada workout en una zona.', days: week({ 0: ['upper-a'], 1: ['lower-a'], 3: ['upper-b'], 4: ['lower-b'] }) },
  { id: 'flexible-3', name: 'Fuerza flexible · 3 días', level: 'Intermedio', description: 'Combina tren superior, tren inferior y una sesión de cuerpo completo.', goals: ['muscle', 'maintain'], rationale: 'Combina sesiones por zona con una sesión general. Permite distribuir el entrenamiento en tres días sin una división de cuatro sesiones.', days: week({ 0: ['upper-a'], 2: ['lower-a'], 5: ['full-body-b'] }) },
].map((item) => ({ ...item, version: 1 }));
