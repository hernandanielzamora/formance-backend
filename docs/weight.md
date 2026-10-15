# Registro de peso

Todas las rutas requieren token y correo verificado. Operan exclusivamente sobre
`users/{uid}/weightMeasurements`, incluso para administradores, con `no-store`.

- `GET /api/weight?from=YYYY-MM-DD&to=YYYY-MM-DD&timeZone=America/Argentina/Buenos_Aires`: historial y resumen, hasta 366 días inclusivos.
- `POST /api/weight/measurements`: `{ localDate, timeZone, weightKg, note }`.
- `PUT /api/weight/measurements/:date`: los mismos campos y `expectedVersion`.
- `DELETE /api/weight/measurements/:date`: `{ expectedVersion }`; archiva conservando revisiones.

Una medición manual por fecha, entre 30 y 350 kg y hasta dos decimales. No se
aceptan fechas futuras. Repetir una carga idéntica es idempotente; otra carga
para la misma fecha devuelve 409 e invita a editar. Ediciones y archivos usan
transacciones y versión para evitar sobrescribir cambios de otra pestaña.
Cada cambio conserva una revisión; recrear un registro archivado aumenta su versión.
No se cambia la fecha al editar: se crea otra medición y se quita la anterior.

El documento `initial` del onboarding se conserva y es de solo lectura. Los nuevos
onboardings guardan fecha local y zona. Para documentos anteriores se deriva la
fecha del timestamp y se marca como aproximada, sin modificar datos existentes.
Una medición manual del mismo día prevalece en los cálculos; al quitarla vuelve
a aparecer la inicial. El perfil original no se sobrescribe al registrar peso.

El gráfico conecta mediciones reales sin generar valores intermedios. El promedio
usa solo fechas medidas. La variación es último menos primer peso del período;
con menos de dos fechas es null. Los reportes comparan promedios semanales con sus
cantidades de mediciones; no interpretan cambios como pérdida de grasa ni emiten
recomendaciones clínicas. No hay llamadas a IA ni proveedores externos.
