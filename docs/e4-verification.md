# Validación real de E4 — 29/10/2026

Backend local de la feature `feature/weekly-ai-analysis`, sin merge a main.
Conectividad verificada realmente con Authentication, Firestore, USDA y Gemini.
Los chequeos iniciales dentro del sandbox no tenían red; repetidos con acceso de
red autorizado aprobaron. No se rotaron claves ni cambiaron proveedores/facturación.

Se usó una sola cuenta existente, autenticada por la UI con Google. El perfil y la
rutina activa se conservaron. El generador existente añadió únicamente documentos
ausentes entre 28/09/2026 y 11/10/2026, después de dry-run: 8 sesiones, 56 comidas y
8 mediciones, con manifiesto y procedencia simulada. No se ejecutó refine:study:
se conservaron las notas visibles de simulación, sin necesidad de alterar recetas.

Playwright comprobó un nuevo registro de entrenamiento y una comida desde foto,
persistencia por recarga y el reporte integrado del 05/10 al 11/10. También se dio
de alta un peso por UI el 15/10, fuera del reporte congelado, con nota de simulación;
esto evita alterar la caché semanal ya generada y no reemplaza mediciones existentes.

Generaciones reales: **una foto y un análisis semanal**. Resultado de foto ready,
comida guardada con fuente Gemini y marca de demostración; análisis semanal ready;
recarga y consultas posteriores con `cached: true`. Los contadores de usuario en
Firestore confirmaron 1 reserva fotográfica del día y 1 reserva de la semana demo.
Las repeticiones de la suite de screenshots solo utilizaron caché.

Herramientas locales de desarrollo:

- `scripts/e4-seed-demo.js`: lee la identidad privada de la inspección real del
  frontend, ejecuta dry-run del generador y aplica solo con `--apply`. No imprime UID/email.
- `scripts/e4-verify-demo.js`: comprueba documentos/contadores y escribe únicamente
  evidencia sin identidad en `formance-frontend/docs/e4/verification.json`.

Estos scripts requieren el checkout hermano `formance-frontend` y su carpeta `.auth`
privada. No son endpoints, no forman parte del arranque de producción y no permiten
crear permisos o saltar login. No ejecutarlos para recapturar imágenes: usar la suite
aislada del frontend. Nunca versionar credenciales, perfiles Chrome o storageState.

Se corrigió un bug encontrado en revisión: un timeout al leer el body de la respuesta
Gemini se clasificaba como JSON inválido (502). Ahora conserva `WEEKLY_AI_TIMEOUT`
(503), también probado con fallo durante `response.json()`. No cambia el hash, modelo,
cuotas ni comportamiento de las generaciones correctas.

Los resultados y procedimientos de capturas están documentados en el frontend:
`docs/e4/SCREENSHOTS_E4.md`. La integración posterior prevista es feature → dev;
no se realizó merge a dev/main ni deploy durante esta preparación.
