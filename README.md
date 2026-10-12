# Formance · Backend

API independiente para el MVP del seminario. Node.js + Express + Firebase Admin.
Estado: validación de identidad y permisos; todavía no hay datos de negocio.
`GET /api/auth/me` valida un ID token de Firebase y su revocación.
`GET /api/admin/session` exige además correo verificado y custom claim `admin: true`.
El registro y login se realizan con el SDK de Firebase del frontend, sin enviar contraseñas a la API.
`GET /api/profile` consulta exclusivamente el perfil del usuario autenticado.
`POST /api/profile/onboarding/preview` calcula la referencia sin guardar datos.
`PUT /api/profile/onboarding` guarda perfil y peso inicial en una transacción,
exige correo verificado y rechaza la repetición de un onboarding completo.
La referencia adapta Harris-Benedict de Nutrivo y porcentajes fijos para resultados
reproducibles; los objetivos son orientativos y editables al confirmar.
Persistencia: `users/{uid}` y `users/{uid}/weightMeasurements/initial`.

## Inicio local

Usar Node.js 24 LTS para ambos proyectos. Los scripts también requieren Node >=22.
En PowerShell usar `npm.cmd` si la política de ejecución bloquea `npm`.

```powershell
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run dev
```

No sobrescribir `.env` si ya está configurado. API: http://localhost:4200/api/health.
Sin Firebase configurado, health funciona, pero no significa que exista conexión a Firebase.

## Firebase nuevo

1. Crear un proyecto exclusivo de Formance en https://console.firebase.google.com/.
2. Habilitar Authentication y el proveedor Correo electrónico/Contraseña.
3. Crear Cloud Firestore en modo producción y elegir su ubicación.
4. En Configuración del proyecto > Cuentas de servicio, generar una clave privada.
5. Guardar el JSON solo localmente en `credentials/firebase-service-account.json`.
6. Completar `.env`:

```dotenv
FIREBASE_PROJECT_ID=tu-proyecto-nuevo
GOOGLE_APPLICATION_CREDENTIALS=./credentials/firebase-service-account.json
```

Ejecutar desde esta carpeta:

```powershell
npm.cmd run check:firebase
```

La comprobación consulta Authentication y Firestore sin escribir ni imprimir datos.
Un resultado correcto confirma acceso real; inicializar el SDK no lo confirma.
También se admite Application Default Credentials del entorno de despliegue.
No copiar las cuentas de servicio de Nutrivo.

## Reglas y permisos

El frontend utiliza Firebase solo para identidad. Todas las operaciones sobre registros
pasarán por la API. `firestore.rules` deniega el acceso directo del cliente; Firebase
Admin utiliza IAM y no estas reglas. El backend deberá verificar tokens y propiedad
de recursos antes de añadir endpoints de negocio.

Las reglas están versionadas, pero NO se despliegan automáticamente. Una vez disponible
Firebase CLI y autenticada la cuenta del proyecto nuevo:

```powershell
firebase deploy --only firestore --project TU_PROJECT_ID
```

El paso 2 incluirá usuario y administrador desde el principio: acceso admin separado,
permisos establecidos desde un entorno confiable y verificados por el servidor.
No habrá autoasignación de roles ni permisos basados en un campo enviado por el cliente.
La aplicación no puede asignar roles desde formularios ni mediante una ruta pública.

### Habilitar una cuenta administradora

Primero iniciar sesión en la aplicación y verificar el correo (Google lo verifica).
Desde esta carpeta, con la cuenta de servicio local:

```powershell
npm.cmd run grant:admin -- correo@ejemplo.com
```

El script exige una cuenta existente, activa y verificada, y conserva otros custom claims.
No crea cuentas, contraseñas ni asigna el rol por orden de registro. Después cerrar sesión
y volver a entrar; la aplicación redirige al administrador a `/admin`.

## Estructura y verificación

- `src/config`: variables y Firebase Admin.
- `src/app.js`: HTTP, CORS, límites, errores y health.
- `src/server.js`: arranque separado para facilitar pruebas.
- `scripts/check-firebase.js`: conexión real al proyecto configurado.
- `test`: pruebas de configuración y contrato HTTP.

```powershell
npm.cmd test
```

Sin tareas programadas, pagos, correo externo, IA ni acceso al proyecto Nutrivo.
`.env`, credenciales y dependencias se excluyen de Git. Versionar `package-lock.json`.
Repositorio independiente: https://github.com/hernandanielzamora/formance-backend.
La base inicial se registra en `main`; `dev` será la rama de integración y cada feature
se desarrollará en una rama creada desde `dev`.

Documentación: https://firebase.google.com/docs/admin/setup
