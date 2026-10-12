export function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
function object(body, keys) { if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !keys.includes(key))) invalid('Campos inválidos.'); }
function text(value, max = 80) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(`Ingresá un texto de hasta ${max} caracteres.`); return value.trim(); }
export function validateVersion(body) { if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) invalid('Falta la versión del contenido.'); }
export function validateExercise(body, update = false) {
  object(body, ['name','muscle','equipment','instructions', ...(update ? ['expectedVersion'] : [])]);
  if (update) validateVersion(body);
  return { name: text(body.name), muscle: text(body.muscle), equipment: text(body.equipment), instructions: text(body.instructions, 1500), tracking: 'reps_weight' };
}
export function validateWorkout(body, availableExercises, update = false) {
  object(body, ['name','focus','exercises', ...(update ? ['expectedVersion'] : [])]);
  if (update) validateVersion(body);
  if (!Array.isArray(body.exercises) || body.exercises.length < 1 || body.exercises.length > 20) invalid('Elegí entre 1 y 20 ejercicios.');
  return { name: text(body.name), focus: text(body.focus), exercises: body.exercises.map((entry, index) => {
    object(entry, ['exerciseId','sets','repsMin','repsMax','restSeconds']);
    const exercise = availableExercises.find((item) => item.id === entry.exerciseId);
    if (!exercise) invalid('Un ejercicio no está disponible para tu cuenta.');
    for (const [key,min,max] of [['sets',1,10],['repsMin',1,100],['repsMax',1,100],['restSeconds',0,600]]) if (!Number.isInteger(entry[key]) || entry[key] < min || entry[key] > max) invalid('Revisá series, repeticiones y descanso.');
    if (entry.repsMin > entry.repsMax) invalid('El rango de repeticiones no es válido.');
    return { ...entry, entryId: `entry-${index}`, order: index, exerciseSnapshot: { id: exercise.id, name: exercise.name, muscle: exercise.muscle, equipment: exercise.equipment, tracking: exercise.tracking, version: exercise.version } };
  }) };
}
export function validateRoutine(body, availableWorkouts, availableExercises, update = false) {
  object(body, ['name','days','sourceTemplateId','goals','description','rationale','level', ...(update ? ['expectedVersion'] : [])]);
  if (update) validateVersion(body);
  if (body.sourceTemplateId != null && (typeof body.sourceTemplateId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.sourceTemplateId))) invalid('Referencia de plantilla inválida.');
  if (body.goals !== undefined && (!Array.isArray(body.goals) || body.goals.length > 4 || body.goals.some((g) => !['maintain','muscle','recomposition','fat_loss'].includes(g)))) invalid('Objetivos inválidos.');
  if (!Array.isArray(body.days) || body.days.length !== 7) invalid('La rutina debe incluir los siete días.');
  let count = 0;
  const days = body.days.map((day,index) => {
    object(day, ['dayIndex','workoutIds']);
    if (day.dayIndex !== index || !Array.isArray(day.workoutIds) || day.workoutIds.length > 3) invalid('Revisá la distribución semanal.');
    const assignments = day.workoutIds.map((id,slot) => {
      const workout = availableWorkouts.find((w) => w.id === id);
      if (!workout) invalid('Un workout no está disponible para tu cuenta.');
      count++;
      return { assignmentId: `day-${index}-slot-${slot}`, workoutId:id, workoutVersion:workout.version, name:workout.name, exercises:workout.exercises.map((entry,i) => {
        const exercise = entry.exerciseSnapshot || availableExercises.find((e) => e.id === entry.exerciseId);
        if (!exercise) invalid('Falta la referencia histórica de un ejercicio.');
        return { ...entry, entryId:`entry-${i}`, order:i, exerciseVersion:exercise.version, exerciseName:exercise.name, muscle:exercise.muscle, equipment:exercise.equipment, tracking:exercise.tracking };
      }) };
    });
    return { dayIndex:index, workoutIds:[...day.workoutIds], assignments };
  });
  if (!count) invalid('Asigná al menos un workout a un día.');
  return { name:text(body.name), days, sourceTemplateId:body.sourceTemplateId || null, ...(body.goals !== undefined ? {goals:[...new Set(body.goals)]} : {}), ...Object.fromEntries(['description','rationale','level'].filter(key=>body[key]!==undefined).map(key=>[key,text(body[key],key==='level'?80:1500)])) };
}
export function isAdmin(identity) { return identity.admin === true && identity.email_verified === true; }
export function canManage(identity, item) { return isAdmin(identity) || item.ownerId === identity.uid; }
export function canRead(identity, item) { return isAdmin(identity) || item.visibility === 'public' || item.ownerId === identity.uid; }
export function present(identity,item) { return { ...item, permissions:{ canEdit:canManage(identity,item), canDelete:canManage(identity,item) } }; }
