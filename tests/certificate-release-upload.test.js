'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const secret = 'test-release-token-at-least-thirty-two-chars';
let uploadOptions;
let uploadCalls;
let signedResult;
const previousSecret = process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
const previousStore = process.env.BLOB_STORE_ID;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@vercel/blob/client') return { handleUploadPresigned: async options => {
    uploadOptions = options;
    uploadCalls += 1;
    if (options.body?.type === 'blob.generate-presigned-url') {
      signedResult = await options.getSignedToken(options.body.payload.pathname, options.body.payload.clientPayload, options.body.payload.multipart);
    }
    return { accepted: true };
  } };
  if (request === '@vercel/blob') return {
    get: async () => ({}),
    head: async () => ({}),
    issueSignedToken: async options => { signedTokenOptions = options; return { delegationToken: 'synthetic', clientSigningToken: 'synthetic', validUntil: options.validUntil }; },
  };
  return originalLoad.call(this, request, parent, isMain);
};
process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN = secret;
process.env.BLOB_STORE_ID = 'store_synthetic';
const handler = require('../api/store-status');
Module._load = originalLoad;
test.after(() => {
  if (previousSecret === undefined) delete process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
  else process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN = previousSecret;
  if (previousStore === undefined) delete process.env.BLOB_STORE_ID;
  else process.env.BLOB_STORE_ID = previousStore;
});

let signedTokenOptions;

function response() {
  return {
    code: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(method, headers = {}, body = {}) { return { method, headers: { 'x-vercel-oidc-token': 'synthetic-oidc', ...headers }, body }; }

test('store status remains public without touching the uploader', async () => {
  uploadCalls = 0;
  const res = response();
  await handler(request('GET'), res);
  assert.equal(res.code, 200);
  assert.equal(typeof res.body.emailEnabled, 'boolean');
  assert.equal(uploadCalls, 0);
});

test('certificate release upload grants a presigned token only for the pinned private ZIP', async () => {
  uploadCalls = 0;
  const res = response();
  const body = { type: 'blob.generate-presigned-url', payload: { pathname: 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip', clientPayload: secret, multipart: true } };
  await handler(request('POST', {}, body), res);
  assert.equal(res.code, 200);
  assert.equal(uploadCalls, 1);
  assert.equal(signedTokenOptions.pathname, 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip');
  assert.deepEqual(signedTokenOptions.operations, ['put']);
  assert.equal(signedTokenOptions.oidcToken, 'synthetic-oidc');
  assert.equal(signedTokenOptions.storeId, 'store_synthetic');
  assert.deepEqual(signedResult.urlOptions.allowedContentTypes, ['application/zip']);
  assert.equal(signedResult.urlOptions.maximumSizeInBytes, 126638654);
  assert.equal(signedResult.urlOptions.addRandomSuffix, false);
  assert.equal(signedResult.urlOptions.allowOverwrite, false);
  assert.equal(signedResult.urlOptions.tokenPayload, JSON.stringify({ pathname: 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip', size: 126638654, sha256: 'da610514c0afea27c49edee17f6c44091c303b6c82814f823812269ba8398bf5' }));
  assert.deepEqual(uploadOptions.body, body);
});

test('certificate release upload denies a different pathname', async () => {
  const res = response();
  await handler(request('POST', {}, { type: 'blob.generate-presigned-url', payload: { pathname: 'other.zip', clientPayload: secret, multipart: true } }), res);
  assert.equal(res.code, 400);
});

test('certificate release upload rejects an incorrect one-time client credential', async () => {
  const res = response();
  await handler(request('POST', {}, { type: 'blob.generate-presigned-url', payload: { pathname: 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip', clientPayload: 'wrong-token', multipart: true } }), res);
  assert.equal(res.code, 401);
});

test('certificate release upload denies a missing temporary token', async () => {
  delete process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
  const res = response();
  await handler(request('POST'), res);
  assert.equal(res.code, 503);
});
