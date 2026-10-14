import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

test('Identidad verificada, revocación y permisos admin controlados por el servidor', async () => {
  const app = createApp({ config: parseEnv({ NODE_ENV: 'test' }) });
  const identities = {
    user: { uid: 'user-1', email: 'user@example.com', email_verified: true },
    admin: { uid: 'admin-1', email: 'admin@example.com', email_verified: true, admin: true },
    unverified: { uid: 'admin-2', email_verified: false, admin: true },
  };
  app.locals.firebase = { auth: { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (token === 'outage') throw { code: 'app/network-error' };
    if (!identities[token]) throw { code: 'auth/id-token-revoked' };
    return identities[token];
  } } };
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, token) => fetch(`${base}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await request('auth/me')).status, 401);
    assert.equal((await request('auth/me', 'revoked')).status, 401);
    assert.equal((await request('auth/me', 'outage')).status, 503);
    assert.equal((await (await request('auth/me', 'user')).json()).role, 'user');
    assert.equal((await request('admin/session', 'user')).status, 403);
    assert.equal((await request('admin/session', 'unverified')).status, 403);
    assert.equal((await request('admin/session', 'admin')).status, 200);
    assert.equal((await (await request('auth/me', 'admin')).json()).role, 'admin');
    const forged = await fetch(`${base}/admin/session`, { headers: { Authorization: 'Bearer user', 'X-Role': 'admin' } });
    assert.equal(forged.status, 403);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
