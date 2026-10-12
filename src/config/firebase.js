import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export function createFirebase(projectId) {
  if (!projectId) return null;
  const app = getApps().find((item) => item.name === 'formance') || initializeApp({
    credential: applicationDefault(),
    projectId,
  }, 'formance');
  return { auth: getAuth(app), db: getFirestore(app) };
}
