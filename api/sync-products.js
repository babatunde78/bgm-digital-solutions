'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const { BlobNotFoundError, get, head, put } = require('@vercel/blob');
const { endpoint, equal, HttpError } = require('../lib/http');
const { importProducts } = require('../lib/product-import');
const filePath = 'social-seller-bookkeeping/v1.0.0/social-seller-bookkeeping-v1.0.0-customer.zip';
const expectedHash = 'fe84d4648df9d4780daf1e704794834b766064b56f5df48b3b7587c605e65b9e';
const expectedSize = 136027;

function validUploadToken(value) {
  const expected = process.env.SOCIAL_SELLER_RELEASE_UPLOAD_TOKEN || '';
  const actual = Buffer.from(value || '');
  const target = Buffer.from(expected);
  return expected.length >= 32 && actual.length === target.length && timingSafeEqual(actual, target);
}

async function readInput(req) {
  const contentType = String(req.headers['content-type'] || '');
  const upload = contentType.startsWith('application/octet-stream');
  const limit = upload ? expectedSize : 4096;
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    parts.push(part);
  }
  const buffer = Buffer.concat(parts);
  if (upload) return { action: 'upload-social-seller', packageBuffer: buffer };
  if (!contentType.startsWith('application/json')) throw new HttpError(400, 'Invalid request');
  let value;
  try { value = JSON.parse(buffer.toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON request'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Invalid request');
  return value;
}

async function uploadSocialSellerPackage(buffer, authorization) {
  if (!validUploadToken(authorization?.replace(/^Bearer\s+/i, ''))) throw new HttpError(401, 'Unauthorized');
  const auth = process.env.BLOB_READ_WRITE_TOKEN
    ? { token: process.env.BLOB_READ_WRITE_TOKEN }
    : process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID
      ? { oidcToken: process.env.VERCEL_OIDC_TOKEN, storeId: process.env.BLOB_STORE_ID }
      : null;
  if (!auth) throw new HttpError(503, 'Private storage is unavailable');
  if (!Buffer.isBuffer(buffer) || buffer.length !== expectedSize || createHash('sha256').update(buffer).digest('hex') !== expectedHash) {
    throw new HttpError(400, 'Release package checksum failed');
  }
  const options = { ...auth, abortSignal: AbortSignal.timeout(120000) };
  let exists = false;
  try { await head(filePath, options); exists = true; }
  catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  if (!exists) await put(filePath, buffer, { ...options, access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/zip' });
  const metadata = await head(filePath, options);
  if (!metadata.url.includes('.private.blob.vercel-storage.com/') || metadata.size !== expectedSize) throw new HttpError(409, 'Private file metadata check failed');
  const result = await get(filePath, { ...options, access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) throw new HttpError(409, 'Private file read-back failed');
  const reader = result.stream.getReader();
  const digest = createHash('sha256');
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      digest.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (digest.digest('hex') !== expectedHash) throw new HttpError(409, 'Private file checksum did not match');
  return { uploaded: true, verified: true, size: expectedSize };
}

module.exports = endpoint('POST', async (req, res) => {
  const input = await readInput(req);
  if (input.action === 'upload-social-seller') {
    return res.status(200).json(await uploadSocialSellerPackage(input.packageBuffer, req.headers.authorization));
  }
  if (!process.env.CRON_SECRET || !equal(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) throw new HttpError(401, 'Unauthorized');
  return res.status(200).json(await importProducts(input.ids));
});
module.exports.config = { api: { bodyParser: false } };
