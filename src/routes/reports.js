import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { buildWeeklyReport, weeklyRange } from '../services/reports.js';
import { readWeights } from '../services/weight.js';
export const reportRoutes = Router();
reportRoutes.use(requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.identity.email_verified !== true) return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu correo para continuar.' } }); next();
});
reportRoutes.get('/weekly', async (req, res) => {
  const range = weeklyRange(req.query); const user = req.app.locals.firebase.db.collection('users').doc(req.identity.uid);
  async function read(collection, max) {
    const snapshot = await user.collection(collection).where('localDate', '>=', range.previousFrom).where('localDate', '<=', range.through).limit(max + 1).get();
    if (snapshot.docs.length > max) { const error = new Error('Hay demasiados registros para este reporte. No se muestran totales parciales.'); error.status = 400; throw error; }
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  }
  const [sessions, meals, weight] = await Promise.all([read('trainingSessions', 2000), read('foodLogs', 5000), readWeights(user, range.previousFrom, range.through, range.timeZone)]);
  res.json(buildWeeklyReport(range, sessions, meals, weight.measurements));
});
