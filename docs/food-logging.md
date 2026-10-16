# Registro de comida y proveedores gratuitos

La web `/app/alimentacion` permite registrar, editar, duplicar y retirar comidas
por fecha y momento del día. Carga manual disponible sin proveedores. Los valores
pueden referirse a 100 g o a toda la porción consumida. El cálculo de cantidades y
totales es determinista en el backend. Nutrientes desconocidos permanecen null;
los totales muestran su completitud y no representan alimentación no registrada.

## Configuración local

Completar en **formance-backend/.env** (nunca en el frontend):

```dotenv
USDA_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
FOOD_AI_USER_DAILY_LIMIT=3
FOOD_AI_GLOBAL_DAILY_LIMIT=20
FOOD_AI_GLOBAL_MINUTE_LIMIT=3
```

- USDA: obtener una clave gratuita en https://fdc.nal.usda.gov/api-key-signup/.
- Gemini: crear una clave en https://aistudio.google.com/api-keys en un proyecto
  de **Free tier sin facturación**, preferentemente independiente de Firebase.
  Esta aplicación no modifica facturación ni puede determinar el nivel de una
  clave. Una clave de un proyecto con facturación puede generar cargos incluso
  con este modelo. Verificar el nivel y los límites reales en AI Studio.
- Reiniciar el backend después de modificar `.env`.
- En Render, configurar `GEMINI_MODEL=gemini-3.5-flash-lite` y elegir **Save and deploy**.
  Una variable explícita con el modelo anterior prevalece sobre el nuevo default.
- Ejecutar `npm.cmd run check:food`: consulta USDA y verifica el acceso al modelo
  Gemini sin mandar imágenes ni generar contenido. Con claves vacías informa lo
  pendiente; no imprime claves. `npm.cmd run dev` arranca el backend.

El chequeo de metadatos no genera contenido y no prueba que `generateContent` esté
habilitado para ese modelo/proyecto. Se reprodujo un caso en que metadatos/listado de
`gemini-2.5-flash-lite` devolvían 200, pero el análisis devolvía 404; con la misma clave
y foto, `gemini-3.5-flash-lite` devolvió cuatro alimentos validados. Google limita el
acceso de nuevos proyectos a modelos 2.5 y recomienda modelos actuales:
https://ai.google.dev/gemini-api/docs/deprecations.
3.5 Flash-Lite admite imágenes y tiene nivel gratuito; las cuotas disponibles dependen
del proyecto. No se modifican facturación ni cupos de Formance:
https://ai.google.dev/gemini-api/docs/pricing.

No se requiere SDK adicional, Cloud Functions ni almacenamiento de fotografías.
Las llamadas REST usan fetch de Node, con dominios fijos, claves en headers,
timeouts y sin reintentos automáticos ni herramientas de búsqueda pagas.

## USDA

La búsqueda se realiza al enviar el formulario, no por cada tecla. Caché en memoria
de hasta 200 resultados/detalles durante 24 horas y límite propio de 500 llamadas
por hora/proceso. Con múltiples instancias, compartir el límite/caché antes de
escalar. El límite real del proveedor puede ser menor; 429 permite seguir con
carga manual. Descripciones y preparación original se muestran para que el
usuario distinga crudo/cocido. No hay traducción automática de consultas.

Se normalizan kcal y gramos de proteínas, grasas y carbohidratos por 100 g.
USDA verifica los valores de nuevo al guardar; el cliente no puede reemplazarlos
por macros falsificados. El log conserva un snapshot de los valores utilizados.
Fuente CC0: USDA FoodData Central. https://fdc.nal.usda.gov/api-guide/.

## Gemini y privacidad

La foto se comprime a JPEG de hasta 1280 px y 1 MB antes de enviarla. El backend
valida firma/formato, tamaño y consentimiento. Envía solamente imagen e
instrucciones generales a Gemini, sin perfil, UID ni historial. Formance no
persiste la imagen: guarda el hash, modelo y propuesta nutricional, no los bytes.
El nivel gratuito de Google puede utilizar contenido para mejorar productos;
la UI requiere aceptación explícita antes del envío.

La respuesta se valida y normaliza como **estimación por 100 g**. El usuario revisa
y ajusta nombres, gramos y nutrientes antes de confirmar. No se guardan comidas
automáticamente a partir de fotos. Los valores permanecen etiquetados como IA;
no se realizan emparejamientos automáticos con USDA ni se inventan IDs.

Cupos de aplicación persistentes en Firestore por día UTC: 3 solicitudes por
usuario, 20 globales y 3 por minuto globalmente. Se reservan en transacción antes
de llamar al proveedor y también cuentan los intentos fallidos, de modo conservador.
`requestId` + hash permite recuperar análisis exitosos sin repetir la llamada.
Los cupos reales de Google se aplican además y no están garantizados por estos
valores. No se cambia automáticamente a un modelo o plan pago.

### Diagnóstico de fallos de análisis

El JSON de `/api/food/analyze` distingue `GEMINI_MODEL_UNAVAILABLE` (404 del proveedor),
`GEMINI_KEY_INVALID`, `GEMINI_KEY_BLOCKED`, `GEMINI_ACCESS_DENIED`,
`GEMINI_REQUEST_REJECTED`, `GEMINI_TIMEOUT`, `GEMINI_NETWORK_ERROR` y
`PROVIDER_LIMIT` (429). Un 503 HTTP de Formance no implica siempre saturación de Google.
Los fallos temporales de Google conservan una descripción diferenciada.

Los logs de Render muestran `Food analysis failed` con código, modelo, status HTTP
del proveedor y, cuando existe, código de transporte reconocido. El documento privado
`foodAnalyses/{id}` conserva `failureCode` y `upstreamStatus`. No se registran mensajes
crudos de Google, claves, tokens ni imágenes. Se mantiene un solo intento upstream,
sin repetir análisis o cambiar de modelo automáticamente ni relajar cuotas.

Documentación:
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/terms

## Datos y API

Endpoints bajo `/api/food`, ID token y correo verificado obligatorios:

- `GET /capabilities`: opciones disponibles sin exponer claves.
- `GET /diary?date=YYYY-MM-DD&timeZone=UTC`: registros y totales diarios.
- `GET /search?q=rice`: búsqueda USDA paginada a 15 resultados.
- `POST /analyze`: requestId, mimeType, image base64 y consent:true.
- `POST /meals`: mealId idempotente, localDate, timeZone, mealType, note, items.
- `PUT /meals/:id`: mismos campos más expectedVersion.
- `DELETE /meals/:id`: expectedVersion; retira sin destruir el documento.

Colecciones privadas `users/{uid}/foodLogs`, `foodAnalyses` y `foodAnalysisUsage`;
cuota del proyecto en `foodAnalysisUsage/{YYYY-MM-DD}`. Roles administrativos no
permiten acceder a diarios de otras cuentas. Ediciones/borrados usan transacciones
y rechazan versiones antiguas. Hasta 20 alimentos por comida y 200 comidas
activas por consulta diaria; un exceso genera error, sin truncar resultados.

No se escribe en bases públicas ni se migran documentos existentes. Favoritos,
catálogo traducido local, códigos de barras y reportes agregados son mejoras futuras.
