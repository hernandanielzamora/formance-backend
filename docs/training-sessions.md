# Calendario y registro de series

La ruta web `/app/entrenamiento/calendario` presenta semanas de lunes a domingo
según la zona horaria del navegador. Muestra la distribución **actual** de la rutina
activa, descansos y registros del día. No representa adherencia histórica: aún no
se guardan snapshots semanales de lo que estaba planificado.

## API implementada

Todas las rutas requieren ID token y correo verificado. Las sesiones pertenecen
exclusivamente al UID del token, incluso para un administrador.

- `GET /api/training/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&timeZone=UTC`:
  rutina activa, sesiones propias por su fecha local registrada y fecha actual en la zona solicitada. Viajar no oculta registros de otras zonas. Hasta 31
  días y 200 sesiones; si hay más, pide reducir el intervalo, sin truncar registros.
- `POST /api/training/sessions`: `sessionId`, `routineId`, `routineVersion`,
  `assignmentId`, `localDate`, `timeZone`. El servidor verifica rutina activa y día
  asignado, rechaza fechas futuras y construye el snapshot desde la rutina.
  `sessionId` generado por cliente permite reintentos idempotentes.
- `GET /api/training/sessions/:id`: recuperar una sesión propia.
- `PUT /api/training/sessions/:id`: `expectedVersion`, `status`, `note`,
  `performedEntries`. Actualiza en transacción, con conflicto 409 si hay otra
  versión guardada. Sesiones cerradas son de solo lectura.

Persistencia: `users/{uid}/trainingSessions/{sessionId}`. El snapshot registra
rutina/workout/versiones, ejercicio y prescripción originales; editar o archivar
la biblioteca no altera las sesiones. `startedAt` es la creación del registro,
no una medición de duración cuando se carga un entrenamiento pasado.

Cada serie registra `setId`, `order`, `reps`, `externalLoadKg`, `completed`.
Repeticiones enteras de 1 a 1000; carga externa de 0 a 1000 kg o null; hasta 30
series por ejercicio. Una serie realizada requiere repeticiones. **0 kg y null
son distintos**. No se deduce carga externa a partir del peso corporal.

La UI permite guardar parcialmente, retomar, agregar series, finalizar con al
menos una serie realizada o interrumpir conservando los registros. El guardado
es explícito; muestra cambios pendientes y pide confirmación al salir mediante
enlaces o recargar. Los logs están listos como fuente de reportes posteriores;
todavía no hay agregación semanal/mensual ni métricas de adherencia.
