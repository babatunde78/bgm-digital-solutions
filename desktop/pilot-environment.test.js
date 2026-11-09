'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const environment = require('./pilot-environment');
test('pilot environment passes Windows basics without inherited secrets or Node injection', () => {
  const original = { Path: 'synthetic-runtime-path', SYSTEMROOT: 'synthetic-windows', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-secret', VERCEL_TOKEN: 'synthetic-secret', CUSTOM_UNKNOWN_SECRET: 'synthetic-secret', NODE_OPTIONS: '--require=synthetic.js', LOCALAPPDATA: 'normal-profile' };
  assert.deepEqual(environment('isolated-profile', original), { Path: 'synthetic-runtime-path', SYSTEMROOT: 'synthetic-windows', LOCALAPPDATA: 'isolated-profile' });
  assert.equal(original.LOCALAPPDATA, 'normal-profile');
});
