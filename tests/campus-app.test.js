'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp, readConfig } = require('../campus/app');

test('isolated application enforces origin, request boundaries and no-store responses', async () => {
  const calls = [];
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp({ origin, productName: 'Synthetic Campus' }, {
    auth: { login: async body => { calls.push(body); return { status: 401, error: 'Sign-in failed' }; }, logout: async () => ({ status: 200, data: 1 }) },
    gateway: async (...args) => { calls.push(args); return { status: 200, data: 1 }; }
  }));
  try {
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('cache-control'), 'no-store');
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await home.text(), /Staff sign in/);
    const post = (path, body, originHeader = origin) => fetch(`${origin}${path}`, { method: 'POST', headers: { Origin: originHeader, 'Content-Type': 'application/json' }, body });
    assert.equal((await post('/api/login', '{}', 'https://other.invalid')).status, 403);
    assert.equal((await post('/api/login', '{')).status, 400);
    assert.equal((await post('/api/login', JSON.stringify({ x: 'a'.repeat(262145) }))).status, 413);
    assert.equal((await fetch(`${origin}/api/action`)).status, 405);
    assert.equal((await fetch(`${origin}/migrations/001_ledger.sql`)).status, 404);
    assert.equal((await post('/api/action', JSON.stringify({ action: 'transition', payload: {}, actor_id: 'spoof' }))).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await post('/api/login', JSON.stringify({ email: 'synthetic@example.invalid', password: 'incorrect' }))).status, 401);
    assert.deepEqual(calls, [{ email: 'synthetic@example.invalid', password: 'incorrect' }]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('configuration rejects incomplete projects and ambiguous application origins', () => {
  assert.throws(() => readConfig({}), /Campus configuration/);
  const env = { CAMPUS_SUPABASE_URL: 'https://synthetic.supabase.co', CAMPUS_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', CAMPUS_ORIGIN: 'http://127.0.0.1:8787', CAMPUS_PORT: '8787', CAMPUS_PRODUCT_NAME: 'Synthetic Campus' };
  assert.equal(readConfig(env).port, 8787);
  assert.throws(() => readConfig({ ...env, CAMPUS_ORIGIN: 'http://example.com' }), /Campus configuration/);
  assert.throws(() => readConfig({ ...env, CAMPUS_PORT: '87.5' }), /Campus configuration/);
});
