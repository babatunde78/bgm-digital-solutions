'use strict';
const { createHash } = require('node:crypto');
const { BlobNotFoundError, get, head, put } = require('@vercel/blob');

const expectedHash = '0cc8ba13b4733bf90869c3c02c3d9bd254d2fcb9e5bdd5e3bc58bd5a72c42b87';
const expectedSize = 224765;
const pathname = 'furniture-quote-invoice/v1.0.0/furniture-quote-invoice-v1.0.0-customer.zip';
module.exports.config = { api: { bodyParser: false } };

module.exports = async function furnitureReleaseUpload(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.FURNITURE_RELEASE_UPLOAD_TOKEN || req.headers.authorization !== `Bearer ${process.env.FURNITURE_RELEASE_UPLOAD_TOKEN}`) return res.status(401).end();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > expectedSize) return res.status(413).end();
    chunks.push(chunk);
  }
  const archive = Buffer.concat(chunks);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  if (size !== expectedSize || sha256 !== expectedHash) return res.status(422).json({ error: 'Release archive did not match the approved package.' });
  let stored;
  try {
    stored = await head(pathname);
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error;
  }
  if (!stored) await put(pathname, archive, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/zip' });
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || result.blob.size !== expectedSize) return res.status(502).json({ error: 'Private storage read-back failed.' });
  const digest = createHash('sha256');
  const reader = result.stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      digest.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (digest.digest('hex') !== expectedHash) return res.status(502).json({ error: 'Stored archive checksum did not match.' });
  return res.status(200).json({ pathname, size: expectedSize, sha256: expectedHash });
};
module.exports.config = { api: { bodyParser: false } };
