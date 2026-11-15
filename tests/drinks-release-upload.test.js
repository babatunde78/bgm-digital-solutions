'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const blob = require('@vercel/blob');
const handler = require('../api/drinks-release-upload');

function response() {
  const result = { code: 200, headers: {}, body: undefined };
  return Object.assign(result, {
    setHeader(name, value) { result.headers[name] = value; },
    status(code) { result.code = code; return result; },
    json(value) { result.body = value; return result; }
  });
}

test('private drink-package upload rejects a request without its temporary bearer secret', async () => {
  const previous = process.env.DRINKS_RELEASE_UPLOAD_TOKEN;
  delete process.env.DRINKS_RELEASE_UPLOAD_TOKEN;
  const res = response();
  const req = Object.assign(Readable.from([]), { method: 'POST', headers: {} });
  await handler(req, res);
  if (previous !== undefined) process.env.DRINKS_RELEASE_UPLOAD_TOKEN = previous;
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'Release upload is unavailable.');
});

test('private drink-package upload stores only the approved ZIP and verifies read-back', async t => {
  const bytes = fs.readFileSync(path.resolve(__dirname, '../../wholesaler-stock-credit-containers/v1/BGM-Drinks-Stock-Customer-Book-v1.0.0.zip'));
  const previous = process.env.DRINKS_RELEASE_UPLOAD_TOKEN;
  process.env.DRINKS_RELEASE_UPLOAD_TOKEN = 'test-release-token-abcdefghijklmnopqrstuvwxyz';
  t.after(() => { if (previous === undefined) delete process.env.DRINKS_RELEASE_UPLOAD_TOKEN; else process.env.DRINKS_RELEASE_UPLOAD_TOKEN = previous; });
  let puts = 0, heads = 0;
  t.mock.method(blob, 'head', async () => {
    heads++;
    if (heads === 1) throw new blob.BlobNotFoundError('not found');
    return { url: 'https://test.private.blob.vercel-storage.com/drinks-stock-customer-book/v1.0.0/drinks-stock-customer-book-v1.0.0-customer.zip', size: bytes.length };
  });
  t.mock.method(blob, 'put', async (_pathname, content, options) => {
    puts++;
    assert.equal(Buffer.from(content).compare(bytes), 0);
    assert.equal(options.access, 'private');
    assert.equal(options.allowOverwrite, false);
  });
  t.mock.method(blob, 'get', async () => ({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) }));
  const req = Object.assign(Readable.from([bytes]), { method: 'POST', headers: {
    authorization: 'Bearer test-release-token-abcdefghijklmnopqrstuvwxyz',
    'content-type': 'application/zip', 'content-length': String(bytes.length)
  } });
  const res = response();
  await handler(req, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { uploaded: true, verified: true, bytes: bytes.length, sha256: '614e6b1c20e3c1d1a2ea9152df02be6eacdd1043e7dff63dc3e86168af2b9441' });
  assert.equal(puts, 1);
});
