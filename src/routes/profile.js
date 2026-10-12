import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateOnboarding, calculateTargets } from '../services/onboarding.js';

export const profileRoutes = Router();
profileRoutes.use(requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.identity.email_verified !== true) return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu correo para continuar.' } });
  next();
});
profileRoutes.get('/', async (req, res) => {
  const snapshot = await req.app.locals.firebase.db.collection('users').doc(req.identity.uid).get();
  res.json({ profile: snapshot.exists ? snapshot.data() : null });
});
profileRoutes.post('/onboarding/preview', (req, res) => {
  try { res.json(calculateTargets(validateOnboarding(req.body))); }
  catch (error) { res.status(400).json({ error: { code: 'INVALID_PROFILE', message: error.message } }); }
});
profileRoutes.put('/onboarding', async (req, res) => {
  let input;
  try { input = validateOnboarding(req.body, true); }
  catch (error) { return res.status(400).json({ error: { code: 'INVALID_PROFILE', message: error.message } }); }
  const { targets: customTargets, ...personal } = input;
  const reference = calculateTargets(personal);
  const { calories, protein, fat, carbohydrates } = reference;
  const now = new Date().toISOString();
  const profile = { ...personal, reference, targets: customTargets || { calories, protein, fat, carbohydrates }, onboardingCompleted: true, createdAt: now, updatedAt: now };
  const db = req.app.locals.firebase.db;
  const userRef = db.collection('users').doc(req.identity.uid);
  const saved = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(userRef);
    if (existing.exists && existing.data().onboardingCompleted) return false;
    transaction.set(userRef, profile);
    transaction.set(userRef.collection('weightMeasurements').doc('initial'), { weightKg: personal.initialWeightKg, recordedAt: now, source: 'onboarding' });
    return true;
  });
  if (!saved) return res.status(409).json({ error: { code: 'ONBOARDING_COMPLETED', message: 'Tu perfil ya está configurado.' } });
  res.json({ profile });
});
