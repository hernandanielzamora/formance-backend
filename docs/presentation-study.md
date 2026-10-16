# Mes de demostración

El generador agrega datos simulados a una cuenta real para mostrar los logs.
No representa actividad realizada, resultados clínicos ni un estudio observacional.
La carga inicial identifica los registros con `[DEMO SIMULADA]` en la nota y
`demoData.simulated: true`. La revisión de las comidas descripta al final conserva
esa procedencia internamente y reemplaza sus notas visibles por preparaciones.

## Uso

```powershell
# Solo lectura: verifica identidad, rutina y registros existentes.
npm.cmd run seed:study -- --uid UID --email CORREO --from 2026-09-16 --to 2026-10-15

# Si todavía no hay una rutina activa, se puede indicar una plantilla alternativa.
# Solo --apply crea su copia privada, la activa y agrega los registros.
npm.cmd run seed:study -- --uid UID --email CORREO --from 2026-09-16 --to 2026-10-15 --fallback-template flexible-3 --apply
```

El email debe corresponder exactamente al UID; la cuenta debe estar activa, con
correo verificado y onboarding completo. Si tiene una rutina activa, se usa esa
versión con sus snapshots. La alternativa no sustituye una rutina ya activa.
Las fechas cubren hasta 31 días completos, como máximo hasta ayer.

La carga usa una sola transacción y crea un manifiesto privado en
`users/{uid}/studyImports/month-v1-{from}-{to}`. Repetir el mismo período devuelve
`alreadyApplied: true` sin modificar los documentos, incluso si después se editaron
en la app. Conserva perfil, objetivos, peso inicial y registros previos; no carga
una sesión sobre otro registro existente del mismo workout/rutina/día.
Las mediciones no reemplazan un peso ya guardado para la fecha y las comidas no
reemplazan un momento del día que ya tenga una carga activa.

El manifiesto guarda las referencias creadas y el carácter simulado de la planificación
histórica. Aplicar la rutina actual a días anteriores es una reconstrucción ficticia,
no evidencia de que esa rutina estuviera elegida en esas fechas.

## Datos incluidos

- Sesiones en los días asignados; los descansos no crean sesiones vacías. Variación
  ilustrativa de reps/carga y una sesión interrumpida con series pendientes.
- Cuatro comidas diarias de carga manual con ingredientes y porciones variables.
  Un registro incluye un nutriente desconocido para demostrar los totales parciales.
  No se fabrican referencias USDA ni análisis Gemini y no se consumen sus cuotas.
- Mediciones de peso aproximadamente cada dos días con oscilaciones ficticias
  alrededor del peso inicial, sin inventar una pérdida de peso sostenida.

## Recorrido sugerido en la presentación

La carga de septiembre/octubre de 2026 contiene 13 sesiones (12 completas y una
interrumpida), 120 comidas y 15 pesos nuevos; se conservó una medición inicial.
Se usó una copia privada de Fuerza flexible · 3 días para una cuenta de mantenimiento.

1. Entrenamiento → Calendario: semana del 12 de octubre. Elegir el lunes o miércoles,
   abrir **Registros del día → Ver registro** y mostrar series, repeticiones y carga.
   Las sesiones finalizadas conservan sus datos en modo de solo lectura.
2. Reportes: elegir **5 de octubre de 2026** para mostrar una semana cerrada completa
   y su comparación con la anterior. Cambiar a Historial y filtrar entrenamiento,
   alimentación o peso; abrir cada detalle y sus notas de demostración.
3. Reportes: semana del **21 de septiembre** para mostrar una sesión interrumpida.
   La carga original incluía un nutriente desconocido; las comidas revisadas tienen
   sus cuatro nutrientes completos. Los reportes siguen distinguiendo null de cero.
4. Alimentación: seleccionar **15 de octubre** para mostrar cuatro comidas y totales
   frente a los objetivos existentes del perfil.
5. Peso: consultar el último mes y seleccionar puntos del gráfico.

Verificación: 28 pruebas del backend aprobadas, comprobación de idempotencia en
Firestore y lecturas mediante los endpoints reales del backend. En Chrome se usó
una identidad de navegador simulada y una API temporal limitada a GET en localhost;
las consultas de perfil, calendario, reportes, comidas y peso leyeron Firestore real.
No se usaron contraseñas ni se modificó la autenticación de la cuenta durante la prueba.
La API temporal no forma parte del código del proyecto ni del despliegue.

## Revisión de las comidas de presentación

```powershell
# Primero simular; --apply habilita la actualización.
npm.cmd run refine:study -- --uid UID --email CORREO --from 2026-09-16 --to 2026-10-15
npm.cmd run refine:study -- --uid UID --email CORREO --from 2026-09-16 --to 2026-10-15 --apply
```

Esta operación se limita a `foodLogs` generados por el manifiesto. No permite cambios
en sesiones, pesos ni rutinas. Omite comidas archivadas o editadas desde la carga;
respalda cada documento antes de modificarlo en `beforePresentationV2`, dentro del
manifiesto. La ejecución repetida devuelve `alreadyApplied: true` y no toca los datos.

Las 120 comidas ahora alternan 28 preparaciones: tostadas, avena, yogur con fruta,
pollo con arroz, fideos con carne, ensaladas de legumbres, atún y pescado, entre otras.
Las porciones varían por ingrediente, con pesos crudos/cocidos explícitos en los nombres
y huevos en unidades aproximadas de 50 g. Los nutrientes y totales se recalculan a
partir de cada porción. Las notas muestran el plato, sin anuncios de demo.

Los valores siguen siendo estimaciones ilustrativas de carga manual: no son registros
reales de consumo ni respuestas atribuidas a USDA o Gemini. El origen simulado queda en
`demoData`, junto a `presentationRevision: 2` y `nutritionValues: illustrative-estimates`.
No se consume IA. Se comprobaron 30 días con cuatro comidas, 28 notas de platos distintas,
idempotencia y conservación exacta de sesiones, pesos y rutina frente al respaldo.
