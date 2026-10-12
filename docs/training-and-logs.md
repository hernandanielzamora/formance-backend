# Entrenamiento y contrato para futuros logs

## Biblioteca

Ejercicio → entrada de workout → asignación a un día → rutina semanal.
18 ejercicios, 6 workouts y 4 plantillas se cargaron en Firestore.
La API lee exclusivamente las colecciones de Firebase; `scripts/fixtures/training.js`
solo es entrada para la migración idempotente, nunca un catálogo de runtime.
Las plantillas son ejemplos orientativos. Se ordenan por objetivo del perfil;
ninguna se restringe. Frecuencia, distribución y disponibilidad explican su enfoque.

Propiedad: el UID siempre procede del token verificado, nunca del formulario.

- `exercises/{id}`, `workouts/{id}`, `routines/{id}`: última versión con ownerId.
- Cada entidad tiene `revisions/{version}` con copias históricas.
- `users/{uid}/settings/training`: ID de rutina activa.

Días `dayIndex: 0..6`, lunes-domingo. `workoutIds` ordenado, hasta tres por día.
Array vacío = descanso. Un ejercicio o workout se puede repetir: `entryId` y
`assignmentId` identifican cada aparición, no únicamente el exerciseId.

La API construye snapshots de nombres, versiones y prescripciones desde el catálogo
confiable. Crear desde plantilla genera una copia independiente. Editar requiere
`expectedVersion`, y la transacción guarda rutina y revisión de forma atómica.
Un cambio en biblioteca no modifica lo planificado en revisiones anteriores.

## Endpoints implementados

- GET `/api/training/catalog`: ejercicios, workouts y plantillas sugeridas.
- POST `/api/training/workouts`: workout propio.
- GET `/api/training/routines`: rutinas propias y rutina activa.
- POST `/api/training/routines`: rutina nueva o copia de plantilla.
- PUT `/api/training/routines/:id`: edición con control de versión.
- PUT `/api/training/active-routine`: activar una rutina de la cuenta.

GET consulta contenido público y propio; admin consulta todas las cuentas.
POST crea ejercicios, workouts y rutinas con propietario tomado del token.
PUT y DELETE exigen propietario o admin y expectedVersion; DELETE archiva.
La UI recibe permissions.canEdit/canDelete; la autorización siempre se repite en API.
El contenido creado por admin entra en la biblioteca compartida; el creado por usuario
es privado. Ningún formulario puede transferir ownerId ni modificar visibilidad.
Las reglas de Firestore deniegan acceso directo de clientes: todas las operaciones
pasan por la API con Firebase Admin. La biblioteca requiere la migración inicial;
no existe fallback al catálogo local. Paginación se añadirá al crecer el volumen.

## Sesiones realizadas: contrato propuesto, aún sin endpoints

Colección: `users/{uid}/trainingSessions/{sessionId}`. ID distinto por sesión,
no por fecha: pueden existir varias sesiones el mismo día.

```json
{
  "schemaVersion": 1,
  "routineId": "uuid-rutina",
  "routineVersion": 2,
  "assignmentId": "day-0-slot-0",
  "workoutId": "full-body-a",
  "workoutVersion": 1,
  "localDate": "2026-10-12",
  "timeZone": "America/Argentina/Buenos_Aires",
  "startedAt": "2026-10-12T18:00:00.000Z",
  "finishedAt": null,
  "status": "in_progress",
  "note": "",
  "workoutSnapshot": {
    "name": "Full body A",
    "entries": [{
      "entryId": "entry-0",
      "exerciseId": "goblet-squat",
      "exerciseVersion": 1,
      "exerciseName": "Sentadilla goblet",
      "tracking": "reps_weight",
      "planned": { "sets": 3, "repsMin": 8, "repsMax": 12, "restSeconds": 90 }
    }]
  },
  "performedEntries": [{
    "entryId": "entry-0",
    "exerciseId": "goblet-squat",
    "sets": [{ "setId": "uuid-serie", "order": 0, "reps": 10, "externalLoadKg": 12, "completed": true }]
  }]
}
```

Al iniciar sesión se copia el workout de la revisión correspondiente, sin reconstruirlo
después desde el catálogo actual. La edición de rutina no reescribe sesiones pasadas.
Carga externa de una serie y peso corporal son dominios distintos. 0 kg es válido;
null significa no registrado. No inventar volumen para ejercicios de peso corporal.

Semanas lunes-domingo y meses calendario calculados por `localDate`/zona horaria,
sin truncar fechas UTC. Reportar sesiones completadas, abandonadas y en curso por
separado. Agregar solo series efectivamente completadas, reps y volumen externo
(reps × carga kg). Conservar variante y unidad para comparar progresión.

La ausencia de logs no prueba que no hubo entrenamiento: mostrar completitud.
Para adherencia histórica, el próximo módulo guardará una copia semanal de las
asignaciones planificadas y la revisión activa. La rutina activa actual no permite
inferir qué estaba planificado en semanas anteriores.
