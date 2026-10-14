import { parseEnv } from '../src/config/env.js';
import { createFoodProviders } from '../src/services/food-providers.js';
const config = parseEnv();
const providers = createFoodProviders(config);
let failed = false;
console.log('Registro manual: disponible sin claves de proveedores.');
console.log(`Modelo de visión: ${config.geminiModel}. Cupos propios: ${config.foodAnalysisUserDailyLimit}/usuario/día, ${config.foodAnalysisGlobalDailyLimit}/proyecto/día.`);
if (!config.usdaApiKey) { console.log('USDA: pendiente. Completar USDA_API_KEY en .env.'); failed = true; }
else try { await providers.search('rice'); console.log('USDA: conexión y datos nutricionales verificados.'); }
catch (error) { console.error('USDA: verificación fallida.', error.code || 'UNAVAILABLE'); failed = true; }
if (!config.geminiApiKey) { console.log('Gemini: pendiente. Completar GEMINI_API_KEY en .env.'); failed = true; }
else try {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}`, { headers: { 'x-goog-api-key': config.geminiApiKey }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('UNAVAILABLE');
  const model = await response.json();
  if (!model.supportedGenerationMethods?.includes('generateContent')) throw new Error('UNSUPPORTED_MODEL');
  console.log('Gemini: credencial y acceso al modelo verificados (sin enviar fotos ni generar contenido).');
} catch { console.error('Gemini: no se pudo verificar la credencial/modelo. Revisar clave, conexión y acceso en AI Studio.'); failed = true; }
console.log('La API no permite comprobar aquí si tu proyecto tiene facturación: verificá Free tier en Google AI Studio.');
process.exitCode = failed ? 1 : 0;
