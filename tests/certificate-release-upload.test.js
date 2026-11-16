'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const secret = 'test-release-token-at-least-thirty-two-chars';
let uploadOptions;
let uploadCalls;
const previousSecret = process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@vercel/blob/client') return { handleUpload: async options => {
    uploadOptions = options;
    uploadCalls += 1;
    if (options.body?.phase === 'token') await options.onBeforeGenerateToken(options.body.pathname, options.body.clientPayload);
    return { accepted: true };
  } };
  if (request === '@vercel/blob') return { get: async () => ({}), head: async () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};
process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN = secret;
const handler = require('../api/store-status');
Module._load = originalLoad;
test.after(() => {
  if (previousSecret === undefined) delete process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
  else process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN = previousSecret;
});

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

function request(method, headers = {}, body = {}) { return { method, headers, body }; }

test('store status remains public without touching the uploader', async () => {
  uploadCalls = 0;
  const res = response();
  await handler(request('GET'), res);
  assert.equal(res.code, 200);
  assert.equal(typeof res.body.emailEnabled, 'boolean');
  assert.equal(uploadCalls, 0);
});

test('certificate release upload grants a token only for the pinned private ZIP', async () => {
  uploadCalls = 0;
  const res = response();
  await handler(request('POST', {}, { phase: 'token', pathname: 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip', clientPayload: secret }), res);
  assert.equal(res.code, 200);
  assert.equal(uploadCalls, 1);
  const options = await uploadOptions.onBeforeGenerateToken(uploadOptions.body.pathname, uploadOptions.body.clientPayload);
  assert.deepEqual(options.allowedContentTypes, ['application/zip']);
  assert.equal(options.maximumSizeInBytes, 126638654);
  assert.equal(options.addRandomSuffix, false);
  assert.equal(options.tokenPayload, JSON.stringify({ pathname: 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip', size: 126638654, sha256: 'da610514c0afea27c49edee17f6c44091c303b6c82814f823812269ba8398bf5' }));
});

test('certificate release upload denies a different pathname', async () => {
  const res = response();
  await handler(request('POST', {}, { phase: 'token', pathname: 'other.zip', clientPayload: secret }), res);
  assert.equal(res.code, 400);
});

test('certificate release upload rejects an incorrect one-time client credential', async () => {
  const res = response();
  await handler(request('POST', {}, { phase: 'token', pathname: 'training-certificate-generator/v1.2.0/training-certificate-generator-v1.2.0-customer.zip', clientPayload: 'wrong-token' }), res);
  assert.equal(res.code, 401);
});

test('certificate release upload denies a missing temporary token', async () => {
  delete process.env.CERTIFICATE_RELEASE_UPLOAD_TOKEN;
  const res = response();
  await handler(request('POST'), res);
  assert.equal(res.code, 503);
});
