import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { buildWeeklyReport, weeklyRange } from '../services/reports.js';
import { readWeights } from '../services/weight.js';
import { fields } from '../services/training-sessions.js';
import { canRead } from '../services/training.js';
import { analyzeWeeklyReport } from '../services/weekly-analysis.js';
import { weeklyGlance } from '../services/weekly-glance.js';
export const reportRoutes = Router();
reportRoutes.use(requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.identity.email_verified !== true) return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu correo para continuar.' } }); next();
});
async function loadReport(req, input) {
  const range = weeklyRange(input); const user = req.app.locals.firebase.db.collection('users').doc(req.identity.uid);
  async function read(collection, max) {
    const snapshot = await user.collection(collection).where('localDate', '>=', range.previousFrom).where('localDate', '<=', range.through).limit(max + 1).get();
    if (snapshot.docs.length > max) { const error = new Error('Hay demasiados registros para este reporte. No se muestran totales parciales.'); error.status = 400; throw error; }
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  }
  const [sessions, meals, weight, profile, settings] = await Promise.all([read('trainingSessions', 2000), read('foodLogs', 5000), readWeights(user, range.previousFrom, range.through, range.timeZone),
    user.get(), user.collection('settings').doc('training').get()]);
  const report = buildWeeklyReport(range, sessions, meals, weight.measurements);
  const activeId = settings.exists ? settings.data().activeRoutineId : null;
  const routineDoc = typeof activeId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(activeId) ? await req.app.locals.firebase.db.collection('routines').doc(activeId).get() : null;
  const routine = routineDoc?.exists && canRead(req.identity, routineDoc.data()) ? routineDoc.data() : null;
  const context = { goal: profile.exists ? profile.data().goal ?? null : null, targets: profile.exists ? profile.data().targets ?? null : null };
  return { ...report, glance: weeklyGlance(report, { ...context, routine }), context };
}
reportRoutes.get('/weekly', async (req, res) => {
  const { context: _context, ...report } = await loadReport(req, req.query);
  res.json(report);
});
reportRoutes.post('/weekly-analysis', async (req, res) => {
  fields(req.body, ['weekStart', 'timeZone']);
  const { context, ...report } = await loadReport(req, req.body);
  res.json(await analyzeWeeklyReport({ db: req.app.locals.firebase.db, uid: req.identity.uid,
    config: req.app.locals.config, report, context, fetcher: req.app.locals.weeklyAnalysisFetch || fetch }));
});
