# Interpretación semanal ampliada — contrato v2

Rama `feature/weekly-ai-insights`, basada en dev. Se conserva POST
`/api/reports/weekly-analysis`, autenticación, correo verificado, cuotas y caché.
El GET del reporte tradicional y sus cálculos no se modifican.

## Qué mejora

Una sola generación entrega balance de semana, comparación con la anterior,
lecturas de entrenamiento/alimentación/peso, patrones, limitaciones específicas y
1–3 acciones concretas para el próximo seguimiento. No requiere una llamada por área.
La referencia anterior es el mismo tramo de días transcurridos, no una semana
completa contra una parcial. Una primera semana sin registros previos se explica
como falta de referencia; no se fabrican datos para garantizar una comparación.

`services/weekly-insights.js` deriva evidencia desde el reporte existente:

- Días con cualquier registro, sesiones y sesiones completadas; días de comidas,
  peso y fechas de peso inferidas.
- Variantes de ejercicios compartidas y contadores de mayor/menor/igual carga
  máxima registrada, solamente para variantes/versiones comparables.
- Volumen comparado únicamente si ambas selecciones de variantes coinciden y no
  faltan cargas/repeticiones. Diferencia numérica no equivale a mejora de fuerza.
- Diferencia de promedios nutricionales ya calculados y cobertura por nutriente;
  mínimo/máximo de días registrados. No describe ingesta total si faltan registros.
- Comparación de promedios de peso con al menos dos mediciones en cada período;
  valores/fechas de primera y última medición. Es un criterio de presentación para
  evitar conclusiones desde una sola medición, no una garantía estadística o clínica.

Todos los números los calcula el servidor. Gemini debe usarlos tal cual e interpretar
su contexto. Además, el bloque visible `comparison` se redacta siempre de forma
determinista desde esa evidencia, también al leer caché; no confía en la redacción
numérica del modelo. En la prueba real se detectó una diferencia de sesiones mal
expresada por Gemini pese a recibirla correcta. Esta separación evita mostrar ese
error sin necesitar otra generación. Se normalizan etiquetas inglesas de nutrientes
como fat/carbohydrates a grasas/carbohidratos.
No recibe IDs ni nombres de ejercicios, alimentos o usuarios, notas,
credenciales ni logs completos. Se agrega únicamente el código de objetivo actual
del propio perfil (`maintain`, `muscle`, `recomposition`, `fat_loss`), validado por
lista cerrada. No se envían metas nutricionales sin vigencia histórica, edad o altura.
El objetivo da foco a la lectura actual; no demuestra la meta de semanas pasadas.

## Respuesta analysis

```json
{
  "summary": "Balance de la semana…",
  "comparison": "Comparación con el mismo tramo anterior…",
  "insights": {
    "training": "Distribución y registros comparables…",
    "nutrition": "Promedios registrados y cobertura…",
    "weight": "Mediciones y variación observada…"
  },
  "trends": ["Patrón concreto sustentado en evidencia…"],
  "reviewPoints": ["Limitación específica de estos datos…"],
  "nextWeekFocus": ["Acción de registro/revisión y para qué sirve…"]
}
```

Se valida exactamente ese conjunto de seis propiedades; insights tiene exactamente
tres campos. Textos no vacíos de hasta 1200 caracteres; trends/reviewPoints de 1–4
elementos, nextWeekFocus de 1–3. Se conservan analysis/fingerprint/cached/generatedAt
en el sobre HTTP, y summary/trends/reviewPoints permiten que un frontend anterior
siga mostrando su vista básica durante un despliegue escalonado.

La comparación generada por el modelo no se utiliza como fuente de cifras: la API
la reemplaza por su redacción calculada, con sesiones, series, promedios registrados,
cobertura y límites. Las lecturas por área, tendencias y foco siguen siendo interpretación
de Gemini. El resto de la respuesta es texto generado y requiere las cautelas normales
de interpretación; el prompt no es una garantía semántica de todo su contenido.

El prompt pide idealmente 400–650 palabras, sin listas repetidas de totales. Las
acciones admitidas son de seguimiento/revisión: completar cargas para comparar,
revisar porciones estimadas, registrar peso con condiciones comparables o revisar
la distribución ya elegida. No prescribe una dieta/rutina, cargas/ingestas nuevas,
suplementos, tratamiento, causalidad ni cambios de composición corporal demostrados.
El disclaimer existente continúa visible.

## Caché, cuotas y consumo

`schemaVersion=2` participa en la huella y en los documentos. Evidencia y objetivo
también participan. Resultados v1 se conservan, pero no se reutilizan como si fueran
la nueva interpretación. Pedir el nuevo análisis requiere una nueva generación
manual y usa un cupo existente: no se reinician contadores ni se elevan límites.
Cada repetición idéntica de v2 consulta caché sin generar. Cambiar el objetivo o
datos relevantes invalida la huella; las notas personales siguen excluidas.

Las cuotas se mantienen: fotos 3/usuario/día y 20 global/día, 3 global/minuto;
semanal 2/usuario/semana analizada y 10 global/día, 1 global/minuto. Se usa el mismo
Gemini configurado y una sola petición por generación. El tope de salida pasa de
2500 a 3500 tokens para evitar truncar el esquema ampliado: una llamada más completa
puede procesar/generar más tokens que antes; no se promete el mismo consumo de tokens.
No se cambian claves ni facturación. Fallos tras reservar siguen consumiendo cupo.

## Pruebas

`test/weekly-insights.test.js` cubre diferencias calculadas, cobertura, selección de
variantes, carga desconocida/cero, semanas previas vacías, peso insuficiente,
semanas parciales, privacidad y contrato/prompt de una única petición.
Las pruebas HTTP existentes ahora validan v2 y el contexto del objetivo, su cambio
de caché sin reset de cuotas y rechazo de respuestas mal formadas.

Las capturas históricas de E4 documentan la versión anterior; no prueban por sí solas
esta ampliación. No ejecutar a ciegas la suite histórica de captura con su recibo v1
contra v2, ya que una nueva versión tiene otra huella y necesita un cupo disponible.

Validación local de esta rama: 48 pruebas backend aprobadas; integración con Gemini
real y recuperación por caché comprobadas desde la UI. Se utilizó una generación
nueva dentro del cupo existente de la semana demo, sin reset de contadores ni fotos.
La corrección de comparación numérica se verificó con esa misma caché, sin generar
de nuevo. La evidencia sin identidad está en el frontend, `docs/weekly-insights-verification.json`.
