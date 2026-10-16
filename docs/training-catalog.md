# Catálogo de entrenamiento

42 ejercicios, 20 workouts y 12 plantillas públicas. Las cuatro plantillas originales
mantienen sus IDs y contenido. Las ocho nuevas cubren alternativas por frecuencia,
equipamiento y distribución; no son copias que solo cambian el nombre del objetivo.

| Objetivo | Opciones |
|---|---:|
| Mantener mi peso | 4 |
| Ganar masa muscular | 4 |
| Mejorar mi composición corporal | 4 |
| Reducir grasa corporal | 3 |

Una plantilla puede orientar más de un objetivo, por eso la suma supera doce.
Hay variantes de 2, 3 y 4 días; mancuernas y banco, máquinas, y gimnasio mixto.
Los días libres quedan explícitos y se puede personalizar cada distribución.
No se asignan cargas ni se generan registros de actividad del usuario.

Los nuevos ejercicios usan repeticiones, que es la unidad admitida por los logs
actuales. No se incluyen planchas por segundos, distancias ni cardio con unidades
incompatibles. Las instrucciones de ejercicios unilaterales aclaran repeticiones
por lado; las dominadas asistidas no convierten la asistencia en carga externa.

## Ejecución

Usa el `.env` y la cuenta de servicio de Formance. La cuenta indicada debe existir,
estar activa y tener correo verificado y custom claim `admin: true`.

```powershell
# Solo lectura; muestra diferencias y cobertura efectiva de objetivos.
npm.cmd run seed:training -- --admin-email CORREO_ADMIN

# Agrega lo que falta, con su revisión inicial.
npm.cmd run seed:training -- --admin-email CORREO_ADMIN --apply

# Verificar idempotencia: debe mostrar created: 0.
npm.cmd run seed:training -- --admin-email CORREO_ADMIN
```

Los IDs deterministas evitan duplicados. Una transacción valida y crea el conjunto
completo y sus revisiones. No modifica documentos existentes, incluso si el admin
editó nombres o versiones; nuevas rutinas usan los snapshots reales de los workouts
guardados. Una colisión con un ID privado, archivado o inválido aborta toda la carga.
No modifica perfiles, rutinas personales, selecciones activas ni logs.

El script queda versionado para repetir la carga en otro entorno y revisar los datos.
No se ejecuta al arrancar el backend ni durante el deploy. La API sigue leyendo
Firestore; no requiere un redeploy para mostrar las incorporaciones.

## Criterio del contenido

Son ejemplos editables para adultos, sin una prescripción individual ni promesas de
resultados por elegir una etiqueta. Se combinan patrones de tren superior e inferior,
rangos de repeticiones y descanso, y días sin sesión. Las descripciones explican la
disponibilidad y el enfoque; las de reducción de grasa no atribuyen calorías quemadas
a un número de repeticiones. Texto original, con referencias generales de contexto:

- [CDC: actividad física y fortalecimiento de los grandes grupos musculares](https://www.cdc.gov/physical-activity-basics/guidelines/adults.html).
- [ACSM: actualización 2026 sobre entrenamiento de resistencia](https://acsm.org/resistance-training-guidelines-update-2026/).

Las pruebas cubren integridad de referencias, mínimo de opciones por objetivo,
snapshots compatibles con el registro, dry-run, idempotencia, revisiones y protección
de documentos privados e históricos.

Carga realizada: 46 documentos nuevos, 28 originales conservados. La comprobación
posterior devolvió 74 existentes y cero creaciones pendientes. La biblioteca se
verificó en Chrome con una sesión simulada y una copia de los documentos públicos
reales: filtros por los cuatro objetivos, personalización, detalles de workouts,
búsqueda y grupo muscular; anchos entre 320 y 1440 px. 24 pruebas del backend aprobadas.
