'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const secret = 'temporary-client-pack-release-token-abcdefghijklmnopqrstuvwxyz';
const previousSecret = process.env.CLIENT_PACK_RELEASE_UPLOAD_TOKEN;
const previousStore = process.env.BLOB_STORE_ID;
const originalLoad = Module._load;
let signedOptions;
Module._load = function (request, parent, isMain) {
  if (request === '@vercel/blob/client') return { handleUploadPresigned: async options => {
    if (options.body?.type === 'blob.generate-presigned-url') await options.getSignedToken(options.body.payload.pathname, options.body.payload.clientPayload);
    return { accepted: true };
  } };
  if (request === '@vercel/blob') return {
    get: async () => ({}), head: async () => ({}),
    issueSignedToken: async options => { signedOptions = options; return { token: 'synthetic' }; },
  };
  return originalLoad.call(this, request, parent, isMain);
};
process.env.CLIENT_PACK_RELEASE_UPLOAD_TOKEN = secret;
process.env.BLOB_STORE_ID = 'store_synthetic';
delete require.cache[require.resolve('../api/store-status')];
const handler = require('../api/store-status');
Module._load = originalLoad;
after(() => {
  if (previousSecret === undefined) delete process.env.CLIENT_PACK_RELEASE_UPLOAD_TOKEN;
  else process.env.CLIENT_PACK_RELEASE_UPLOAD_TOKEN = previousSecret;
  if (previousStore === undefined) delete process.env.BLOB_STORE_ID;
  else process.env.BLOB_STORE_ID = previousStore;
});

function response() {
  return { code: 200, headers: {}, body: undefined, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
}
function request(method, headers = {}, body = {}) {
  return { method, headers: { 'x-vercel-oidc-token': 'synthetic-oidc', authorization: `Bearer ${secret}`, ...headers }, body };
}

test('upload signs only the checksum-pinned Client Pack Assembler private path', async () => {
  const res = response();
  const pathname = 'client-pack-assembler/v0.1.0/bgm-client-pack-assembler-v0.1.0-customer.zip';
  await handler(request('POST', {}, { type: 'blob.generate-presigned-url', payload: { pathname, clientPayload: secret, multipart: true } }), res);
  assert.equal(res.code, 200);
  assert.equal(signedOptions.pathname, pathname);
  assert.equal(signedOptions.storeId, 'store_synthetic');
  assert.deepEqual(signedOptions.operations, ['put']);
  assert.equal(signedOptions.maximumSizeInBytes, 125440135);
});

test('upload rejects incorrect credentials and every other pathname', async () => {
  const wrong = response();
  await handler(request('POST', { authorization: 'Bearer wrong' }, { type: 'blob.generate-presigned-url', payload: { pathname: 'other.zip', clientPayload: 'wrong', multipart: true } }), wrong);
  assert.equal(wrong.code, 401);
  const other = response();
  await handler(request('POST', {}, { type: 'blob.generate-presigned-url', payload: { pathname: 'other.zip', clientPayload: secret, multipart: true } }), other);
  assert.equal(other.code, 400);
});

test('authenticated diagnostics expose only OIDC and store availability booleans', async () => {
  const res = response();
  await handler(request('GET', { 'x-client-pack-preflight': '1' }), res);
  assert.deepEqual(res.body, { oidcHeaderPresent: true, storeIdPresent: true });
});
