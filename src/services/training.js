import { exercises, workouts, routineTemplates } from "../data/training.js";

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}
function object(body, keys) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !keys.includes(key))
  )
    invalid("Campos inválidos.");
}
function title(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    invalid("Ingresá un nombre de hasta 80 caracteres.");
  return value.trim();
}
export function validateWorkout(body) {
  object(body, ["name", "focus", "exercises"]);
  const name = title(body.name);
  if (
    typeof body.focus !== "string" ||
    !body.focus.trim() ||
    body.focus.length > 80
  )
    invalid("Ingresá un enfoque para el workout.");
  if (
    !Array.isArray(body.exercises) ||
    body.exercises.length < 1 ||
    body.exercises.length > 20
  )
    invalid("Elegí entre 1 y 20 ejercicios.");
  const entries = body.exercises.map((entry, index) => {
    object(entry, ["exerciseId", "sets", "repsMin", "repsMax", "restSeconds"]);
    if (!exercises.some((exercise) => exercise.id === entry.exerciseId))
      invalid("Ejercicio inexistente.");
    for (const [key, min, max] of [
      ["sets", 1, 10],
      ["repsMin", 1, 100],
      ["repsMax", 1, 100],
      ["restSeconds", 0, 600],
    ]) {
      if (!Number.isInteger(entry[key]) || entry[key] < min || entry[key] > max)
        invalid("Revisá series, repeticiones y descanso.");
    }
    if (entry.repsMin > entry.repsMax)
      invalid("El rango de repeticiones no es válido.");
    return { ...entry, entryId: `entry-${index}`, order: index };
  });
  return { name, focus: body.focus.trim(), exercises: entries };
}

export function validateRoutine(body, availableWorkouts, update = false) {
  object(body, [
    "name",
    "days",
    "sourceTemplateId",
    ...(update ? ["expectedVersion"] : []),
  ]);
  const name = title(body.name);
  if (
    update &&
    (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1)
  )
    invalid("Falta la versión de la rutina.");
  if (
    body.sourceTemplateId != null &&
    !routineTemplates.some((item) => item.id === body.sourceTemplateId)
  )
    invalid("Plantilla inexistente.");
  if (!Array.isArray(body.days) || body.days.length !== 7)
    invalid("La rutina debe incluir los siete días.");
  let count = 0;
  const days = body.days.map((day, index) => {
    object(day, ["dayIndex", "workoutIds"]);
    if (
      day.dayIndex !== index ||
      !Array.isArray(day.workoutIds) ||
      day.workoutIds.length > 3
    )
      invalid("Revisá la distribución semanal.");
    const assignments = day.workoutIds.map((id, slot) => {
      const workout = availableWorkouts.find((item) => item.id === id);
      if (!workout) invalid("Un workout no está disponible para tu cuenta.");
      count++;
      return {
        assignmentId: `day-${index}-slot-${slot}`,
        workoutId: workout.id,
        workoutVersion: workout.version,
        name: workout.name,
        exercises: workout.exercises.map((entry, entryIndex) => {
          const exercise = exercises.find(
            (item) => item.id === entry.exerciseId,
          );
          return {
            ...entry,
            entryId: `entry-${entryIndex}`,
            order: entryIndex,
            exerciseVersion: exercise.version,
            exerciseName: exercise.name,
            muscle: exercise.muscle,
            equipment: exercise.equipment,
            tracking: exercise.tracking,
          };
        }),
      };
    });
    return { dayIndex: index, workoutIds: [...day.workoutIds], assignments };
  });
  if (!count) invalid("Asigná al menos un workout a un día.");
  return { name, days, sourceTemplateId: body.sourceTemplateId || null };
}

export function catalogForGoal(goal, personalWorkouts = []) {
  return {
    exercises,
    workouts: [...workouts, ...personalWorkouts],
    userGoal: goal || null,
    routineTemplates: routineTemplates
      .map((template) => ({
        ...template,
        recommended: template.goals.includes(goal),
      }))
      .sort((a, b) => Number(b.recommended) - Number(a.recommended)),
  };
}
