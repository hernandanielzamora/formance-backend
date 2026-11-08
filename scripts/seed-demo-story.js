import { parseArgs } from 'node:util';
import { parseEnv } from '../src/config/env.js';
import { createFirebase } from '../src/config/firebase.js';
import { applyDemoStory } from './lib/demo-story-apply.js';

const { values } = parseArgs({ options: {
  uid: { type: 'string' }, email: { type: 'string' }, from: { type: 'string', default: '2026-10-01' }, to: { type: 'string', default: '2026-11-11' },
  'time-zone': { type: 'string', default: 'America/Argentina/Buenos_Aires' }, apply: { type: 'boolean', default: false },
} });
if (!values.uid || !values.email) throw new Error('Indicar --uid y --email; --apply habilita la escritura.');
const firebase = createFirebase(parseEnv().firebaseProjectId);
if (!firebase) throw new Error('Configurar Firebase de Formance.');
const timeout = setTimeout(() => { console.error('Operación demorada. Ejecutar de nuevo: el proceso es idempotente.'); process.exit(1); }, 180_000);
try {
  const account = await firebase.auth.getUser(values.uid);
  if (account.email?.toLowerCase() !== values.email.toLowerCase() || account.disabled || !account.emailVerified) throw new Error('Email/UID no coinciden o la cuenta no está activa y verificada. No se escribió nada.');
  const result = await applyDemoStory({ db: firebase.db, uid: values.uid, from: values.from, to: values.to, zone: values['time-zone'], apply: values.apply });
  console.log(JSON.stringify({ mode: values.apply ? 'aplicado' : 'simulación sin escrituras', ...result }, null, 2));
} finally { clearTimeout(timeout); await firebase.db.terminate(); }
