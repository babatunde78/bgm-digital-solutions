'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGateway, createAuthAdapter } = require('../campus/server');
const uuid = '00000000-0000-4000-8000-000000000001';
const payload = { institution_id: uuid, journal_id: uuid, expected_version: 1, target: 'submitted' };
test('gateway verifies identity before forwarding the same bearer token to the isolated schema', async () => {
  const calls = [];
  const gateway = createGateway({ url: 'https://synthetic.supabase.co', publishableKey: 'sb_publishable_synthetic' }, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(JSON.stringify({ id: uuid })) : new Response('2');
  });
  assert.deepEqual(await gateway('Bearer synthetic-user-token', 'transition', payload), { status: 200, data: 2 });
  assert.deepEqual(calls.map(call => call.url), ['https://synthetic.supabase.co/auth/v1/user', 'https://synthetic.supabase.co/rest/v1/rpc/transition_journal']);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-user-token');
  assert.equal(calls[1].options.headers['Content-Profile'], 'campus');
  assert.deepEqual(JSON.parse(calls[1].options.body), { tenant: uuid, journal: uuid, expected_version: 1, target: 'submitted' });
});
test('gateway rejects actor overrides, invalid identities and expired credentials without executing a financial RPC', async () => {
  for (const response of [new Response('{}'), new Response('{}', { status: 401 })]) {
    let count = 0;
    const gateway = createGateway({ url: 'https://synthetic.supabase.co', publishableKey: 'sb_publishable_synthetic' }, async () => { count++; return response; });
    assert.deepEqual(await gateway('Bearer synthetic', 'transition', payload), { status: 401, error: 'Authentication required' });
    assert.equal(count, 1);
    assert.deepEqual(await gateway('Bearer synthetic', 'transition', { ...payload, actor_id: uuid }), { status: 400, error: 'Invalid request' });
    assert.equal(count, 1);
  }
});
test('gateway maps conflicts and permission failures without exposing upstream content', async () => {
  for (const [code, expected] of [['40001', 409], ['23505', 409], ['42501', 403], ['23503', 422]]) {
    let count = 0;
    const gateway = createGateway({ url: 'https://synthetic.supabase.co', publishableKey: 'sb_publishable_synthetic' }, async () => {
      count++;
      return count === 1 ? new Response(JSON.stringify({ id: uuid })) : new Response(JSON.stringify({ code, message: 'private financial data' }), { status: 400 });
    });
    assert.deepEqual(await gateway('Bearer synthetic', 'transition', payload), { status: expected, error: 'Journal request rejected' });
  }
});
test('login drops refresh tokens and logout requests only the current provider session', async () => {
  const calls = [];
  const auth = createAuthAdapter({ url: 'https://synthetic.supabase.co', publishableKey: 'sb_publishable_synthetic' }, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(JSON.stringify({ user: { id: uuid }, access_token: 'synthetic.token', refresh_token: 'never-return-this', expires_in: 3600 })) : new Response(null, { status: 204 });
  });
  assert.deepEqual(await auth.login({ email: 'synthetic@example.invalid', password: 'synthetic-password' }), { status: 200, data: { access_token: 'synthetic.token', expires_in: 3600 } });
  assert.deepEqual(await auth.logout('Bearer synthetic.token'), { status: 200, data: 1 });
  assert.equal(calls[0].url, 'https://synthetic.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(calls[1].url, 'https://synthetic.supabase.co/auth/v1/logout?scope=local');
});
test('new gateway operations validate their boundaries and identity before RPC execution', async () => {
  for (const [action, payload, procedure] of [
    ['provision', { institution_id: uuid, legal_name: 'Synthetic Campus', currency: 'NGN', administrator_id: uuid }, 'provision_institution'],
    ['member', { institution_id: uuid, user_id: uuid, role: 'reviewer', active: true }, 'set_member'],
    ['reverse', { institution_id: uuid, original_id: uuid, expected_version: 5, journal_id: uuid, period_id: uuid, document_date: '2026-11-09', reason: 'Synthetic correction' }, 'reverse_journal']
  ]) {
    const calls = [];
    const gateway = createGateway({ url: 'https://synthetic.supabase.co', publishableKey: 'sb_publishable_synthetic' }, async (url) => {
      calls.push(url); return new Response(calls.length === 1 ? JSON.stringify({ id: uuid }) : '1');
    });
    assert.deepEqual(await gateway('Bearer synthetic', action, payload), { status: 200, data: 1 });
    assert.equal(calls[1], `https://synthetic.supabase.co/rest/v1/rpc/${procedure}`);
    assert.deepEqual(await gateway('Bearer synthetic', action, { ...payload, actor_id: uuid }), { status: 400, error: 'Invalid request' });
    assert.equal(calls.length, 2);
  }
});
test('authentication failures are generic and invalid credentials never contact the provider', async () => {
  let count = 0;
  const auth = createAuthAdapter({ url: 'https://synthetic.supabase.co', publishableKey: 'sb_publishable_synthetic' }, async () => {
    count++; return new Response(JSON.stringify({ message: 'private upstream details' }), { status: 400 });
  });
  assert.deepEqual(await auth.login({ email: 'invalid', password: 'synthetic' }), { status: 400, error: 'Invalid sign-in request' });
  assert.equal(count, 0);
  assert.deepEqual(await auth.login({ email: 'synthetic@example.invalid', password: 'incorrect' }), { status: 401, error: 'Sign-in failed' });
  assert.equal(count, 1);
});
test('context and schedule validate upstream shapes and refuse combined accounting bases', async () => {
  let count = 0;
  const gateway = createGateway({ url: 'https://synthetic.supabase.co', publishableKey: 'sb_publishable_synthetic' }, async () => {
    count++; return new Response(count % 2 ? JSON.stringify({ id: uuid }) : JSON.stringify({ platform_administrator: true, institutions: [], unexpected: true }));
  });
  assert.deepEqual(await gateway('Bearer synthetic', 'schedule', { institution_id: uuid, basis: 'both' }), { status: 400, error: 'Invalid request' });
  assert.equal(count, 0);
  assert.deepEqual(await gateway('Bearer synthetic', 'context', {}), { status: 502, error: 'Invalid service response' });
  assert.equal(count, 2);
});
test('configuration gateway validates commands before forwarding approved user identity', async () => {
  for (const [action, payload, procedure] of [
    ['account', { institution_id: uuid, account_id: uuid, code: '0010', name: 'Synthetic cash', account_type: 'asset' }, 'create_account'],
    ['period', { institution_id: uuid, period_id: uuid, starts_on: '2026-01-01', ends_on: '2026-12-31' }, 'create_period'],
    ['policy', { institution_id: uuid, policy_id: uuid, basis: 'cash', effective_from: '2026-01-01', narrative: 'Synthetic narrative', mappings: [{ key: 'cash', account_id: uuid }] }, 'propose_policy'],
    ['approve_policy', { institution_id: uuid, policy_id: uuid }, 'approve_policy'],
    ['lock_period', { institution_id: uuid, period_id: uuid, expected_version: 1 }, 'lock_period']
  ]) {
    const calls = [];
    const gateway = createGateway({ url: 'https://synthetic.supabase.co', publishableKey: 'sb_publishable_synthetic' }, async (url) => {
      calls.push(url); return new Response(calls.length === 1 ? JSON.stringify({ id: uuid }) : '1');
    });
    assert.deepEqual(await gateway('Bearer synthetic', action, payload), { status: 200, data: 1 });
    assert.equal(calls[1], `https://synthetic.supabase.co/rest/v1/rpc/${procedure}`);
    assert.deepEqual(await gateway('Bearer synthetic', action, { ...payload, actor_id: uuid }), { status: 400, error: 'Invalid request' });
  }
});
