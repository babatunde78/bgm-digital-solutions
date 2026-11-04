'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');
test('operator inventory paginates Blob files and excludes permanent URLs', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';
  global.fetch = async () => new Response(JSON.stringify([{ id: 'guide', status: 'draft' }]));
  const calls = [];
  t.mock.method(storage, 'list', async cursor => {
    calls.push(cursor);
    return cursor ? { blobs: [{ pathname: 'private/second.zip', size: 200, url: 'must-not-be-returned' }], hasMore: false } :
      { blobs: [{ pathname: 'private/first.zip', size: 100, downloadUrl: 'must-not-be-returned' }], hasMore: true, cursor: 'page-2' };
  });
  const result = await require('../lib/inventory').inventory();
  assert.deepEqual(calls, [undefined, 'page-2']);
  assert.equal(result.complete, true);
  assert.deepEqual(result.files, [{ pathname: 'private/first.zip', size: 100 }, { pathname: 'private/second.zip', size: 200 }]);
});
