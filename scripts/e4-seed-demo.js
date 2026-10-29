import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const inspection = '../formance-frontend/.auth/e4-inspection.json';
if (!existsSync(inspection)) throw new Error('Primero ejecutar inspección autenticada E4.');
const { identity } = JSON.parse(readFileSync(inspection, 'utf8'));
if (!identity.emailVerified || !identity.uid || !identity.email) throw new Error('Se requiere sesión real verificada.');
const args = ['scripts/seed-study-data.js', '--uid', identity.uid, '--email', identity.email,
  '--from', '2026-09-28', '--to', '2026-10-11'];
const dry = spawnSync(process.execPath, args, { encoding: 'utf8' });
if (dry.status !== 0) throw new Error('Dry-run falló; no se aplicaron datos. Revisar credenciales o permisos.');
const plan = JSON.parse(dry.stdout);
console.log(JSON.stringify({ stage: 'dry-run', alreadyApplied: !!plan.alreadyApplied, added: plan.added, skipped: plan.skipped }));
if (process.argv.includes('--apply') && !plan.alreadyApplied) {
  const applied = spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8' });
  if (applied.status !== 0) throw new Error('La carga no confirmó éxito. Verificar manifiesto antes de reintentar.');
  const result = JSON.parse(applied.stdout);
  console.log(JSON.stringify({ stage: 'applied', added: result.added, simulated: result.simulated }));
}
