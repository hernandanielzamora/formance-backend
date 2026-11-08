# Lectura semanal de un vistazo

`GET /api/reports/weekly` agrega `glance`, calculado en el servidor sin IA ni cupos
(`src/services/weekly-glance.js`). Compara la semana con:

- **Objetivo actual** del perfil (`targets.calories`, `targets.protein`, `goal`).
- **Rutina activa**: días con workouts asignados. Los días anteriores a la creación de la rutina no cuentan.
- **Semana anterior**: cargas máximas comparables y promedio de peso (mínimo 2 mediciones por semana).

| Área | Bien | A revisar |
| --- | --- | --- |
| Entrenamiento | Todos los días planificados hechos | Menos del 60 % de los días planificados |
| Alimentación | ≥ 70 % de los días a ±10 % de las calorías y ≥ 90 % de la proteína | Registro en menos de la mitad de los días o promedio lejos del objetivo en la dirección contraria |
| Peso | Promedio en la dirección del objetivo | Cambio ≥ 0,3 kg en dirección contraria |

Devuelve un titular (`headline.tone`: `good`, `mixed`, `attention` o `empty`), hasta 3 logros y
3 mejoras (una por área antes de repetir), un foco con enlace y el detalle por día de cada área.
Señales incluidas: entrenamientos salteados, sesiones interrumpidas, récords de carga,
días en objetivo, proteína, fines de semana con más calorías (≥ 15 %), pico diario
(> 15 % sobre el objetivo), cobertura del registro y peso frente al objetivo.

Las metas usadas son las actuales: se identifican como “tu objetivo actual”. Un día sin
registro se informa como falta de registro, no como incumplimiento.

## Análisis con IA (v3)

`POST /api/reports/weekly-analysis` envía la lectura ya calculada y pide un texto breve
de coach: `headline`, `wins` (1–3), `improvements` (1–3), `focus` y `detail` por área.
El modelo no calcula ni inventa valores. Los análisis v2 guardados no se reutilizan
porque la huella incluye la versión del esquema.
