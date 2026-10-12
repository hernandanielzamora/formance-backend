import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { profileRoutes } from './routes/profile.js';

export function createApp({ config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigin, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ service: 'formance-backend', status: 'ok' });
  });
  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const identity = req.identity;
    res.json({ uid: identity.uid, email: identity.email || null, name: identity.name || null,
      emailVerified: identity.email_verified === true,
      role: identity.admin === true && identity.email_verified === true ? 'admin' : 'user' });
  });
  app.get('/api/admin/session', requireAuth, requireAdmin, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ authorized: true });
  });
  app.use('/api/profile', profileRoutes);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado.' } }));
  app.use((error, _req, res, _next) => {
    const status = error.status === 400 ? 400 : error.status === 413 ? 413 : 500;
    if (status === 500) console.error('Error interno:', error.message);
    res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST', message: status === 500 ? 'Error interno del servidor.' : 'Solicitud inválida.' } });
  });
  return app;
}
