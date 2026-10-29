import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from '../src/config/env.js';
import { createFirebase } from '../src/config/firebase.js';
const { identity } = JSON.parse(readFileSync('../formance-frontend/.auth/e4-inspection.json', 'utf8'));
const receipt = JSON.parse(readFileSync('../formance-frontend/.auth/e4-receipt.json', 'utf8'));
const firebase = createFirebase(parseEnv().firebaseProjectId);
if (!firebase) throw new Error('Firebase no configurado.');
try {
  const user = firebase.db.collection('users').doc(identity.uid);
  const day = new Date().toISOString().slice(0, 10);
  const [photoUsage, weeklyUsage, analyses, photo, meal] = await Promise.all([
    user.collection('foodAnalysisUsage').doc(day).get(),
    user.collection('weeklyAnalysisUsage').doc(receipt.week).get(),
    user.collection('weeklyAnalyses').get(),
    user.collection('foodAnalyses').doc(receipt.photoAnalysisId).get(),
    user.collection('foodLogs').doc(receipt.photoMealId).get(),
  ]);
  const summary = { firestoreVerified: true, authVerified: true, week: receipt.week,
    photoUsageToday: photoUsage.data()?.count || 0, weeklyUsageForDemoWeek: weeklyUsage.data()?.count || 0,
    photoReady: photo.data()?.status === 'ready', photoMealSaved: meal.exists && meal.data().items.some(item => item.source === 'gemini'),
    photoMarkedSimulated: meal.exists && meal.data().note.includes('[DEMO SIMULADA E4]'),
    weeklyReady: analyses.docs.some(doc => doc.data().fingerprint === receipt.fingerprint && doc.data().status === 'ready'),
    cacheVerifiedInBrowser: receipt.cacheVerified === true,
    newPhotoAttempts: receipt.newPhotoGenerations, newWeeklyAttempts: receipt.newWeeklyGenerations };
  if (!summary.photoReady || !summary.photoMealSaved || !summary.weeklyReady || !summary.cacheVerifiedInBrowser) throw new Error('La evidencia remota no está completa.');
  writeFileSync('../formance-frontend/docs/e4/verification.json', JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} finally { await firebase.db.terminate(); }
