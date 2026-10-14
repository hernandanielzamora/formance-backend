export function requireAuth(req, res, next) {
  const firebase = req.app.locals.firebase;
  if (!firebase) return res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Autenticación no disponible.' } });
  const match = /^Bearer (\S+)$/.exec(req.get('Authorization') || '');
  if (!match) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Iniciá sesión para continuar.' } });
  firebase.auth.verifyIdToken(match[1], true).then((identity) => {
    req.identity = identity;
    next();
  }).catch((error) => {
    // No registrar el token ni el contenido de la credencial.
    console.error('Firebase token verification failed:', error.code || 'UNKNOWN_ERROR');
    const invalidSession = ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token', 'auth/user-disabled', 'auth/user-not-found', 'auth/argument-error'].includes(error.code);
    if (!invalidSession) return res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'No pudimos conectar con el servicio de autenticación. Intentá nuevamente.' } });
    return res.status(401).json({ error: { code: 'INVALID_SESSION', message: 'Tu sesión venció. Volvé a iniciar sesión.' } });
  });
}

export function requireAdmin(req, res, next) {
  if (req.identity?.admin !== true || req.identity?.email_verified !== true) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Acceso exclusivo para administradores.' } });
  }
  next();
}
