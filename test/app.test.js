import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

test('Configuración rechaza puertos/orígenes inválidos y producción sin Firebase', () => {
  assert.throws(() => parseEnv({ PORT: '-1' }));
  assert.throws(() => parseEnv({ FRONTEND_ORIGIN: 'https://example.com/path' }));
  assert.throws(() => parseEnv({ NODE_ENV: 'production' }));
});

test('API responde health, CORS, 404 y JSON inválido sin exponer detalles', async () => {
  const config = parseEnv({ NODE_ENV: 'test' });
  const server = createApp({ config }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/api/health`, { headers: { Origin: config.frontendOrigin } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), config.frontendOrigin);
    assert.equal(health.headers.get('x-powered-by'), null);
    assert.deepEqual(await health.json(), { service: 'formance-backend', status: 'ok' });
    const denied = await fetch(`${base}/api/health`, { headers: { Origin: 'https://untrusted.example' } });
    assert.notEqual(denied.headers.get('access-control-allow-origin'), 'https://untrusted.example');
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    const invalid = await fetch(`${base}/missing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_REQUEST');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
