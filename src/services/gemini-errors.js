// Never return or log upstream messages: they can contain request details.
export function geminiHttpFailure(status, body = {}) {
  const error = body?.error || {};
  const reasons = (Array.isArray(error.details) ? error.details : []).map(item => item?.reason);
  const message = typeof error.message === 'string' ? error.message : '';
  let code = 'GEMINI_UNAVAILABLE'; let text = 'Gemini no está disponible temporalmente. Podés usar la carga manual.'; let httpStatus = 503;
  if (/reported as leaked|key.*leaked/i.test(message)) { code = 'GEMINI_KEY_BLOCKED'; text = 'Google bloqueó la clave de Gemini. Es necesario actualizar la configuración del servicio.'; }
  else if (reasons.includes('API_KEY_INVALID') || /API key not valid/i.test(message)) { code = 'GEMINI_KEY_INVALID'; text = 'La clave configurada para Gemini no es válida. Revisá la configuración del servicio.'; }
  else if (status === 401 || status === 403) { code = 'GEMINI_ACCESS_DENIED'; text = 'Gemini rechazó el acceso del proyecto. Revisá los permisos de la clave del servidor.'; }
  else if (status === 404) { code = 'GEMINI_MODEL_UNAVAILABLE'; text = 'El modelo de análisis configurado no está disponible para este proyecto. Es necesario actualizarlo.'; }
  else if (status === 429) { code = 'PROVIDER_LIMIT'; text = 'Gemini alcanzó su cuota. Esperá antes de reintentar o usá la carga manual.'; httpStatus = 429; }
  else if (status === 400) { code = 'GEMINI_REQUEST_REJECTED'; text = 'Gemini rechazó la solicitud de análisis. Revisá el modelo y la configuración del servicio.'; }
  else if (status === 500 || status === 502) { code = 'GEMINI_UPSTREAM_ERROR'; text = 'Gemini respondió con un error temporal. Intentá más tarde o usá la carga manual.'; httpStatus = 502; }
  else if (status === 408 || status === 504) { code = 'GEMINI_TIMEOUT'; text = 'Gemini tardó demasiado en responder. Intentá más tarde o usá la carga manual.'; }
  return Object.assign(new Error(text), { status: httpStatus, code, upstreamStatus: status });
}
