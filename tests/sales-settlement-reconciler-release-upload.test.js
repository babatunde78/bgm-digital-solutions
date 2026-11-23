'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const secret = 'temporary-sales-v020-release-token-abcdefghijklmnopqrstuvwxyz';
const previousSecret = process.env.SALES_RECONCILER_RELEASE_UPLOAD_TOKEN;
const previousStore = process.env.BLOB_STORE_ID;
const originalLoad = Module._load;
let signedOptions;
Module._load = function (request, parent, isMain) {
  if (request === '@vercel/blob/client') return { handleUploadPresigned: async options => {
    await options.getSignedToken(options.body?.payload?.pathname, options.body?.payload?.clientPayload);
  } };
  if (request === '@vercel/blob') return {
    get: async () => ({}), head: async () => ({}),
    issueSignedToken: async options => { signedOptions = options; return { delegationToken: 'synthetic' }; },
  };
  return originalLoad.call(this, request, parent, isMain);
};
process.env.SALES_RECONCILER_RELEASE_UPLOAD_TOKEN = secret;
process.env.BLOB_STORE_ID = 'store_synthetic';
const handler = require('../api/store-status');
Module._load = originalLoad;
after(() => {
  if (previousSecret === undefined) delete process.env.SALES_RECONCILER_RELEASE_UPLOAD_TOKEN;
  else process.env.SALES_RECONCILER_RELEASE_UPLOAD_TOKEN = previousSecret;
  if (previousStore === undefined) delete process.env.BLOB_STORE_ID;
  else process.env.BLOB_STORE_ID = previousStore;
});

function response() { return { code: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } }; }
function request(method, headers = {}, body = {}) { return { method, headers: { 'x-vercel-oidc-token': 'synthetic-oidc', authorization: `Bearer ${secret}`, ...headers }, body }; }

test('upload token only authorizes the pinned private v0.2.0 package path', async () => {
  const res = response();
  const pathname = 'sales-settlement-reconciler/v0.2.0/sales-settlement-reconciler-v0.2.0-customer.zip';
  await handler(request('POST', {}, { type: 'blob.generate-presigned-url', payload: { pathname, clientPayload: secret, multipart: true } }), res);
  assert.equal(res.code, 200);
  assert.equal(signedOptions.pathname, pathname);
  assert.equal(signedOptions.storeId, 'store_synthetic');
  assert.deepEqual(signedOptions.operations, ['put']);
  assert.equal(signedOptions.maximumSizeInBytes, 47931);
});

test('upload rejects a wrong token and any other pathname', async () => {
  const wrong = response();
  await handler(request('POST', { authorization: 'Bearer wrong' }, { type: 'blob.generate-presigned-url', payload: { pathname: 'other.zip', clientPayload: 'wrong', multipart: true } }), wrong);
  assert.equal(wrong.code, 401);
  const other = response();
  await handler(request('POST', {}, { type: 'blob.generate-presigned-url', payload: { pathname: 'other.zip', clientPayload: secret, multipart: true } }), other);
  assert.equal(other.code, 400);
});
