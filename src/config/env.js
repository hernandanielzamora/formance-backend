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
  const limit = (key, fallback, max) => { const value = Number(source[key] || fallback); if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${key} inválido.`); return value; };
  const geminiModel = source.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
  if (!['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.8-flash'].includes(geminiModel)) throw new Error('GEMINI_MODEL debe ser un modelo de visión con nivel gratuito admitido.');
  return { port, nodeEnv, frontendOrigin, firebaseProjectId, usdaApiKey: source.USDA_API_KEY?.trim() || '', geminiApiKey: source.GEMINI_API_KEY?.trim() || '', geminiModel,
    foodAnalysisUserDailyLimit: limit('FOOD_AI_USER_DAILY_LIMIT', 3, 100), foodAnalysisGlobalDailyLimit: limit('FOOD_AI_GLOBAL_DAILY_LIMIT', 20, 1000), foodAnalysisGlobalMinuteLimit: limit('FOOD_AI_GLOBAL_MINUTE_LIMIT', 3, 30),
    weeklyAnalysisUserWeeklyLimit: limit('WEEKLY_AI_USER_WEEKLY_LIMIT', 2, 20),
    weeklyAnalysisGlobalDailyLimit: limit('WEEKLY_AI_GLOBAL_DAILY_LIMIT', 10, 1000),
    weeklyAnalysisGlobalMinuteLimit: limit('WEEKLY_AI_GLOBAL_MINUTE_LIMIT', 1, 30) };
}
