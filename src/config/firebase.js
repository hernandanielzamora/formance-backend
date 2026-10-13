import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

export function createFirebase(projectId) {
  if (!projectId) return null;
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath && !existsSync(credentialPath)) {
    console.error('Firebase pendiente: no existe el archivo indicado por GOOGLE_APPLICATION_CREDENTIALS.');
    return null;
  }
  const app = getApps().find((item) => item.name === 'formance') || initializeApp({
    credential: applicationDefault(),
    projectId,
  }, 'formance');
  return { auth: getAuth(app), db: getFirestore(app) };
}
