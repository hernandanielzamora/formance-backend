# Análisis semanal con IA

Nota de versión: el diseño de persistencia/cuotas de este documento se conserva.
El ejemplo de respuesta y validación de tres campos describe v1. El contrato actual
es [v2, interpretación ampliada](weekly-ai-insights.md), con seis campos y otra huella.

POST `/api/reports/weekly-analysis`, con Bearer token Firebase y correo verificado.
Body exacto: `{ "weekStart": "2026-10-05", "timeZone": "America/Argentina/Buenos_Aires" }`.
No acepta UID ni otros campos. `weekStart` debe ser lunes y no futuro.

La ruta comparte la lectura de logs y `buildWeeklyReport` con GET `/api/reports/weekly`.
Gemini interpreta métricas ya calculadas; no calcula ni sustituye el reporte tradicional.
Acepta semanas con al menos una sesión, comida o medición válida; no exige los tres
dominios para evitar excluir registros parciales. El prompt exige declarar las carencias.
Sin datos actuales devuelve 400 `INSUFFICIENT_WEEKLY_DATA`, sin consumo.

Respuesta 200:

```json
{
  "analysis": {
    "summary": "Según los registros disponibles…",
    "trends": ["Durante esta semana…"],
    "reviewPoints": ["No existen datos suficientes para determinar…"]
  },
  "fingerprint": "sha256",
  "cached": false,
  "generatedAt": "2026-10-28T12:00:00.000Z"
}
```

JSON validado: exactamente tres propiedades en `analysis`; summary no vacío, listas
de 1–6 textos, cada texto no vacío y máximo 1800 caracteres. Rechaza JSON inválido,
salidas truncadas, vacías y respuestas sin candidato finalizado. Usa el mismo
`GEMINI_API_KEY` y `GEMINI_MODEL` configurados, sin cambiar el flujo fotográfico.
Timeout de generación: 45 segundos; sin reintentos automáticos.

## Privacidad

Lista explícita de campos: métricas actuales/anteriores, días con datos, nutrientes,
peso agregado/diario, comparaciones válidas y limitaciones. No manda UID, nombre,
email, IDs, nombres de ejercicios/alimentos, notas, fotos, rutinas ni logs completos.
No guarda el payload enviado. No registra respuestas de error crudas del proveedor.
Prompt descriptivo: prohíbe prescribir, diagnosticar, crear dietas/rutinas, recomendar
medicación/suplementos, causalidad, inventar registros o adherencia histórica.
El control de formato y el prompt no son una certificación clínica del texto generado.

## Firestore y caché

- `users/{uid}/weeklyAnalyses/{scopeHash}-{fingerprint}`: status, fingerprint,
  attempt, leaseUntil, weekStart, timeZone, model, schemaVersion, createdAt;
  éxito añade analysis/generatedAt; fallo añade failureCode.
- `scopeHash`: SHA-256 de semana y zona. `fingerprint`: SHA-256 del payload de
  interpretación, modelo y versión de contrato/prompt. El orden de campos es fijo
  y no se incluyen timestamps de generación, identidad, notas ni orden de logs.
- La misma información relevante recupera el análisis persistido, incluso al
  reiniciar el proceso, cambiar de pestaña o recargar la página. La caché se busca
  antes de exigir cuota o clave configurada. Nunca cruza cuentas.
- Cambiar métricas o su distribución diaria, cobertura, comparación anterior,
  modelo o versión produce otra huella. Cambiar solo una nota no invalida una
  interpretación que nunca recibió esa nota. Volver a los mismos datos reutiliza
  su resultado anterior. Los documentos antiguos se conservan, pero la ruta nunca
  los entrega para una huella distinta.
- Reserva transaccional de 90 segundos evita duplicar generación simultánea.
  Una reserva vencida puede recuperarse con otro intento y gasto de cuota; el
  identificador de intento impide que una respuesta tardía reemplace al intento nuevo.

## Cuotas

`AUDITORIA_CUOTAS_GEMINI.md` no está disponible en el workspace y el usuario indicó
que desconoce su ubicación. No se afirma haber aplicado conclusiones de ese archivo.
Se documenta una política nueva justificada: una generación inicial y una actualización
por semana solicitada, con presupuesto global menor al de fotos. Todos los límites
son ajustables por entorno y se validan al iniciar.

| Variable | Default | Persistencia / período |
|---|---:|---|
| WEEKLY_AI_USER_WEEKLY_LIMIT | 2 | `users/{uid}/weeklyAnalysisUsage/{weekStart}`; presupuesto por semana analizada, compartido entre zonas |
| WEEKLY_AI_GLOBAL_DAILY_LIMIT | 10 | `weeklyAnalysisUsage/{YYYY-MM-DD}`; día UTC de solicitud |
| WEEKLY_AI_GLOBAL_MINUTE_LIMIT | 1 | Mismo documento global, contador del minuto UTC de solicitud |

El presupuesto por semana analizada no se reinicia al comenzar otra semana del
calendario: cada semana tiene su propio cupo; semanas históricas distintas tienen
presupuestos distintos sujetos a los topes globales. Caché: cero consumos.
Una reserva consume cuota incluso ante fallo del proveedor o interrupción posterior;
no se restituye, siguiendo el criterio conservador del flujo foto existente.
No se consume si faltan datos/configuración, si ya hay proceso vigente o al rechazar
el request. El límite de usuario requiere consultar caché o elegir otra semana;
el global diario/minuto permite reintentar al cambiar el período correspondiente.

Las cuotas de foto siguen sin cambios: 3/usuario/día, 20/proyecto/día y 3/minuto
por defecto, en `foodAnalysisUsage`, independientes. Con defaults, ambas funciones
permiten hasta 30 reservas globales diarias combinadas; estos presupuestos locales
NO garantizan capacidad de Google. Si comparten clave/proyecto/modelo comparten
las cuotas reales del proveedor (y tokens), junto a cualquier otro consumidor.
Google puede rechazar antes de esos topes; no se consulta ni cambia facturación.

Errores: 401 sin sesión, 403 sin verificar, 400 entrada/sin datos, 409 análisis
en proceso, 429 `WEEKLY_ANALYSIS_LIMIT` o límite proveedor, 503 no configurado/red/
timeout/permisos del proveedor y 502 formato inválido o fallo upstream correspondiente.
La API reutiliza el traductor de errores Gemini existente. GET semanal nunca llama
a la IA ni depende de sus cuotas o clave.

Pruebas nuevas: `test/weekly-analysis.test.js`. No ejecutan llamadas externas reales.
