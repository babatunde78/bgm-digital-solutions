'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const { BlobNotFoundError, get, head, put } = require('@vercel/blob');

const filePath = 'social-seller-bookkeeping/v1.0.0/social-seller-bookkeeping-v1.0.0-customer.zip';
const expectedHash = 'fe84d4648df9d4780daf1e704794834b766064b56f5df48b3b7587c605e65b9e';
const expectedSize = 136027;

function matchesToken(supplied) {
  const expected = process.env.SOCIAL_SELLER_RELEASE_UPLOAD_TOKEN || '';
  const actual = Buffer.from(supplied || '');
  const target = Buffer.from(expected);
  return expected.length >= 32 && actual.length === target.length && timingSafeEqual(actual, target);
}

async function verifyStored(options) {
  const metadata = await head(filePath, options);
  if (!metadata.url.includes('.private.blob.vercel-storage.com/') || metadata.size !== expectedSize) throw new Error('Private file metadata check failed.');
  const result = await get(filePath, { ...options, access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) throw new Error('Private file read-back failed.');
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
  if (digest.digest('hex') !== expectedHash) throw new Error('Private file checksum did not match.');
}

module.exports = async function uploadRelease(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!matchesToken(req.headers.authorization?.replace(/^Bearer\s+/i, ''))) return res.status(401).json({ error: 'Unauthorized.' });
  if (!process.env.VERCEL_OIDC_TOKEN || !process.env.BLOB_STORE_ID) return res.status(503).json({ error: 'Private storage is unavailable.' });
  const options = { oidcToken: process.env.VERCEL_OIDC_TOKEN, storeId: process.env.BLOB_STORE_ID, abortSignal: AbortSignal.timeout(120000) };
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > expectedSize) return res.status(413).json({ error: 'File too large.' });
    parts.push(part);
  }
  const buffer = Buffer.concat(parts);
  if (buffer.length !== expectedSize || createHash('sha256').update(buffer).digest('hex') !== expectedHash) return res.status(400).json({ error: 'Release package checksum failed.' });
  let existing;
  try { existing = await head(filePath, options); }
  catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  if (!existing) await put(filePath, buffer, { ...options, access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/zip' });
  await verifyStored(options);
  return res.status(200).json({ uploaded: true, verified: true, size: expectedSize });
};

module.exports.config = { api: { bodyParser: false } };
