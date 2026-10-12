import 'dotenv/config';

export function parseEnv(source = process.env) {
  const port = Number(source.PORT || 4200);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  const nodeEnv = source.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV inválido.');
  }
  const frontendOrigin = source.FRONTEND_ORIGIN || 'http://localhost:3000';
  const url = new URL(frontendOrigin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== frontendOrigin) {
    throw new Error('FRONTEND_ORIGIN debe ser un origen HTTP(S), sin ruta ni barra final.');
  }
  const firebaseProjectId = source.FIREBASE_PROJECT_ID?.trim() || '';
  if (nodeEnv === 'production' && !firebaseProjectId) {
    throw new Error('FIREBASE_PROJECT_ID es obligatorio en producción.');
  }
  return { port, nodeEnv, frontendOrigin, firebaseProjectId };
}
