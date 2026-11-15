'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const handler = require('../api/rental-release-upload');

function response() {
  const result = { code: 200, headers: {}, body: undefined };
  return Object.assign(result, {
    setHeader(name, value) { result.headers[name] = value; },
    status(code) { result.code = code; return result; },
    json(value) { result.body = value; return result; }
  });
}

test('private rental package upload rejects a request without its temporary bearer secret', async t => {
  const previous = process.env.DRINKS_RELEASE_UPLOAD_TOKEN;
  delete process.env.DRINKS_RELEASE_UPLOAD_TOKEN;
  t.after(() => { if (previous !== undefined) process.env.DRINKS_RELEASE_UPLOAD_TOKEN = previous; });
  const res = response();
  const req = Object.assign(Readable.from([]), { method: 'POST', headers: {} });
  await handler(req, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'Release upload is unavailable.');
});

test('private rental package upload rejects an invalid bearer secret before reading content', async t => {
  const previous = process.env.DRINKS_RELEASE_UPLOAD_TOKEN;
  process.env.DRINKS_RELEASE_UPLOAD_TOKEN = 'test-release-token-abcdefghijklmnopqrstuvwxyz';
  t.after(() => { if (previous === undefined) delete process.env.DRINKS_RELEASE_UPLOAD_TOKEN; else process.env.DRINKS_RELEASE_UPLOAD_TOKEN = previous; });
  const res = response();
  const req = Object.assign(Readable.from([]), { method: 'POST', headers: { authorization: 'Bearer invalid', 'content-type': 'application/zip', 'content-length': '445394' } });
  await handler(req, res);
  assert.equal(res.code, 401);
  assert.equal(res.body.error, 'Unauthorized.');
});
