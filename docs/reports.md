# Reportes semanales e historial (sin IA)

`GET /api/reports/weekly?weekStart=YYYY-MM-DD&timeZone=UTC` requiere token y correo
verificado. El lunes identifica la semana. No se aceptan semanas futuras ni
fechas/zonas inválidas. Las consultas son exclusivamente a los logs del UID del
token; un administrador no accede por este endpoint a otras cuentas.

El backend calcula el reporte sin Gemini, USDA ni escrituras en Firestore.
Los cupos de fotos no se consumen. No hay cron ni snapshots artificiales de planes.
Al actualizar se consultan los registros actuales, incluidas ediciones y archivos.

Semanas cerradas: lunes a domingo. Semana actual: lunes hasta hoy en la zona
solicitada; comparación con los mismos días transcurridos de la semana anterior.
Se conserva `localDate` de cada registro; viajar no reinterpreta fechas históricas.

Entrenamiento: sesiones completadas, abiertas e interrumpidas; únicamente series
marcadas como realizadas aportan reps y volumen. Las series realizadas de sesiones
abiertas/interrumpidas también cuentan y la UI lo aclara. Volumen externo:
reps × kg para tracking `reps_weight`, excluyendo cargas/reps desconocidas. Cero
es válido y no se usa el peso corporal como carga. Ejercicios separados por ID,
versión y tracking; el máximo registrado no es una estimación de fuerza.

Alimentación: solo comidas no archivadas y valores de sus snapshots guardados.
Por nutriente se informa total conocido, alimentos sin dato, días con dato y
promedio sobre esos días (no sobre siete días ni sobre cantidad de comidas).
Sin datos devuelve null; sumas con datos faltantes se marcan parciales. Se informa
cuántos alimentos provienen de fotos, sin volver a pedir estimaciones a Gemini.

El reporte incluye historial de la semana: sesiones con plan y series guardadas,
comidas con sus valores por porción, mediciones de peso y notas. El frontend filtra localmente por día,
tipo, estado y texto; abrir detalles no necesita llamadas adicionales.

Se leen hasta 2000 sesiones y 5000 comidas (incluidas archivadas) para el rango de
comparación. Si se exceden los límites, la API falla explícitamente en lugar de
mostrar totales truncados. `Cache-Control: no-store`. Los datos no se exportan a
proveedores externos.

Peso: promedio de las fechas con medición, primera/última medición y diferencia
entre ambas (null si hay menos de dos fechas). La comparación semanal muestra
diferencia de promedios, indicando cuántos días tienen datos. No se rellenan días
vacíos ni se arrastra el peso inicial a otras semanas. Ver [peso](weight.md).

La interpretación opcional mediante IA se solicita por una operación separada:
[análisis semanal](weekly-ai-analysis.md). Este GET conserva su cálculo sin IA.
Pendiente: snapshots históricos de planificación/objetivos para adherencia.
No se infiere incumplimiento a partir de días sin registros.
